import { MemberLeave } from '../models/task.model';
export function leavePeriodLabel(leave: MemberLeave): string {
  return leave.period === 'am' ? '午前休' : leave.period === 'pm' ? '午後休' : '全日';
}
export function leaveDayFraction(leaves: MemberLeave[]): number {
  if (leaves.some(leave => !leave.period || leave.period === 'full')) return 1;
  return (leaves.some(leave => leave.period === 'am') ? .5 : 0) + (leaves.some(leave => leave.period === 'pm') ? .5 : 0);
}
export function mergeMemberLeaves(current: MemberLeave[], incoming: MemberLeave[]): MemberLeave[] {
  const result = current.map(leave => ({ ...leave }));
  for (const leave of incoming) {
    const index = result.findIndex(existing => existing.date === leave.date);
    if (index < 0) { result.push({ ...leave }); continue; }
    const existing = result[index];
    if (!existing.period || existing.period === 'full' || existing.period === leave.period) continue;
    if (!leave.period || leave.period === 'full' || existing.period !== leave.period) {
      result[index] = { date: leave.date, label: existing.label === leave.label ? existing.label : existing.label + ' / ' + leave.label, period: 'full' };
    }
  }
  return result.sort((a, b) => a.date.localeCompare(b.date));
}

export function totalLeaveDays(leaves: MemberLeave[]): number {
  return [...new Set(leaves.map(leave => leave.date))].reduce((sum, date) => sum + leaveDayFraction(leaves.filter(leave => leave.date === date)), 0);
}
