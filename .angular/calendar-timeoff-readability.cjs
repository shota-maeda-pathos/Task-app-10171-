const fs=require('fs');for(const feature of ['my-tasks','dashboard']) {
 const base='src/app/features/'+feature+'/'+feature;let s=fs.readFileSync(base+'.ts','utf8');s=s.replace('  readonly isCalendarHoliday =', '  selectedTimeOffDay = signal<CalendarDay | null>(null);\n\n  readonly isCalendarHoliday =');fs.writeFileSync(base+'.ts',s);
 s=fs.readFileSync(base+'.html','utf8');s=s.replace(/                  @for \(entry of day.timeOff; track entry.id\) \{\s*<div class="cal-time-off"[^\n]*\n\s*\}/,`                  @let holidayCount = day.timeOff.filter(isCalendarHoliday).length;
                  @let leaveCount = day.timeOff.length - holidayCount;
                  @if (holidayCount > 0) {
                    <button type="button" class="cal-time-off holiday" (click)="selectedTimeOffDay.set(day); $event.stopPropagation()" [attr.aria-label]="(day.date | date:'M月d日') + 'の休日を表示'">休日</button>
                  }
                  @if (leaveCount > 0) {
                    <button type="button" class="cal-time-off" (click)="selectedTimeOffDay.set(day); $event.stopPropagation()" [attr.aria-label]="(day.date | date:'M月d日') + 'の休暇を表示'">休暇${feature==='dashboard'?"{{ leaveCount > 1 ? ' ' + leaveCount + '人' : '' }}":''}</button>
                  }`);
 s+=`\n@if (selectedTimeOffDay(); as day) {
  <div class="time-off-overlay" (click)="selectedTimeOffDay.set(null)" (keydown.escape)="selectedTimeOffDay.set(null)">
    <section class="time-off-dialog" role="dialog" aria-modal="true" aria-labelledby="time-off-title" (click)="$event.stopPropagation()">
      <div class="time-off-heading">
        <h3 id="time-off-title">{{ day.date | date:'M月d日' }}の休日・休暇</h3>
        <button type="button" (click)="selectedTimeOffDay.set(null)" aria-label="閉じる" autofocus>×</button>
      </div>
      @for (entry of day.timeOff; track entry.id) {
        <div class="time-off-detail" [class.holiday]="entry.kind === 'holiday'">
          <span class="time-off-kind">{{ entry.kind === 'holiday' ? '休日' : '休暇' }}</span>
          <span>{{ entry.label }}</span>
        </div>
      }
    </section>
  </div>
}\n`;fs.writeFileSync(base+'.html',s);
 s=fs.readFileSync(base+'.scss','utf8');const i=s.indexOf('/* 休日・休暇は締切タスクと区別して表示 */');s=s.slice(0,i)+`/* 休日・休暇は短いラベルで表示し、クリックで詳細を確認 */
.cal-time-off {
  display: block; width: 100%; padding: 2px 3px; margin-bottom: 2px;
  border: 1px solid rgba(var(--accent-rgb), .18); border-radius: 3px;
  font: inherit; font-size: 9px; line-height: 1.4; text-align: left;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer;
  background: rgba(var(--accent-rgb), .08); color: var(--accent);
  &.holiday { background: rgba(var(--danger-rgb), .06); color: var(--danger); border-color: rgba(var(--danger-rgb), .18); }
  &:hover { filter: brightness(.95); }
  &:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
}
.cal-cell.has-holiday .cal-day { color: var(--danger); }
.time-off-overlay { position: fixed; inset: 0; z-index: 200; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; padding: 16px; }
.time-off-dialog { width: 360px; max-width: 100%; max-height: 80vh; overflow-y: auto; background: var(--card); color: var(--ink); padding: 18px; border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 12px 40px rgba(var(--ink-rgb), .15); }
.time-off-heading {
  display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px;
  h3 { margin: 0; font-size: 15px; }
  button { width: 32px; height: 32px; background: transparent; border: 1px solid var(--line); border-radius: 7px; color: var(--muted); cursor: pointer; font-size: 18px; }
}
.time-off-detail {
  display: flex; align-items: baseline; gap: 10px; padding: 10px 0; border-top: 1px solid var(--line); font-size: 13px; overflow-wrap: anywhere;
  .time-off-kind { color: var(--accent); font-size: 11px; flex-shrink: 0; }
  &.holiday .time-off-kind { color: var(--danger); }
}
`;fs.writeFileSync(base+'.scss',s);
}
