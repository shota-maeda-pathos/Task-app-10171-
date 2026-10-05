const { HttpsError } = require('firebase-functions/v2/https');
const { FieldValue, Timestamp } = require('firebase-admin/firestore');
const { randomUUID } = require('node:crypto');

const MAX_WRITES = 450;
const MAX_TASKS = 100;
function validId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= 128 && !id.includes('/') && !['.', '..'].includes(id);
}
function canDelete(task, member, uid) {
  return !!member && !member.disabled && (member.role === 'manager' || task.createdBy === uid || task.assigneeId === uid);
}

async function deleteTaskAtomically(db, taskId, uid) {
  if (!uid) throw new HttpsError('unauthenticated', 'ログインしてください。');
  if (!validId(taskId)) throw new HttpsError('invalid-argument', 'タスクIDが不正です。');
  const jobRef = db.collection('taskDeletionJobs').doc(taskId);
  return db.runTransaction(async tx => {
    const memberDoc = await tx.get(db.collection('members').doc(uid));
    const member = memberDoc.data();
    if (!memberDoc.exists || member.disabled) throw new HttpsError('permission-denied', '有効なメンバーのみ削除できます。');
    const previous = await tx.get(jobRef);
    if (previous.exists) {
      if (previous.data().requestedBy !== uid && member.role !== 'manager') throw new HttpsError('permission-denied', '削除を再試行する権限がありません。');
      return { jobId: taskId, alreadyDeleted: true };
    }
    const root = await tx.get(db.collection('tasks').doc(taskId));
    if (!root.exists) throw new HttpsError('not-found', 'タスクが見つかりません。');
    const records = [];
    const files = new Set();
    const seen = new Set();
    const queue = [root];
    while (queue.length) {
      const task = queue.shift();
      if (seen.has(task.id)) throw new HttpsError('failed-precondition', '親子関係が循環しています。');
      seen.add(task.id);
      if (!canDelete(task.data(), member, uid)) throw new HttpsError('permission-denied', '削除できない子タスクが含まれています。管理者・作成者・担当者のみ削除できます。');
      records.push(task.ref);
      const children = await tx.get(db.collection('tasks').where('parentId', '==', task.id).limit(MAX_TASKS + 1));
      queue.push(...children.docs);
      for (const sub of ['attachments', 'comments', 'activities', 'attachmentOwners']) {
        const snapshots = await tx.get(task.ref.collection(sub).limit(MAX_WRITES + 1));
        for (const snapshot of snapshots.docs) {
          records.push(snapshot.ref);
          if (sub === 'attachments' && snapshot.data().storagePath) {
            const data = snapshot.data();
            const prefix = `task-attachments/${task.id}/`;
            if (typeof data.storagePath !== 'string' || !data.storagePath.startsWith(prefix) || data.storagePath.length > 2048) throw new HttpsError('failed-precondition', '添付ファイルの保存先が不正です。');
            const parts = data.storagePath.slice(prefix.length).split('/');
            if (!parts.every(p => p && p !== '.' && p !== '..') || !(parts.length === 1 || (parts.length === 2 && parts[0] === data.authorId))) throw new HttpsError('failed-precondition', '添付ファイルの投稿者と保存先が一致しません。');
            files.add(data.storagePath);
          }
        }
      }
      // Reserve one marker per task, one job, and a possible parent update.
      if (records.length + seen.size + 2 > MAX_WRITES || queue.length + seen.size > MAX_TASKS) throw new HttpsError('resource-exhausted', '関連データが多いため一度に削除できません。子タスクから分けて削除してください。');
    }
    let parentRef;
    let parentHours;
    let parentFocusHours;
    const parentId = root.data().parentId;
    if (parentId && !seen.has(parentId)) {
      if (!validId(parentId)) throw new HttpsError('failed-precondition', '親タスクIDが不正です。');
      parentRef = db.collection('tasks').doc(parentId);
      const parent = await tx.get(parentRef);
      if (parent.exists) {
        parentFocusHours = parent.data().focusHours ?? 0;
        const siblings = await tx.get(db.collection('tasks').where('parentId', '==', parentId));
        parentHours = siblings.docs.filter(s => !seen.has(s.id) && !['完了', 'アーカイブ済み'].includes(s.data().status))
          .reduce((sum, s) => sum + (s.data().estimatedHours ?? 0), 0);
      }
    }
    // No mutation occurs until the complete tree and all permissions are checked.
    for (const ref of records) tx.delete(ref);
    for (const id of seen) tx.create(db.collection('taskDeletionMarkers').doc(id), { jobId: taskId });
    if (parentHours !== undefined) {
      const parentUpdates = { estimatedHours: parentHours };
      // The parent's weekly budget cannot outlive its remaining child work.
      if (parentFocusHours > parentHours) parentUpdates.focusHours = parentHours;
      tx.update(parentRef, parentUpdates);
    }
    tx.create(jobRef, {
      requestedBy: uid, taskId, status: files.size ? 'pending' : 'complete', remainingPaths: [...files],
      attempts: 0, lastError: '', leaseUntil: Timestamp.fromMillis(0),
      ...(files.size ? { nextAttemptAt: Timestamp.now() } : {}),
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
    return { jobId: taskId, alreadyDeleted: false };
  });
}

async function cleanupDeletedTask(db, bucket, jobId, now = Date.now) {
  const ref = db.collection('taskDeletionJobs').doc(jobId);
  const leaseToken = randomUUID();
  const claimed = await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { complete: true };
    const job = snap.data();
    if (job.status === 'complete') return { complete: true };
    if ((job.leaseUntil?.toMillis() ?? 0) > now()) return { complete: false };
    const leaseUntil = Timestamp.fromMillis(now() + 5 * 60 * 1000);
    tx.update(ref, { leaseToken, leaseUntil, nextAttemptAt: leaseUntil });
    return { paths: job.remainingPaths, attempts: job.attempts ?? 0 };
  });
  if (!claimed.paths) return claimed.complete;
  const remaining = [];
  let lastError = '';
  for (const filePath of claimed.paths) {
    try {
      await bucket.file(filePath).delete();
    } catch (error) {
      if (error.code !== 404 && error.code !== 'storage/object-not-found') {
        remaining.push(filePath);
        lastError = String(error.code ?? 'unknown').slice(0, 128);
      }
    }
  }
  return db.runTransaction(async tx => {
    const current = await tx.get(ref);
    if (!current.exists || current.data().leaseToken !== leaseToken) return false;
    tx.update(ref, {
      remainingPaths: remaining, status: remaining.length ? 'pending' : 'complete', lastError,
      attempts: FieldValue.increment(1), leaseUntil: Timestamp.fromMillis(0),
      nextAttemptAt: remaining.length ? Timestamp.fromMillis(now() + Math.min(3600000, 60000 * 2 ** Math.min(claimed.attempts, 6))) : FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return remaining.length === 0;
  });
}

module.exports = { canDelete, deleteTaskAtomically, cleanupDeletedTask };
