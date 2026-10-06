const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { resetWeeklyFocus, getWeekMonday } = require('./weekly-reset');

function ts(date) {
  return { toDate: () => new Date(date) };
}

function makeDb(tasks) {
  const records = new Map();
  for (const t of tasks) {
    records.set(`tasks/${t.id}`, { ...t });
  }

  const db = {
    records,
    collection(name) {
      return {
        where(field, op, value) {
          return {
            where(field2, op2, value2) {
              return {
                async get() {
                  const docs = [];
                  for (const [path, data] of records) {
                    if (!path.startsWith(`${name}/`)) continue;
                    const match1 = op === '==' ? data[field] === value : (Array.isArray(value) && value.includes(data[field]));
                    const match2 = op2 === '==' ? data[field2] === value2 : (Array.isArray(value2) && value2.includes(data[field2]));
                    if (match1 && match2) {
                      docs.push({
                        id: path.split('/')[1],
                        ref: { path },
                        data: () => ({ ...data }),
                      });
                    }
                  }
                  return { empty: docs.length === 0, docs };
                },
              };
            },
          };
        },
      };
    },
    batch() {
      const ops = [];
      return {
        update(ref, data) {
          ops.push({ ref, data });
        },
        async commit() {
          for (const op of ops) {
            const existing = records.get(op.ref.path);
            if (existing) Object.assign(existing, op.data);
          }
          ops.length = 0;
        },
      };
    },
  };
  return db;
}

describe('resetWeeklyFocus', () => {
  // 月曜6時にリセットされる想定。nowは月曜AM6:00
  const monday = new Date('2026-10-05T06:00:00+09:00');
  const lastMonday = new Date('2026-09-28T00:00:00+09:00');
  const thisMonday = getWeekMonday(monday);

  it('先週のfocusタスクをリセットし、今週のtargetWeekStartは残す', async () => {
    const db = makeDb([
      { id: 'last-week', focusThisWeek: true, focusHours: 3, status: '未着手', targetWeekStart: ts(lastMonday) },
      { id: 'this-week', focusThisWeek: true, focusHours: 5, status: '進行中', targetWeekStart: ts(thisMonday) },
      { id: 'no-target', focusThisWeek: true, focusHours: 2, status: '未着手', targetWeekStart: null },
    ]);

    const result = await resetWeeklyFocus(db, () => monday);

    assert.equal(result.reset, 2);
    // 先週のタスクはリセットされる
    assert.equal(db.records.get('tasks/last-week').focusThisWeek, false);
    assert.equal(db.records.get('tasks/last-week').focusHours, null);
    // targetWeekStartなしもリセットされる
    assert.equal(db.records.get('tasks/no-target').focusThisWeek, false);
    // 今週のタスクは残る
    assert.equal(db.records.get('tasks/this-week').focusThisWeek, true);
    assert.equal(db.records.get('tasks/this-week').focusHours, 5);
  });

  it('targetWeekStartが今週のタスクを自動ONにする', async () => {
    const db = makeDb([
      { id: 'scheduled', focusThisWeek: false, focusHours: null, status: '未着手', targetWeekStart: ts(thisMonday), estimatedHours: 4 },
      { id: 'next-week', focusThisWeek: false, focusHours: null, status: '未着手', targetWeekStart: ts(new Date('2026-10-12')), estimatedHours: 3 },
    ]);

    const result = await resetWeeklyFocus(db, () => monday);

    assert.equal(result.activated, 1);
    assert.equal(db.records.get('tasks/scheduled').focusThisWeek, true);
    assert.equal(db.records.get('tasks/scheduled').focusHours, 4);
    // 来週のタスクはOFFのまま
    assert.equal(db.records.get('tasks/next-week').focusThisWeek, false);
  });

  it('完了タスクはリセットも自動ONもしない', async () => {
    const db = makeDb([
      { id: 'done', focusThisWeek: true, focusHours: 3, status: '完了', targetWeekStart: ts(lastMonday) },
    ]);

    const result = await resetWeeklyFocus(db, () => monday);
    assert.equal(result.reset, 0);
    assert.equal(result.activated, 0);
  });

  it('450件を超えてもバッチが正しく分割される', async () => {
    const tasks = [];
    for (let i = 0; i < 500; i++) {
      tasks.push({
        id: `task-${i}`,
        focusThisWeek: true,
        focusHours: 1,
        status: '未着手',
        targetWeekStart: ts(lastMonday),
      });
    }
    const db = makeDb(tasks);

    const result = await resetWeeklyFocus(db, () => monday);

    assert.equal(result.reset, 500);
    // 全件リセットされていること
    for (let i = 0; i < 500; i++) {
      assert.equal(db.records.get(`tasks/task-${i}`).focusThisWeek, false);
    }
  });
});
