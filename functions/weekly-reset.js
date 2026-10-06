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
  for (const doc of focusedSnapshot.docs) {
    const changed = await db.runTransaction(async transaction => {
      const latest = await transaction.get(doc.ref);
      if (!latest.exists) return false;
      const data = latest.data();
      if (!data.focusThisWeek || !ACTIVE_STATUSES.includes(data.status)) return false;
      const targetWeek = data.targetWeekStart?.toDate
        ? data.targetWeekStart.toDate()
        : data.targetWeekStart;
      const taskMonday = targetWeek ? getWeekMondayJST(targetWeek) : null;

      // 今週・将来の予定は保持し、過去のフォーカスだけを解除する。
      if (taskMonday && taskMonday.getTime() >= currentMonday.getTime()) return false;

      transaction.update(doc.ref, {
        focusThisWeek: false,
        focusHours: null,
      });
      return true;
    });
    if (changed) resetCount++;
  }

  // 2. targetWeekStartが今週のタスクを自動ON
  const scheduledSnapshot = await db
    .collection('tasks')
    .where('focusThisWeek', '==', false)
    .where('status', 'in', ACTIVE_STATUSES)
    .get();

  let activatedCount = 0;
  for (const doc of scheduledSnapshot.docs) {
    const changed = await db.runTransaction(async transaction => {
      const latest = await transaction.get(doc.ref);
      if (!latest.exists) return false;
      const data = latest.data();
      if (data.focusThisWeek || !ACTIVE_STATUSES.includes(data.status) || !data.targetWeekStart) return false;

      const targetWeek = data.targetWeekStart.toDate
        ? data.targetWeekStart.toDate()
        : data.targetWeekStart;
      const taskMonday = getWeekMondayJST(targetWeek);

      if (taskMonday.getTime() !== currentMonday.getTime()) return false;

      const estimatedHours = data.estimatedHours ?? 0;
      const focusHours = data.focusHours ?? estimatedHours;

      transaction.update(doc.ref, {
        focusThisWeek: true,
        focusHours: estimatedHours > 0
          ? Math.min(Math.max(0, focusHours), estimatedHours)
          : Math.max(0, focusHours),
      });
      return true;
    });
    if (changed) activatedCount++;
  }

  console.log(`リセット: ${resetCount}件, 自動ON: ${activatedCount}件`);
  return { reset: resetCount, activated: activatedCount };
}

module.exports = { resetWeeklyFocus, getWeekMondayJST };
