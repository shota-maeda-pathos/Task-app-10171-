const { Timestamp } = require('firebase-admin/firestore');

function getWeekMonday(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() - ((day + 6) % 7));
  return d;
}

async function resetWeeklyFocus(db, now = () => new Date()) {
  const currentMonday = getWeekMonday(now());

  // 1. 今週より前のfocusをリセット
  const focusedSnapshot = await db
    .collection('tasks')
    .where('focusThisWeek', '==', true)
    .where('status', 'in', ['未着手', '進行中', 'レビュー中'])
    .get();

  let resetCount = 0;
  let batch = db.batch();
  let batchCount = 0;

  for (const doc of focusedSnapshot.docs) {
    const data = doc.data();
    const targetWeek = data.targetWeekStart?.toDate
      ? data.targetWeekStart.toDate()
      : data.targetWeekStart;
    const taskMonday = targetWeek ? getWeekMonday(targetWeek) : null;

    // targetWeekStartが今週の月曜なら今週設定分なのでスキップ
    if (taskMonday && taskMonday.getTime() === currentMonday.getTime()) continue;

    batch.update(doc.ref, {
      focusThisWeek: false,
      focusHours: null,
    });
    resetCount++;
    batchCount++;

    if (batchCount >= 450) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    }
  }

  if (batchCount > 0) {
    await batch.commit();
  }

  // 2. targetWeekStartが今週のタスクを自動ON
  const scheduledSnapshot = await db
    .collection('tasks')
    .where('focusThisWeek', '==', false)
    .where('status', 'in', ['未着手', '進行中', 'レビュー中'])
    .get();

  let activatedCount = 0;
  batch = db.batch();
  batchCount = 0;

  for (const doc of scheduledSnapshot.docs) {
    const data = doc.data();
    if (!data.targetWeekStart) continue;

    const targetWeek = data.targetWeekStart.toDate
      ? data.targetWeekStart.toDate()
      : data.targetWeekStart;
    const taskMonday = getWeekMonday(targetWeek);

    if (taskMonday.getTime() !== currentMonday.getTime()) continue;

    const estimatedHours = data.estimatedHours ?? 0;
    const focusHours = data.focusHours ?? estimatedHours;

    batch.update(doc.ref, {
      focusThisWeek: true,
      focusHours: Math.min(Math.max(0, focusHours), estimatedHours),
    });
    activatedCount++;
    batchCount++;

    if (batchCount >= 450) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    }
  }

  if (batchCount > 0) {
    await batch.commit();
  }

  console.log(`リセット: ${resetCount}件, 自動ON: ${activatedCount}件`);
  return { reset: resetCount, activated: activatedCount };
}

module.exports = { resetWeeklyFocus, getWeekMonday };
