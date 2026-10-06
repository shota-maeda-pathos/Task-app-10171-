const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { resetWeeklyFocus, getWeekMondayJST } = require('./weekly-reset');

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
    async runTransaction(callback) {
      const ops = [];
      if (db.beforeTransaction) {
        const hook = db.beforeTransaction;
        db.beforeTransaction = null;
        hook(records);
      }
      const transaction = {
        async get(ref) {
          const value = records.get(ref.path);
          return { exists: !!value, data: () => ({ ...value }) };
        },
        update(ref, data) { ops.push({ ref, data }); },
      };
      let result = await callback(transaction);
      if (db.onConflict) {
        const hook = db.onConflict;
        db.onConflict = null;
        hook(records);
        ops.length = 0;
        result = await callback(transaction);
      }
      for (const { ref, data } of ops) Object.assign(records.get(ref.path), data);
      return result;
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

describe('getWeekMondayJST', () => {
  it('UTC日曜21:00（JST月曜6:00）を今週の月曜と判定する', () => {
    // 2026-10-04 Sun 21:00 UTC = 2026-10-05 Mon 06:00 JST
    const utcSundayNight = new Date('2026-10-04T21:00:00Z');
    const monday = getWeekMondayJST(utcSundayNight);
    // JSTで10/5（月曜）の週の月曜 = 10/5
    assert.equal(monday.getUTCFullYear(), 2026);
    assert.equal(monday.getUTCMonth(), 9); // October = 9
    assert.equal(monday.getUTCDate(), 5);
  });

  it('UTC月曜0:00（JST月曜9:00）を今週の月曜と判定する', () => {
    const utcMonday = new Date('2026-10-05T00:00:00Z');
    const monday = getWeekMondayJST(utcMonday);
    assert.equal(monday.getUTCDate(), 5);
  });
});

describe('resetWeeklyFocus', () => {
  // Cloud Functionsは月曜6:00 JSTに発火 = 日曜21:00 UTC
  const fireTime = new Date('2026-10-04T21:00:00Z');
  const thisMondayJST = getWeekMondayJST(fireTime);
  const lastMondayJST = new Date(thisMondayJST);
  lastMondayJST.setUTCDate(lastMondayJST.getUTCDate() - 7);

  it('先週のfocusタスクをリセットし、今週のtargetWeekStartは残す', async () => {
    const db = makeDb([
      { id: 'last-week', focusThisWeek: true, focusHours: 3, status: '未着手', targetWeekStart: ts(lastMondayJST) },
      { id: 'this-week', focusThisWeek: true, focusHours: 5, status: '進行中', targetWeekStart: ts(thisMondayJST) },
      { id: 'no-target', focusThisWeek: true, focusHours: 2, status: '未着手', targetWeekStart: null },
    ]);

    const result = await resetWeeklyFocus(db, () => fireTime);

    assert.equal(result.reset, 2);
    assert.equal(db.records.get('tasks/last-week').focusThisWeek, false);
    assert.equal(db.records.get('tasks/last-week').focusHours, null);
    assert.equal(db.records.get('tasks/no-target').focusThisWeek, false);
    // 今週のタスクは残る
    assert.equal(db.records.get('tasks/this-week').focusThisWeek, true);
    assert.equal(db.records.get('tasks/this-week').focusHours, 5);
  });

  it('差し戻し中のタスクもリセット対象になる', async () => {
    const db = makeDb([
      { id: 'review', focusThisWeek: true, focusHours: 3, status: '差し戻し中', targetWeekStart: ts(lastMondayJST) },
    ]);

    const result = await resetWeeklyFocus(db, () => fireTime);

    assert.equal(result.reset, 1);
    assert.equal(db.records.get('tasks/review').focusThisWeek, false);
  });

  it('targetWeekStartが今週のタスクを自動ONにする', async () => {
    const db = makeDb([
      { id: 'scheduled', focusThisWeek: false, focusHours: null, status: '未着手', targetWeekStart: ts(thisMondayJST), estimatedHours: 4 },
      { id: 'next-week', focusThisWeek: false, focusHours: null, status: '未着手', targetWeekStart: ts(new Date('2026-10-12')), estimatedHours: 3 },
    ]);

    const result = await resetWeeklyFocus(db, () => fireTime);

    assert.equal(result.activated, 1);
    assert.equal(db.records.get('tasks/scheduled').focusThisWeek, true);
    assert.equal(db.records.get('tasks/scheduled').focusHours, 4);
    assert.equal(db.records.get('tasks/next-week').focusThisWeek, false);
  });

  it('完了タスクはリセットも自動ONもしない', async () => {
    const db = makeDb([
      { id: 'done', focusThisWeek: true, focusHours: 3, status: '完了', targetWeekStart: ts(lastMondayJST) },
    ]);

    const result = await resetWeeklyFocus(db, () => fireTime);
    assert.equal(result.reset, 0);
    assert.equal(result.activated, 0);
  });

  it('UTC日曜21:00でも正しく今週を判定する（タイムゾーンバグ回帰テスト）', async () => {
    // Cloud Functionsが日曜21:00 UTC（= 月曜6:00 JST）に実行される
    const db = makeDb([
      { id: 'a', focusThisWeek: true, focusHours: 3, status: '未着手', targetWeekStart: ts(thisMondayJST) },
    ]);

    const result = await resetWeeklyFocus(db, () => fireTime);

    // 今週のタスクはリセットされない
    assert.equal(result.reset, 0);
    assert.equal(db.records.get('tasks/a').focusThisWeek, true);
  });

  it('500件を個別トランザクションで処理できる', async () => {
    const tasks = [];
    for (let i = 0; i < 500; i++) {
      tasks.push({
        id: `task-${i}`,
        focusThisWeek: true,
        focusHours: 1,
        status: '未着手',
        targetWeekStart: ts(lastMondayJST),
      });
    }
    const db = makeDb(tasks);

    const result = await resetWeeklyFocus(db, () => fireTime);

    assert.equal(result.reset, 500);
    for (let i = 0; i < 500; i++) {
      assert.equal(db.records.get(`tasks/task-${i}`).focusThisWeek, false);
    }
  });
  it('自動ONの読み取り後に2hへ変更された場合は最新値を使う', async () => {
    const db = makeDb([{ id: 'a', focusThisWeek: false, estimatedHours: 8,
      focusHours: null, status: '未着手', targetWeekStart: ts(thisMondayJST) }]);
    db.beforeTransaction = records => Object.assign(records.get('tasks/a'), { focusHours: 2 });
    await resetWeeklyFocus(db, () => fireTime);
    assert.equal(db.records.get('tasks/a').focusHours, 2);
  });
  it('トランザクション競合後も利用者の今週2hを上書きしない', async () => {
    const db = makeDb([{ id: 'a', focusThisWeek: false, estimatedHours: 8,
      focusHours: null, status: '未着手', targetWeekStart: ts(thisMondayJST) }]);
    db.onConflict = records => Object.assign(records.get('tasks/a'), { focusThisWeek: true, focusHours: 2 });
    const result = await resetWeeklyFocus(db, () => fireTime);
    assert.equal(result.activated, 0);
    assert.equal(db.records.get('tasks/a').focusThisWeek, true);
    assert.equal(db.records.get('tasks/a').focusHours, 2);
  });
  it('リセット対象が今週へ変更されたらリセットしない', async () => {
    const db = makeDb([{ id: 'a', focusThisWeek: true, estimatedHours: 8,
      focusHours: 8, status: '進行中', targetWeekStart: ts(lastMondayJST) }]);
    db.onConflict = records => Object.assign(records.get('tasks/a'), { targetWeekStart: ts(thisMondayJST), focusHours: 2 });
    const result = await resetWeeklyFocus(db, () => fireTime);
    assert.equal(result.reset, 0);
    assert.equal(db.records.get('tasks/a').focusHours, 2);
  });
  it('読み取り後に完了・削除されたタスクを自動ONしない', async () => {
    for (const deleted of [false, true]) {
      const db = makeDb([{ id: 'a', focusThisWeek: false, estimatedHours: 8,
        status: '未着手', targetWeekStart: ts(thisMondayJST) }]);
      db.beforeTransaction = records => {
        if (deleted) records.delete('tasks/a');
        else records.get('tasks/a').status = '完了';
      };
      const result = await resetWeeklyFocus(db, () => fireTime);
      assert.equal(result.activated, 0);
    }
  });
});
