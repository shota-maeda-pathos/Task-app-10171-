const fs=require('fs');
const p='src/app/features/settings/settings.html';let s=fs.readFileSync(p,'utf8');fs.writeFileSync('.angular/settings-ui-before.html',s);fs.copyFileSync('src/app/features/settings/settings.scss','.angular/settings-ui-before.scss');
let a=s.indexOf('  <!-- 祝日・休暇 -->'),b=s.indexOf('  <!-- タスクテンプレート -->');let h=s.slice(a,b).replace('class="section"','class="section leave-settings"');
h=h.replace('    <h3 class="subsection-title">チーム祝日</h3>','    <section class="leave-card"><div class="leave-card-heading"><h3>チーム休日 <span class="leave-count">{{ teamHolidays().length }}日</span></h3>');
h=h.replace('<p class="section-desc">チーム全体の祝日を登録すると、負荷計算から除外されます。</p>','<p>チーム全員の負荷計算から除外する日です。</p></div>');
h=h.replace('    <h3 class="subsection-title" style="margin-top: 20px">自分の休暇</h3>','    </section><section class="leave-card"><div class="leave-card-heading"><h3>自分の休暇 <span class="leave-count">{{ myLeaves().length }}日</span></h3><p>あなたの負荷計算から除外する日です。</p></div>');
for(const [kind,label,fn] of [['holiday','全員','removeHoliday'],['leave','休暇','removeMyLeave']]){
h=h.replace(`<div class="holiday-row">\r\n        <span class="holiday-date">{{ formatHolidayDate(${kind}.date) }}</span>\r\n        <span class="holiday-name">{{ ${kind==='holiday'?'holiday.name':"leave.label || '休暇'"} }}</span>`, `<div class="leave-entry"><span class="leave-date-tile"><strong>{{ ${kind}.date.slice(5).replace('-', '/') }}</strong><span>{{ ${kind}.date.slice(0, 4) }}年</span></span><div class="leave-entry-info"><strong>{{ ${kind==='holiday'?'holiday.name':"leave.label || '休暇'"} }}</strong><span>{{ formatHolidayDate(${kind}.date) }}</span></div><span class="leave-kind">${label}</span>`);
h=h.replace(`<button class="delete-btn" (click)="${fn}(${kind}.date)">削除</button>`,`<button class="leave-remove" (click)="${fn}(${kind}.date)" [attr.aria-label]="formatHolidayDate(${kind}.date) + 'の${label}を削除'">×</button>`);
}
h=h.replace('<div class="empty-note">祝日はまだ登録されていません</div>','<div class="leave-empty"><strong>チーム休日はまだ登録されていません</strong><p>祝日や会社の休業日を登録できます。</p></div>').replace('<div class="empty-note">休暇はまだ登録されていません</div>','<div class="leave-empty"><strong>休暇はまだ登録されていません</strong><p>取得予定の休暇を追加しましょう。</p></div>');
h=h.replace(/<div class="holiday-add-form">([\s\S]*?)<\/div>/g,(all,body)=>`<details class="leave-editor"><summary>＋ ${body.includes('newHolidayDate')?'休日':'休暇'}を追加</summary><div class="holiday-add-form">${body}</div></details>`);
for(const [key,label] of [['newHolidayDate','日付'],['newHolidayName','休日名'],['newLeaveStartDate','開始日'],['newLeaveEndDate','終了日（空欄なら開始日のみ）'],['newLeaveLabel','休暇名']]) h=h.replace(`[(ngModel)]="${key}"`,`[(ngModel)]="${key}" aria-label="${label}"`);
h=h.replace('holidayDateRef.showPicker()','holidayDateRef.showPicker?.()').replace('leaveStartRef.showPicker()','leaveStartRef.showPicker?.()').replace('leaveEndRef.showPicker()','leaveEndRef.showPicker?.()');
h=h.replace(/\s*<\/div>\s*$/, '\n    <p class="leave-hint">連続する休暇は開始日と終了日を指定して登録できます（平日のみ）。終了日が空欄の場合は開始日のみ登録します。</p></section>\n  </div>\n\n');
s=s.slice(0,a)+h+s.slice(b);
a=s.indexOf('  <!-- メンバー管理');b=s.indexOf('\n@if (deletingMember)');let m=s.slice(a,b).replace('class="section"','class="section member-settings"');
m=m.replace('      <div\r\n        class="member-list"','      <p class="section-desc">メンバーの基本情報と休暇を管理します。</p>\r\n      <div\r\n        class="member-list"');
m=m.replaceAll('<div class="member-leaves">',`<details class="member-leaves"><summary>休暇 <span>{{ getMemberLeaves(member.uid).length ? getMemberLeaves(member.uid).length + '日' : '未登録' }}</span></summary><div class="member-leave-body">`);
m=m.replaceAll('            </div>\r\n          </div>','            </div></details>\r\n          </div>');
m=m.replaceAll('class="leave-remove-btn"',`class="leave-remove-btn" [attr.aria-label]="member.name + 'の' + formatHolidayDate(leave.date) + 'の休暇を削除'"`).replaceAll('class="cancel-btn-sm"','class="cancel-btn-sm" aria-label="休暇の追加をキャンセル"');
for(const [key,label] of [['memberLeaveStartDate','開始日'],['memberLeaveEndDate','終了日（空欄なら開始日のみ）'],['memberLeaveLabel','休暇名']]) m=m.replaceAll(`[(ngModel)]="${key}"`,`[(ngModel)]="${key}" aria-label="${label}"`);
s=s.slice(0,a)+m+s.slice(b);fs.writeFileSync(p,s);
