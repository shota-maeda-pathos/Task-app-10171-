const fs=require('fs');let p='src/app/core/utils/leave-utils.ts';fs.appendFileSync(p,`\nexport function totalLeaveDays(leaves: MemberLeave[]): number {
  return [...new Set(leaves.map(leave => leave.date))].reduce((sum, date) => sum + leaveDayFraction(leaves.filter(leave => leave.date === date)), 0);
}\n`);p='src/app/features/settings/settings.ts';let s=fs.readFileSync(p,'utf8').replace('import { leavePeriodLabel }','import { leavePeriodLabel, totalLeaveDays }');s=s.replace('  readonly leavePeriodLabel = leavePeriodLabel;','  readonly leavePeriodLabel = leavePeriodLabel;\n  myLeaveDays = computed(() => totalLeaveDays(this.myLeaves()));\n\n  getMemberLeaveDays(uid: string): number {\n    return totalLeaveDays(this.getMemberLeaves(uid));\n  }');fs.writeFileSync(p,s);p='src/app/features/settings/settings.html';s=fs.readFileSync(p,'utf8').replaceAll('{{ myLeaves().length }}日','{{ myLeaveDays() }}日').replaceAll('{{ getMemberLeaves(member.uid).length }}日','{{ getMemberLeaveDays(member.uid) }}日');fs.writeFileSync(p,s);
fs.writeFileSync('src/app/core/utils/leave-utils.spec.ts',`import { MemberLeave, Member } from '../models/task.model';
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
});\n`);
p='src/app/features/settings/settings.spec.ts';s=fs.readFileSync(p,'utf8');s=s.replace("  it('imports only selected year",`  it('registers own afternoon leave from the UI and rejects half-day ranges', async () => {
    fixture.nativeElement.querySelectorAll('.leave-editor-toggle')[1].click(); await fixture.whenStable();
    await input('#leave-editor-form [aria-label="開始日"]', '2026-10-07');
    const select = fixture.nativeElement.querySelector('#leave-editor-form [aria-label="休暇区分"]');
    select.value = 'pm'; select.dispatchEvent(new Event('change', { bubbles: true })); await fixture.whenStable();
    click('#leave-editor-form .add-btn'); await fixture.whenStable();
    expect(tasks.addLeave).toHaveBeenCalledWith('self', [{ date: '2026-10-07', label: '有給', period: 'pm' }]);
    tasks.addLeave.mockClear();
    fixture.componentInstance.newLeaveStartDate = '2026-10-07';
    fixture.componentInstance.newLeaveEndDate = '2026-10-08';
    fixture.componentInstance.newLeavePeriod = 'am';
    await fixture.componentInstance.addMyLeave();
    expect(tasks.addLeave).not.toHaveBeenCalled();
  });
  it('registers member morning leave and rejects multi-day half leave', async () => {
    fixture.componentInstance.openAddMemberLeave('other');
    fixture.componentInstance.memberLeaveStartDate = '2026-10-07';
    fixture.componentInstance.memberLeavePeriod = 'am';
    await fixture.componentInstance.addMemberLeave();
    expect(tasks.addLeave).toHaveBeenCalledWith('other', [{ date: '2026-10-07', label: '有給', period: 'am' }]);
    tasks.addLeave.mockClear();
    fixture.componentInstance.openAddMemberLeave('other');
    fixture.componentInstance.memberLeaveStartDate = '2026-10-07';
    fixture.componentInstance.memberLeaveEndDate = '2026-10-08';
    fixture.componentInstance.memberLeavePeriod = 'pm';
    await fixture.componentInstance.addMemberLeave();
    expect(tasks.addLeave).not.toHaveBeenCalled();
  });
  it('imports only selected year`);fs.writeFileSync(p,s);
