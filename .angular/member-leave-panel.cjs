const fs=require('fs'),p='src/app/features/settings/settings.html';let s=fs.readFileSync(p,'utf8');const marker='<div class="member-leave-add-form">';let pos=0,count=0;
const form=`<div class="member-leave-add-form member-leave-panel">
  <h4 class="member-leave-form-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18"/></svg>休暇を追加</h4>
  <div class="member-leave-dates">
    <label class="member-leave-field"><span>開始日 <small>必須</small></span><input type="date" [(ngModel)]="memberLeaveStartDate" aria-label="開始日" class="holiday-date-input" (click)="$any($event.target).showPicker?.()" /></label>
    <span class="date-separator" aria-hidden="true">〜</span>
    <label class="member-leave-field"><span>終了日</span><input type="date" [(ngModel)]="memberLeaveEndDate" aria-label="終了日（空欄なら開始日のみ）" class="holiday-date-input" (click)="$any($event.target).showPicker?.()" /></label>
  </div>
  <div class="member-leave-description">
    <label class="member-leave-field"><span>休暇名</span><input type="text" [(ngModel)]="memberLeaveLabel" aria-label="休暇名" placeholder="有給" class="holiday-name-input" /></label>
    <div class="member-leave-field"><span>取得単位</span>
      <div class="leave-period-menu">
        <button type="button" class="leave-period-control" aria-label="休暇区分" aria-haspopup="true" [attr.aria-expanded]="leavePeriodMenu() === member.uid" (click)="leavePeriodMenu.set(leavePeriodMenu() === member.uid ? null : member.uid)">{{ periodName(memberLeavePeriod) }} <span aria-hidden="true">▾</span></button>
        @if (leavePeriodMenu() === member.uid) {
          <div class="leave-period-options" role="group" aria-label="休暇区分の選択肢">
            @for (option of leavePeriodOptions; track option.value) {
              <button type="button" [class.selected]="memberLeavePeriod === option.value" [attr.aria-pressed]="memberLeavePeriod === option.value" (click)="selectLeavePeriod(member.uid, option.value)">{{ option.label }}</button>
            }
          </div>
        }
      </div>
    </div>
  </div>
  <p class="member-leave-form-hint">終了日が空欄の場合は開始日のみ登録します。半休は単日のみ選択できます。</p>
  <div class="member-leave-form-footer">
    <span>{{ memberLeaveStartDate ? '日付と取得単位を確認してください' : '期間を選択してください' }}</span>
    <div class="member-leave-form-actions">
      <button type="button" class="cancel-btn-sm" aria-label="休暇の追加をキャンセル" (click)="addMemberLeaveTarget = null; leavePeriodMenu.set(null)">キャンセル</button>
      <button type="button" class="add-btn" [disabled]="!memberLeaveStartDate" (click)="addMemberLeave()">追加する</button>
    </div>
  </div>
</div>`;
while((pos=s.indexOf(marker,pos))>=0){let re=/<div\b[^>]*>|<\/div>/g;re.lastIndex=pos;let depth=0,end=pos,m;while((m=re.exec(s))){depth+=m[0].startsWith('</')?-1:1;if(depth===0){end=re.lastIndex;break;}}s=s.slice(0,pos)+form+s.slice(end);pos+=form.length;count++;}if(count!==2)throw Error('Expected two forms');fs.writeFileSync(p,s);
fs.appendFileSync('src/app/features/settings/settings.scss',`\n/* メンバーの休暇追加フォーム */
.member-settings .member-leaves .member-leave-add-form.member-leave-panel {
  display: block; width: 100%; box-sizing: border-box; margin-top: 6px; padding: 18px;
  border: 1px solid rgba(var(--accent-rgb), .18); border-radius: 9px; background: rgba(var(--accent-rgb), .035);
  .member-leave-form-title { display: flex; align-items: center; gap: 8px; margin: 0 0 18px; font-size: 13px; font-weight: 600; color: var(--ink); }
  .member-leave-form-title svg { width: 16px; height: 16px; color: var(--muted); }
  .member-leave-dates { display: grid; grid-template-columns: minmax(0, 1fr) 16px minmax(0, 1fr); gap: 12px; align-items: end; }
  .date-separator { display: block; padding-bottom: 11px; text-align: center; color: var(--muted); }
  .member-leave-description { display: grid; grid-template-columns: minmax(0, 1fr) 140px; gap: 12px; margin-top: 14px; }
  .member-leave-field { display: flex; flex-direction: column; min-width: 0; gap: 7px; font-size: 12px; color: var(--ink); }
  .member-leave-field small { margin-left: 4px; font-size: 10px; color: var(--muted); }
  input, .leave-period-control { width: 100%; min-height: 40px; height: 40px; padding: 9px 12px; box-sizing: border-box; font-size: 13px; background: var(--card); border: 1px solid var(--line); border-radius: 7px; color: var(--ink); }
  input:focus, .leave-period-control:focus-visible { outline: none; border-color: var(--accent); }
  .leave-period-control { justify-content: space-between; }
  .member-leave-form-hint { margin: 7px 0 0; font-size: 11px; color: var(--muted); line-height: 1.6; }
  .member-leave-form-footer { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--line); }
  .member-leave-form-footer > span { font-size: 11px; color: var(--muted); }
  .member-leave-form-actions { display: flex; gap: 8px; margin-left: auto; }
  .add-btn, .cancel-btn-sm { min-height: 38px; padding: 8px 12px; font-size: 13px; }
}
@media (max-width: 480px) {
  .member-settings .member-leaves .member-leave-add-form.member-leave-panel {
    padding: 14px;
    .member-leave-dates { grid-template-columns: minmax(0, 1fr); gap: 12px; }
    .date-separator { display: none; }
    .member-leave-description { grid-template-columns: minmax(0, 1fr); }
  }
}\n`);
