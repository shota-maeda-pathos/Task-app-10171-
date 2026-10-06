const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

const ACTIVE_STATUSES = ['未着手', '進行中', '差し戻し中'];

function toJST(date) {
  return new Date(date.getTime() + JST_OFFSET_MS);
}

function getWeekMondayJST(date) {
  const jst = toJST(date);
  jst.setUTCHours(0, 0, 0, 0);
  const day = jst.getUTCDay();
  jst.setUTCDate(jst.getUTCDate() - ((day + 6) % 7));
  return jst;
}

async function resetWeeklyFocus(db, now = () => new Date()) {
  const currentMonday = getWeekMondayJST(now());

  // 1. 今週より前のfocusをリセット
  const focusedSnapshot = await db
    .collection('tasks')
    .where('focusThisWeek', '==', true)
    .where('status', 'in', ACTIVE_STATUSES)
    .get();

  let resetCount = 0;
  let batch = db.batch();
  let batchCount = 0;

  for (const doc of focusedSnapshot.docs) {
    const data = doc.data();
    const targetWeek = data.targetWeekStart?.toDate
      ? data.targetWeekStart.toDate()
      : data.targetWeekStart;
    const taskMonday = targetWeek ? getWeekMondayJST(targetWeek) : null;

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
    .where('status', 'in', ACTIVE_STATUSES)
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
    const taskMonday = getWeekMondayJST(targetWeek);

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

module.exports = { resetWeeklyFocus, getWeekMondayJST };
