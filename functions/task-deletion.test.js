const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Timestamp, FieldValue } = require('firebase-admin/firestore');
const { canDelete, deleteTaskAtomically, cleanupDeletedTask } = require('./task-deletion');

function fakeDatabase(initial = {}) {
  const records = new Map(Object.entries(initial));
  const operations = [];
  const ref = path => ({ path, id: path.split('/').at(-1), collection: name => query(`${path}/${name}`) });
  const query = (path, conditions = [], maximum = Infinity) => ({
    path, doc: id => ref(`${path}/${id}`),
    where: (field, op, value) => query(path, [...conditions, [field, value]], maximum),
    limit: count => query(path, conditions, count), conditions, maximum,
  });
  const snapshot = (path, data) => ({ id: path.split('/').at(-1), ref: ref(path), exists: data !== undefined, data: () => data });
  return {
    records, operations, failCommit: false, collection: path => query(path),
    async runTransaction(callback) {
      const pending = [];
      const tx = {
        async get(target) {
          assert.equal(pending.length, 0, 'All reads must precede writes');
          if (!target.conditions) return snapshot(target.path, records.get(target.path));
          const docs = [...records].filter(([path, data]) => path.startsWith(`${target.path}/`) && path.split('/').length === target.path.split('/').length + 1 && target.conditions.every(([field, value]) => data[field] === value)).slice(0, target.maximum).map(([path, data]) => snapshot(path, data));
          return { docs };
        },
        delete: target => pending.push(['delete', target.path]),
        create: (target, data) => pending.push(['create', target.path, data]),
        update: (target, data) => pending.push(['update', target.path, data]),
      };
      const result = await callback(tx);
      if (this.failCommit) throw new Error('commit unavailable');
      for (const [method, path] of pending) {
        if (method === 'create') assert.equal(records.has(path), false);
        if (method === 'update') assert.equal(records.has(path), true);
      }
      for (const [method, path, data] of pending) {
        operations.push([method, path]);
        if (method === 'delete') records.delete(path);
        else {
          const next = method === 'update' ? { ...records.get(path) } : {};
          for (const [key, value] of Object.entries(data)) {
            if (value?.isEqual?.(FieldValue.delete())) delete next[key];
            else if (value?.isEqual?.(FieldValue.increment(1))) next[key] = (next[key] ?? 0) + 1;
            else next[key] = value;
          }
          records.set(path, next);
        }
      }
      return result;
    },
  };
}
function fixture() {
  return fakeDatabase({
    'members/user': { role: 'member' },
    'tasks/root': { createdBy: 'creator', assigneeId: 'user', parentId: 'parent', estimatedHours: 5 },
    'tasks/child': { createdBy: 'user', parentId: 'root', estimatedHours: 3 },
    'tasks/parent': { createdBy: 'creator', estimatedHours: 7 },
    'tasks/sibling': { createdBy: 'creator', parentId: 'parent', estimatedHours: 2 },
    'tasks/root/attachments/file': { authorId: 'other', storagePath: 'task-attachments/root/other/file.jpg' },
    'tasks/root/comments/comment': { authorId: 'other' },
    'tasks/child/activities/history': { type: 'created' },
  });
}
for (const role of ['manager', 'creator', 'assignee', 'other', 'disabled']) {
  test(`permission: ${role}`, () => {
    assert.equal(canDelete({ createdBy: 'creator', assigneeId: 'assignee' }, { role: role === 'manager' ? 'manager' : 'member', disabled: role === 'disabled' }, role), !['other', 'disabled'].includes(role));
  });
}
test('assignee deletes the complete tree and foreign posts atomically, with parent hours and cleanup manifest', async () => {
  const db = fixture();
  await deleteTaskAtomically(db, 'root', 'user');
  for (const key of ['tasks/root', 'tasks/child', 'tasks/root/attachments/file', 'tasks/root/comments/comment', 'tasks/child/activities/history']) assert.equal(db.records.has(key), false);
  assert.equal(db.records.get('tasks/parent').estimatedHours, 7);
  assert.deepEqual(db.records.get('taskDeletionJobs/root').remainingPaths, ['task-attachments/root/other/file.jpg']);
  assert.equal(db.records.get('taskDeletionMarkers/child').jobId, 'root');
});
test('a forbidden child leaves every record unchanged', async () => {
  const db = fixture(); db.records.set('tasks/child', { createdBy: 'other', assigneeId: 'other', parentId: 'root' });
  const before = new Map(db.records);
  await assert.rejects(deleteTaskAtomically(db, 'root', 'user'), { code: 'permission-denied' });
  assert.deepEqual(db.records, before); assert.equal(db.operations.length, 0);
});
test('deletion preserves parent estimate and weekly hours with completed siblings', async () => {
  const db = fixture();
  db.records.set('tasks/completed', { parentId: 'parent', estimatedHours: 8, status: '完了' });
  db.records.set('tasks/archived', { parentId: 'parent', estimatedHours: 4, status: 'アーカイブ済み' });
  db.records.set('tasks/parent', { createdBy: 'creator', estimatedHours: 19, focusHours: 5 });
  await deleteTaskAtomically(db, 'root', 'user');
  assert.equal(db.records.get('tasks/parent').estimatedHours, 19);
  assert.equal(db.records.get('tasks/parent').focusHours, 5);
});
test('deletion preserves parent hours when only completed siblings remain', async () => {
  const db = fixture();
  db.records.set('tasks/sibling', { parentId: 'parent', estimatedHours: 8, status: '完了' });
  db.records.set('tasks/parent', { createdBy: 'creator', estimatedHours: 13, focusHours: 1 });
  await deleteTaskAtomically(db, 'root', 'user');
  assert.equal(db.records.get('tasks/parent').estimatedHours, 13);
  assert.equal(db.records.get('tasks/parent').focusHours, 1);
});
test('commit failure preserves task, attachments and history; retry succeeds', async () => {
  const db = fixture(); const before = new Map(db.records); db.failCommit = true;
  await assert.rejects(deleteTaskAtomically(db, 'root', 'user'), /commit unavailable/);
  assert.deepEqual(db.records, before);
  db.failCommit = false; await deleteTaskAtomically(db, 'root', 'user');
  assert.equal(db.records.has('tasks/root'), false);
});
test('retry after a lost response reuses the manifest without deleting twice', async () => {
  const db = fixture(); await deleteTaskAtomically(db, 'root', 'user'); const count = db.operations.length;
  assert.equal((await deleteTaskAtomically(db, 'root', 'user')).alreadyDeleted, true);
  assert.equal(db.operations.length, count);
});
test('disabled members are rejected without changing records', async () => {
  const db = fixture(); db.records.set('members/user', { role: 'manager', disabled: true });
  await assert.rejects(deleteTaskAtomically(db, 'root', 'user'), { code: 'permission-denied' });
  assert.equal(db.operations.length, 0);
});
test('forged file paths cannot make the server delete unrelated files', async () => {
  const db = fixture(); db.records.set('tasks/root/attachments/file', { storagePath: 'task-attachments/unrelated/file.jpg' });
  await assert.rejects(deleteTaskAtomically(db, 'root', 'user'), { code: 'failed-precondition' });
  assert.equal(db.operations.length, 0);
});
test('too many records fail before the first write', async () => {
  const db = fixture(); for (let i = 0; i < 450; i++) db.records.set(`tasks/root/comments/c${i}`, { authorId: 'other' });
  await assert.rejects(deleteTaskAtomically(db, 'root', 'user'), { code: 'resource-exhausted' });
  assert.equal(db.operations.length, 0);
});
test('storage permission and network failures remain queued, while missing files count as removed', async () => {
  const db = fakeDatabase({ 'taskDeletionJobs/root': { status: 'pending', remainingPaths: ['missing', 'denied', 'network'], attempts: 0 } });
  const errors = { missing: 404, denied: 403, network: 'ECONNRESET' };
  const bucket = { file: path => ({ delete: async () => { throw { code: errors[path] }; } }) };
  assert.equal(await cleanupDeletedTask(db, bucket, 'root', () => 1000000), false);
  const job = db.records.get('taskDeletionJobs/root');
  assert.deepEqual(job.remainingPaths, ['denied', 'network']); assert.equal(job.status, 'pending'); assert.equal(job.attempts, 1);
  assert.equal(job.nextAttemptAt.toMillis(), 1060000);
  assert.equal(await cleanupDeletedTask(db, { file: () => ({ delete: async () => {} }) }, 'root', () => 1060000), true);
  assert.equal(db.records.get('taskDeletionJobs/root').status, 'complete');
  assert.equal(db.records.get('taskDeletionJobs/root').nextAttemptAt, undefined);
});
test('active lease prevents overlapping workers from modifying the same manifest', async () => {
  const db = fakeDatabase({ 'taskDeletionJobs/root': { status: 'pending', remainingPaths: ['file'], leaseUntil: Timestamp.fromMillis(2000000) } });
  let calls = 0;
  assert.equal(await cleanupDeletedTask(db, { file: () => { calls++; } }, 'root', () => 1000000), false);
  assert.equal(calls, 0); assert.equal(db.operations.length, 0);
});
