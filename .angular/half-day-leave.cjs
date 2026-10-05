const fs=require('fs');let p='src/app/core/models/task.model.ts',s=fs.readFileSync(p,'utf8');s=s.replace('export interface MemberLeave {','export type LeavePeriod = \'full\' | \'am\' | \'pm\';\n\nexport interface MemberLeave {').replace('  date: string;\n  label: string;','  date: string;\n  label: string;\n  period?: LeavePeriod;');fs.writeFileSync(p,s);
fs.writeFileSync('src/app/core/utils/leave-utils.ts',`import { MemberLeave } from '../models/task.model';
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
`);
p='src/app/core/services/tasks.service.ts';s=fs.readFileSync(p,'utf8');s="import { leaveDayFraction, mergeMemberLeaves } from '../utils/leave-utils';\n"+s;
const start=s.indexOf('    const member = this.members()',s.indexOf('  async addLeave('));const end=s.indexOf('\n  }',start);s=s.slice(0,start)+`    const ref = doc(this.firestore, 'members', memberId);
    await runTransaction(this.firestore, async transaction => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists()) throw new Error('メンバーが見つかりません');
      const current = (snapshot.data()['leaves'] ?? []) as MemberLeave[];
      transaction.update(ref, { leaves: mergeMemberLeaves(current, leaves) });
    });`+s.slice(end);
s=s.replace("if (holidays.some((h) => h.date === dateStr) || leaves.some((l) => l.date === dateStr)) {\n        workingDays--;\n      }", "if (holidays.some((h) => h.date === dateStr)) {\n        workingDays--;\n      } else {\n        workingDays -= leaveDayFraction(leaves.filter(leave => leave.date === dateStr));\n      }");fs.writeFileSync(p,s);
p='src/app/features/settings/settings.ts';s=fs.readFileSync(p,'utf8').replace('TaskTemplate, MemberLeave','TaskTemplate, MemberLeave, LeavePeriod');s="import { leavePeriodLabel } from '../../core/utils/leave-utils';\n"+s;s=s.replace("  newLeaveLabel = '有給';", "  newLeaveLabel = '有給';\n  newLeavePeriod: LeavePeriod = 'full';\n  readonly leavePeriodLabel = leavePeriodLabel;");s=s.replace("  memberLeaveLabel = '有給';", "  memberLeaveLabel = '有給';\n  memberLeavePeriod: LeavePeriod = 'full';");
s=s.replace('    const end = this.newLeaveEndDate || start;', "    const end = this.newLeaveEndDate || start;\n    if (this.newLeavePeriod !== 'full' && end !== start) {\n      this.notificationService.show('入力エラー', '半休は開始日と終了日を同じ日にしてください');\n      return;\n    }");s=s.replace('    const end = this.memberLeaveEndDate || this.memberLeaveStartDate;', "    const end = this.memberLeaveEndDate || this.memberLeaveStartDate;\n    if (this.memberLeavePeriod !== 'full' && end !== this.memberLeaveStartDate) {\n      this.notificationService.show('入力エラー', '半休は開始日と終了日を同じ日にしてください');\n      return;\n    }");
let count=0;s=s.replaceAll('dates.map((d) => ({ date: d, label }))',()=>{count++;return `dates.map((d) => ({ date: d, label, ...(this.${count===1?'newLeavePeriod':'memberLeavePeriod'} === 'full' ? {} : { period: this.${count===1?'newLeavePeriod':'memberLeavePeriod'} }) }))`;});s=s.replace("      this.newLeaveLabel = '有給';","      this.newLeaveLabel = '有給';\n      this.newLeavePeriod = 'full';");s=s.replace("    this.memberLeaveLabel = '有給';","    this.memberLeaveLabel = '有給';\n    this.memberLeavePeriod = 'full';");s=s.replace('    if (dates.length === 0) return;',"    if (dates.length === 0) {\n      this.notificationService.show('入力エラー', '開始日・終了日を確認し、平日を含む期間を指定してください');\n      return;\n    }");fs.writeFileSync(p,s);
p='src/app/features/settings/settings.html';s=fs.readFileSync(p,'utf8');s=s.replaceAll("{{ leave.label || '休暇' }}", "{{ leave.label || '休暇' }}（{{ leavePeriodLabel(leave) }}）");for(const [key,state] of [['newLeaveLabel','newLeavePeriod'],['memberLeaveLabel','memberLeavePeriod']]){const re=new RegExp('(<input\\s+type="text"\\s+\\[\\(ngModel\\)\\]="'+key+'"[\\s\\S]*?\\/>)','g');s=s.replace(re,`$1\n<select class="leave-period-select" [(ngModel)]="${state}" aria-label="休暇区分"><option value="full">全日</option><option value="am">午前休</option><option value="pm">午後休</option></select>`);}s=s.replace('終了日が空欄の場合は開始日のみ登録します。','終了日が空欄の場合は開始日のみ登録します。半休は単日のみ登録できます。');fs.writeFileSync(p,s);
p='src/app/core/utils/calendar-time-off.ts';s=fs.readFileSync(p,'utf8');s="import { leavePeriodLabel } from './leave-utils';\n"+s;s=s.replace("(leave.label || '休暇')", "(leave.label || '休暇') + (leave.period && leave.period !== 'full' ? '（' + leavePeriodLabel(leave) + '）' : '')");fs.writeFileSync(p,s);
fs.appendFileSync('src/app/features/settings/settings.scss',`\n.leave-settings .leave-period-select, .member-settings .leave-period-select {
  flex: 0 0 auto; min-width: 0; padding: 5px 6px; height: 30px;
  border: 1px solid var(--line); border-radius: 7px; background: var(--card); color: var(--ink); font: inherit; font-size: 12px;
  &:focus { outline: none; border-color: var(--accent); }
}\n`);
