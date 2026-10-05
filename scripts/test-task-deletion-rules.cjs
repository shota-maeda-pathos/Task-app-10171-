const fs = require('node:fs');
const path = require('node:path');
const auth = require(path.join(process.argv[2], 'lib/auth.js'));
const project = 'kensyu10171';
const cases = [];
function test(name, service, method, uid, suffix, expectation, resource, mock) {
  const prefix = service === 'storage' ? '/b/kensyu10171.firebasestorage.app/o/' : '/databases/(default)/documents/';
  cases.push({ name, service, value: {
    expectation,
    request: { path: prefix + suffix, method, auth: uid ? { uid, token: {} } : null },
    ...(resource ? { resource } : {}),
    ...(mock ? { functionMocks: [{ function: service === 'storage' ? 'firestore.get' : 'get', args: [{ anyValue: {} }], result: { value: { data: mock } } }] } : {}),
  } });
}
for (const uid of ['author', 'other', null]) {
  test(`new file delete ${uid}`, 'storage', 'delete', uid, 'task-attachments/task/author/file.jpg', uid === 'author' ? 'ALLOW' : 'DENY');
  test(`legacy delete ${uid}`, 'storage', 'delete', uid, 'task-attachments/task/file.jpg', uid === 'author' ? 'ALLOW' : 'DENY', undefined, { authorId: 'author' });
  test(`record delete ${uid}`, 'firestore', 'delete', uid, 'tasks/task/attachments/attachment', uid === 'author' ? 'ALLOW' : 'DENY', { data: { authorId: 'author' } });
  test(`legacy claim ${uid}`, 'firestore', 'create', uid, 'tasks/task/attachmentOwners/file.jpg', uid === 'author' ? 'ALLOW' : 'DENY', undefined, { authorId: 'author', storagePath: 'task-attachments/task/file.jpg' });
  cases.at(-1).value.request.resource = { data: { authorId: uid, attachmentId: 'attachment' } };
}
test('forged legacy path', 'firestore', 'create', 'author', 'tasks/task/attachmentOwners/other.jpg', 'DENY', undefined, { authorId: 'author', storagePath: 'task-attachments/task/file.jpg' });
cases.at(-1).value.request.resource = { data: { authorId: 'author', attachmentId: 'attachment' } };
test('overwrite legacy claim', 'firestore', 'update', 'author', 'tasks/task/attachmentOwners/file.jpg', 'DENY', { data: { authorId: 'author', attachmentId: 'attachment' } });
test('change attachment owner', 'firestore', 'update', 'author', 'tasks/task/attachments/attachment', 'DENY', { data: { authorId: 'author' } });
test('create flat file', 'storage', 'create', 'author', 'task-attachments/task/file.jpg', 'DENY');
test('overwrite new file', 'storage', 'update', 'author', 'task-attachments/task/author/file.jpg', 'DENY');
for (const [uid, size, expected] of [['author', 100, 'ALLOW'], ['other', 100, 'DENY'], ['author', 10485761, 'DENY']]) {
  test(`upload ${uid} ${size}`, 'storage', 'create', uid, 'task-attachments/task/author/file.jpg', expected);
  cases.at(-1).value.request.resource = { size };
}
async function main() {
  for (const t of cases) {
    t.value.functionMocks ||= [];
    if (t.service === 'firestore') {
      const get = t.value.functionMocks.find(m => m.function === 'get');
      if (get) Object.assign(get.result.value.data, { disabled: false, role: 'member' });
      else t.value.functionMocks.push({ function: 'get', args: [{ anyValue: {} }], result: { value: { data: { disabled: false, role: 'member' } } } });
      for (const fn of ['exists', 'existsAfter']) t.value.functionMocks.push({ function: fn, args: [{ anyValue: {} }], result: { value: true } });
    } else {
      const get = t.value.functionMocks.find(m => m.function === 'firestore.get');
      if (get) Object.assign(get.result.value.data, { disabled: false });
      else t.value.functionMocks.push({ function: 'firestore.get', args: [{ anyValue: {} }], result: { value: { data: { disabled: false } } } });
      t.value.functionMocks.push({ function: 'firestore.exists', args: [{ anyValue: {} }], result: { value: true } });
    }
  }
  for (const uid of ['author', 'other', null]) {
    test(`direct task delete ${uid}`, 'firestore', 'delete', uid, 'tasks/task', 'DENY', { data: { createdBy: uid, assigneeId: uid } });
    test(`client job create ${uid}`, 'firestore', 'create', uid, 'taskDeletionJobs/task', 'DENY');
    test(`client marker create ${uid}`, 'firestore', 'create', uid, 'taskDeletionMarkers/task', 'DENY');
  }
  for (const disabled of [false, true]) {
    test(`individual comment deletion disabled=${disabled}`, 'firestore', 'delete', 'author', 'tasks/task/comments/comment', disabled ? 'DENY' : 'ALLOW', { data: { authorId: 'author' } });
    cases.at(-1).value.functionMocks = [
      { function: 'exists', args: [{ anyValue: {} }], result: { value: true } },
      { function: 'get', args: [{ anyValue: {} }], result: { value: { data: { disabled, role: 'member' } } } },
    ];
  }
  test('comment creation after task deletion', 'firestore', 'create', 'author', 'tasks/task/comments/comment', 'DENY');
  cases.at(-1).value.request.resource = { data: { authorId: 'author' } };
  cases.at(-1).value.functionMocks = [
    { function: 'exists', args: [{ anyValue: {} }], result: { value: true } },
    { function: 'existsAfter', args: [{ anyValue: {} }], result: { value: false } },
    { function: 'get', args: [{ anyValue: {} }], result: { value: { data: { disabled: false, role: 'member' } } } },
  ];
  test('upload after task deletion', 'storage', 'create', 'author', 'task-attachments/task/author/file.jpg', 'DENY');
  cases.at(-1).value.request.resource = { size: 100 };
  cases.at(-1).value.functionMocks = [{ function: 'firestore.exists', args: [{ anyValue: {} }], result: { value: false } }];
  const account = auth.getProjectDefaultAccount(process.cwd());
  if (!account) throw new Error('Firebase CLI login is required');
  const token = await auth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/firebase']);
  for (const service of ['firestore', 'storage']) {
    const group = cases.filter(t => t.service === service);
    const response = await fetch(`https://firebaserules.googleapis.com/v1/projects/${project}:test`, {
      method: 'POST', headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: { files: [{ name: `${service}.rules`, content: fs.readFileSync(`${service}.rules`, 'utf8') }] }, testSuite: { testCases: group.map(t => t.value) } }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(result));
    fs.writeFileSync(`tmp/${service}-ownership-test-results.json`, JSON.stringify(result, null, 2));
    if (!result.testResults || result.testResults.length !== group.length) throw new Error('Missing results');
    result.testResults.forEach((r, i) => {
      console.log(`${r.state}: ${group[i].name}`);
      if (r.state !== 'SUCCESS') process.exitCode = 1;
    });
  }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
