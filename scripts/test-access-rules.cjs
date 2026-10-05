const fs = require('node:fs');
const path = require('node:path');
const auth = require(path.join(process.argv[2], 'lib/auth.js'));
const cases = [];
const baseMember = { uid: 'user', name: 'User', role: 'member', weeklyCapacityHours: 40, avatarColor: '#123456' };
const baseTask = { createdBy: 'user', parentId: null, title: 'Task', assigneeId: 'user', status: '未着手', estimatedHours: 1 };
function add(name, service, method, suffix, expected, options = {}) {
  const active = { ...baseMember, ...(options.member ?? {}) };
  const context = { ...active, ...(options.lookup ?? {}) };
  const request = {
    path: (service === 'storage' ? '/b/kensyu10171.firebasestorage.app/o/' : '/databases/(default)/documents/') + suffix,
    method, auth: options.anonymous ? null : { uid: 'user', token: {} },
    ...(options.data ? { resource: { data: options.data } } : {}),
  };
  if (service === 'storage' && options.size !== undefined) request.resource = { size: options.size };
  const prefix = service === 'storage' ? 'firestore.' : '';
  const mocks = [
    { function: `${prefix}get`, args: [{ anyValue: {} }], result: { value: { data: context } } },
    { function: `${prefix}exists`, args: [{ anyValue: {} }], result: { value: options.memberExists !== false } },
  ];
  if (service === 'firestore') mocks.push({ function: 'existsAfter', args: [{ anyValue: {} }], result: { value: true } });
  cases.push({ name, service, value: { expectation: expected, request, functionMocks: mocks, ...(options.resource ? { resource: { data: options.resource } } : {}) } });
}
add('new user creates ordinary member', 'firestore', 'create', 'members/user', 'ALLOW', { memberExists: false, data: baseMember });
add('new user cannot register as manager', 'firestore', 'create', 'members/user', 'DENY', { memberExists: false, data: { ...baseMember, role: 'manager' } });
add('new user cannot spoof member uid', 'firestore', 'create', 'members/user', 'DENY', { data: { ...baseMember, uid: 'other' } });
add('new user cannot read team before registration', 'firestore', 'get', 'tasks/task', 'DENY', { memberExists: false });
add('new user can check own registration', 'firestore', 'get', 'members/user', 'ALLOW', { memberExists: false });
add('disabled user can check own disabled status', 'firestore', 'get', 'members/user', 'ALLOW', { member: { disabled: true } });
add('disabled user cannot reactivate self', 'firestore', 'update', 'members/user', 'DENY', { member: { disabled: true }, resource: { ...baseMember, disabled: true }, data: { ...baseMember, disabled: false } });
add('ordinary member cannot promote self', 'firestore', 'update', 'members/user', 'DENY', { resource: baseMember, data: { ...baseMember, role: 'manager' } });
add('manager can promote member', 'firestore', 'update', 'members/other', 'ALLOW', { member: { role: 'manager' }, resource: { ...baseMember, uid: 'other' }, data: { ...baseMember, uid: 'other', role: 'manager' } });
add('disabled manager cannot promote member', 'firestore', 'update', 'members/other', 'DENY', { member: { role: 'manager', disabled: true }, resource: { ...baseMember, uid: 'other' }, data: { ...baseMember, uid: 'other', role: 'manager' } });
add('manager cannot rewrite uid', 'firestore', 'update', 'members/other', 'DENY', { member: { role: 'manager' }, resource: { ...baseMember, uid: 'other' }, data: baseMember });
add('member profile edit remains allowed', 'firestore', 'update', 'members/user', 'ALLOW', { resource: baseMember, data: { ...baseMember, name: 'New name' } });
add('member cannot inject custom privilege field', 'firestore', 'update', 'members/user', 'DENY', { resource: baseMember, data: { ...baseMember, isAdmin: true } });
add('member cannot omit role', 'firestore', 'update', 'members/user', 'DENY', { resource: baseMember, data: { uid: 'user', name: 'User', weeklyCapacityHours: 40, avatarColor: '#123456' } });
add('member record deletion forbidden', 'firestore', 'delete', 'members/other', 'DENY', { member: { role: 'manager' } });
for (const suffix of ['tasks/task', 'tasks/task/comments/comment', 'tasks/task/attachments/file', 'tasks/task/activities/history', 'tasks/task/attachmentOwners/file.jpg', 'teamSettings/default', 'members/other', 'members/user/notifications/notification', 'taskTemplates/template']) {
  for (const disabled of [false, true]) add(`${disabled ? 'disabled' : 'active'} read ${suffix}`, 'firestore', 'get', suffix, disabled ? 'DENY' : 'ALLOW', { member: { disabled }, resource: { createdBy: 'user', authorId: 'user' } });
}
add('active manager edits settings', 'firestore', 'update', 'teamSettings/default', 'ALLOW', { member: { role: 'manager' } });
add('disabled manager cannot edit settings', 'firestore', 'update', 'teamSettings/default', 'DENY', { member: { role: 'manager', disabled: true } });
add('ordinary member cannot edit settings', 'firestore', 'update', 'teamSettings/default', 'DENY');
add('task update cannot spoof creator', 'firestore', 'update', 'tasks/task', 'DENY', { resource: baseTask, data: { ...baseTask, createdBy: 'other' } });
add('task update with same creator works', 'firestore', 'update', 'tasks/task', 'ALLOW', { resource: baseTask, data: { ...baseTask, title: 'Updated' } });
add('disabled task update denied', 'firestore', 'update', 'tasks/task', 'DENY', { member: { disabled: true }, resource: baseTask, data: baseTask });
for (const creator of ['user', 'other']) add(`template create ${creator}`, 'firestore', 'create', 'taskTemplates/template', creator === 'user' ? 'ALLOW' : 'DENY', { data: { createdBy: creator } });
add('template update cannot spoof creator', 'firestore', 'update', 'taskTemplates/template', 'DENY', { resource: { createdBy: 'user' }, data: { createdBy: 'other' } });
for (const [name, data, lookup, expected] of [
  ['normal task records actual creator', baseTask, {}, 'ALLOW'],
  ['normal task cannot spoof creator', { ...baseTask, createdBy: 'other' }, {}, 'DENY'],
  ['recurrence keeps original creator', { ...baseTask, createdBy: 'other', recurrence: 'daily', recurrencePreviousTaskId: 'previous', recurrenceSourceId: 'previous' }, { ...baseTask, createdBy: 'other', status: '完了', recurrence: 'daily', recurrenceSourceId: null }, 'ALLOW'],
  ['recurrence cannot copy unrelated author', { ...baseTask, createdBy: 'other', recurrence: 'daily', recurrencePreviousTaskId: 'previous', recurrenceSourceId: 'previous' }, { ...baseTask, createdBy: 'other', assigneeId: 'other', status: '完了', recurrence: 'daily', recurrenceSourceId: null }, 'DENY'],
  ['recurrence cannot fabricate creator', { ...baseTask, createdBy: 'fake', recurrence: 'daily', recurrencePreviousTaskId: 'previous', recurrenceSourceId: 'previous' }, { ...baseTask, createdBy: 'other', status: '完了', recurrence: 'daily', recurrenceSourceId: null }, 'DENY'],
]) {
  add(name, 'firestore', 'create', 'tasks/newTask', expected, { data, lookup });
  cases.at(-1).value.functionMocks = cases.at(-1).value.functionMocks.filter(m => m.function !== 'exists');
  cases.at(-1).value.functionMocks.push(
    { function: 'exists', args: [{ exactValue: '/databases/(default)/documents/members/user' }], result: { value: true } },
    { function: 'exists', args: [{ anyValue: {} }], result: { value: false } },
  );
}
for (const disabled of [false, true]) {
  for (const suffix of ['task-attachments/task/user/file.jpg', 'task-attachments/task/file.jpg']) {
    add(`storage read disabled=${disabled} ${suffix}`, 'storage', 'get', suffix, disabled ? 'DENY' : 'ALLOW', { member: { disabled } });
    add(`storage delete disabled=${disabled} ${suffix}`, 'storage', 'delete', suffix, disabled ? 'DENY' : 'ALLOW', { member: { disabled }, lookup: { authorId: 'user' } });
  }
  add(`storage upload disabled=${disabled}`, 'storage', 'create', 'task-attachments/task/user/file.jpg', disabled ? 'DENY' : 'ALLOW', { member: { disabled }, size: 100 });
}
add('anonymous storage read denied', 'storage', 'get', 'task-attachments/task/user/file.jpg', 'DENY', { anonymous: true });
async function main() {
  fs.mkdirSync('tmp', { recursive: true });
  const account = auth.getProjectDefaultAccount(process.cwd());
  if (!account) throw new Error('Firebase CLI login is required');
  const token = await auth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/firebase']);
  for (const service of ['firestore', 'storage']) {
    const group = cases.filter(c => c.service === service);
    const response = await fetch('https://firebaserules.googleapis.com/v1/projects/kensyu10171:test', {
      method: 'POST', headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: { files: [{ name: `${service}.rules`, content: fs.readFileSync(`${service}.rules`, 'utf8') }] }, testSuite: { testCases: group.map(c => c.value) } }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(result));
    fs.writeFileSync(`tmp/${service}-access-test-results.json`, JSON.stringify(result, null, 2));
    if (result.testResults?.length !== group.length) throw new Error('Missing test results');
    result.testResults.forEach((r, i) => {
      console.log(`${r.state}: ${group[i].name}`);
      if (r.state !== 'SUCCESS') process.exitCode = 1;
    });
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
