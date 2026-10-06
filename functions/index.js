const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');
const { onCall } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { deleteTaskAtomically, cleanupDeletedTask } = require('./task-deletion');
const { resetWeeklyFocus } = require('./weekly-reset');

admin.initializeApp();

const db = admin.firestore();
const messaging = admin.messaging();

exports.deleteTaskSafely = onCall({ region: 'asia-northeast1', timeoutSeconds: 120 }, async request => {
  const result = await deleteTaskAtomically(db, request.data?.taskId, request.auth?.uid);
  let cleanupPending = true;
  try {
    cleanupPending = !(await cleanupDeletedTask(db, admin.storage().bucket(), result.jobId));
  } catch (error) {
    console.error('Task file cleanup deferred', result.jobId, error.code ?? 'unknown');
  }
  return { ...result, cleanupPending };
});

exports.retryTaskFileCleanup = onSchedule({ schedule: 'every 5 minutes', region: 'asia-northeast1', timeoutSeconds: 300 }, async () => {
  const jobs = await db.collection('taskDeletionJobs').where('nextAttemptAt', '<=', admin.firestore.Timestamp.now()).orderBy('nextAttemptAt').limit(10).get();
  for (const job of jobs.docs) {
    try {
      await cleanupDeletedTask(db, admin.storage().bucket(), job.id);
    } catch (error) {
      console.error('Task file cleanup failed', job.id, error.code ?? 'unknown');
    }
  }
});

exports.onCommentCreated = onDocumentCreated(
  {
    document: 'tasks/{taskId}/comments/{commentId}',
    region: 'asia-northeast1',
  },
  async (event) => {
    const comment = event.data.data();
    const taskId = event.params.taskId;

    // タスクを取得
    const taskDoc = await db.collection('tasks').doc(taskId).get();
    if (!taskDoc.exists) return null;
    const task = taskDoc.data();

    // 担当者がいない or コメント投稿者が担当者自身の場合は通知しない
    if (!task.assigneeId) return null;
    if (task.assigneeId === comment.authorId) return null;

    // 担当者のFCMトークンを取得
    const memberDoc = await db.collection('members').doc(task.assigneeId).get();
    if (!memberDoc.exists) return null;
    const member = memberDoc.data();
    if (!member.fcmToken) return null;

    // 通知を送信
    const message = {
      token: member.fcmToken,
      notification: {
        title: `「${task.title}」にコメントが届きました`,
        body: `${comment.authorName}: ${comment.text.slice(0, 50)}`,
      },
      webpush: {
        fcmOptions: {
          link: '/board',
        },
      },
    };

    try {
      await messaging.send(message);
      console.log('通知送信成功:', task.assigneeId);
    } catch (error) {
      console.error('通知送信失敗:', error);
    }

    return null;
  }
);

exports.resetWeeklyFocus = onSchedule(
  { schedule: 'every monday 06:00', timeZone: 'Asia/Tokyo', region: 'asia-northeast1' },
  async () => {
    await resetWeeklyFocus(db);
  }
);
