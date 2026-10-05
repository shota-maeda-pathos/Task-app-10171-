import { MemberLeave, Member } from '../models/task.model';
import { TasksService } from '../services/tasks.service';
import { formatDateString, getWeekMonday } from './week-utils';
import { leaveDayFraction, mergeMemberLeaves, totalLeaveDays } from './leave-utils';
import { buildCalendarTimeOff } from './calendar-time-off';
describe('half-day leave', () => {
  it('treats legacy leaves as full days and counts half days without duplicates', () => {
    expect(leaveDayFraction([{ date: '2026-10-05', label: '有給' }])).toBe(1);
    expect(leaveDayFraction([{ date: '2026-10-05', label: '有給', period: 'am' }])).toBe(.5);
    expect(totalLeaveDays([{ date: '2026-10-05', label: '有給', period: 'am' }, { date: '2026-10-05', label: '有給', period: 'am' }, { date: '2026-10-06', label: '有給', period: 'pm' }])).toBe(1);
  });
  it('merges opposite half days into one full day and preserves legacy full leave', () => {
    const am: MemberLeave = { date: '2026-10-05', label: '有給', period: 'am' };
    expect(mergeMemberLeaves([am], [{ ...am, period: 'pm' }])).toEqual([{ ...am, period: 'full' }]);
    expect(mergeMemberLeaves([am], [am])).toEqual([am]);
    const legacy = { date: am.date, label: '既存休暇' };
    expect(mergeMemberLeaves([legacy], [am])).toEqual([legacy]);
  });
  it('adjusts weekly capacity by half a day and avoids double subtraction on holidays', () => {
    const date = formatDateString(getWeekMonday(new Date()));
    const member = { uid: 'self', weeklyCapacityHours: 40, leaves: [{ date, label: '有給', period: 'am' }] } as Member;
    const context = { members: () => [member], teamSettings: () => ({ holidays: [] }), getMemberFocusHours: () => 36, getWorkingDays: TasksService.prototype.getWorkingDays } as unknown as TasksService;
    expect(context.getWorkingDays('self', 0)).toBe(4.5);
    expect(TasksService.prototype.getFocusLoadPercent.call(context, 'self')).toBe(100);
    context.teamSettings = (() => ({ holidays: [{ date, name: '休日' }] })) as any;
    expect(context.getWorkingDays('self', 0)).toBe(4);
  });
  it('shows half-day labels in both personal and team calendars', () => {
    const member = { uid: 'self', name: '本人', leaves: [{ date: '2026-10-05', label: '有給', period: 'pm' }] } as Member;
    expect(buildCalendarTimeOff([], [member], 'self').get('2026-10-05')![0].label).toBe('休暇：有給（午後休）');
    expect(buildCalendarTimeOff([], [member]).get('2026-10-05')![0].label).toBe('本人：有給（午後休）');
  });
});
