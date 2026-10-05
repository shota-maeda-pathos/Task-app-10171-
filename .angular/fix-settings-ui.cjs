const fs=require('fs'),p='src/app/features/settings/settings.html';let s=fs.readFileSync(p,'utf8');
s=s.replace(/<div class="holiday-row">\s*<span class="holiday-date">{{ formatHolidayDate\((holiday|leave).date\) }}<\/span>\s*<span class="holiday-name">{{ ([^}]+) }}<\/span>/g,(_,k,n)=>`<div class="leave-entry"><span class="leave-date-tile"><strong>{{ ${k}.date.slice(5).replace('-', '/') }}</strong><span>{{ ${k}.date.slice(0, 4) }}年</span></span><div class="leave-entry-info"><strong>{{ ${n} }}</strong><span>{{ formatHolidayDate(${k}.date) }}</span></div><span class="leave-kind">${k==='holiday'?'全員':'休暇'}</span>`);
s=s.replace("'の全員を削除'","'のチーム休日を削除'");
let a=s.indexOf('  <!-- メンバー管理'),b=s.indexOf('\n@if (deletingMember)');let m=s.slice(a,b);
m=m.replace(/            <\/div>\s*          <\/div>/g,'            </div></details>\n          </div>');
m=m.replace(/      <div\s*class="member-list"/,'      <p class="section-desc">メンバーの基本情報と休暇を管理します。</p>\n      <div class="member-list"');
s=s.slice(0,a)+m+s.slice(b);fs.writeFileSync(p,s);
