const fs=require('fs');fs.writeFileSync('src/app/core/utils/calendar-time-off.ts',`import { Member, TeamHoliday } from '../models/task.model';

export interface CalendarTimeOff {
  id: string;
  kind: 'holiday' | 'leave';
  label: string;
}

export function buildCalendarTimeOff(holidays: TeamHoliday[], members: Member[], memberId?: string): Map<string, CalendarTimeOff[]> {
  const result = new Map<string, CalendarTimeOff[]>();
  const add = (date: string, entry: CalendarTimeOff) => {
    const entries = result.get(date) ?? [];
    if (!entries.some(existing => existing.id === entry.id)) entries.push(entry);
    result.set(date, entries);
  };
  for (const holiday of holidays) {
    add(holiday.date, { id: 'holiday:' + holiday.date, kind: 'holiday', label: '休日：' + holiday.name });
  }
  for (const member of members) {
    if (memberId !== undefined && member.uid !== memberId) continue;
    for (const leave of member.leaves ?? []) {
      add(leave.date, { id: 'leave:' + member.uid + ':' + leave.date, kind: 'leave', label: (memberId === undefined ? member.name + '：' : '休暇：') + (leave.label || '休暇') });
    }
  }
  return result;
}
`);
let s=fs.readFileSync('src/app/features/board/board.component.html','utf8');for(const name of ['myWorkingDays','otherWorkingDays'])s=s.replace(`<span class="working-days-badge">{{ ${name} }}日/5日</span>`,`<span class="working-days-badge" title="今週の平日5日から、チーム休日・本人の休暇を除いた稼働日数">今週の稼働 {{ ${name} }}日</span>`);fs.writeFileSync('src/app/features/board/board.component.html',s);
for(const feature of ['my-tasks','dashboard']) {
 const base='src/app/features/'+feature+'/'+feature;
 s=fs.readFileSync(base+'.ts','utf8');s=`import { buildCalendarTimeOff, CalendarTimeOff } from '../../core/utils/calendar-time-off';\n`+s;
 // Both calendar day interfaces use the same task array field.
 const interfaceIndex=s.indexOf('interface CalendarDay');if(interfaceIndex<0)throw Error('CalendarDay missing');const close=s.indexOf('}',interfaceIndex);
 s=s.slice(0,close)+'  timeOff: CalendarTimeOff[];\n'+s.slice(close);
 const index=s.indexOf('  calendarMonths = computed(() => {');
 const marker='    const now = new Date();';const now=s.indexOf(marker,index);
 const extra=feature==='my-tasks'?"\n    const uid = this.auth.currentUser()?.uid ?? '';\n    const timeOff = buildCalendarTimeOff(this.tasksService.teamSettings()?.holidays ?? [], this.tasksService.members(), uid);":"\n    const timeOff = buildCalendarTimeOff(this.tasksService.teamSettings()?.holidays ?? [], this.tasksService.members());";
 s=s.slice(0,now+marker.length)+extra+s.slice(now+marker.length);
 const push=feature==='my-tasks'?'days.push({ date, day: d, isToday, tasks: dayTasks });':'days.push({ date, day: d, isToday, tasks });';
 s=s.replace(push,push.replace(' });',", timeOff: timeOff.get(formatDateString(date)) ?? [] });"));
 s=s.replace("import { getForecastWeekLabels, getWeekMonday }", "import { formatDateString, getForecastWeekLabels, getWeekMonday }");
 fs.writeFileSync(base+'.ts',s);
 s=fs.readFileSync(base+'.html','utf8');s=s.replace('[class.has-tasks]="day.tasks.length > 0"','[class.has-tasks]="day.tasks.length > 0"\n                  [class.has-holiday]="day.timeOff.some(isCalendarHoliday)"');
 const anchor='<div class="cal-day">{{ day.day }}</div>';
 s=s.replace(anchor,anchor+`\n                  @for (entry of day.timeOff; track entry.id) {
                    <div class="cal-time-off" [class.holiday]="entry.kind === 'holiday'" [title]="entry.label">{{ entry.label }}</div>
                  }`);fs.writeFileSync(base+'.html',s);
 s=fs.readFileSync(base+'.ts','utf8');s=s.replace('  calendarMonths = computed(() => {',"  readonly isCalendarHoliday = (entry: CalendarTimeOff) => entry.kind === 'holiday';\n\n  calendarMonths = computed(() => {");fs.writeFileSync(base+'.ts',s);
 fs.appendFileSync(base+'.scss',`\n/* 休日・休暇は締切タスクと区別して表示 */
.cal-time-off {
  padding: 2px 3px; margin-bottom: 2px; border-radius: 3px;
  font-size: 9px; line-height: 1.4; overflow-wrap: anywhere;
  background: rgba(var(--accent-rgb), .1); color: var(--accent);
  border-left: 2px solid var(--accent);
  &.holiday { background: rgba(var(--danger-rgb), .08); color: var(--danger); border-left-color: var(--danger); }
}
.cal-cell.has-holiday .cal-day { color: var(--danger); }
`);
}
