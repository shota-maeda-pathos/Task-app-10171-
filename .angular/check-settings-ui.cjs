const fs=require('fs'),assert=require('assert');const before=fs.readFileSync('.angular/settings-ui-before.html','utf8'),after=fs.readFileSync('src/app/features/settings/settings.html','utf8');
const a='  <!-- 祝日・休暇 -->',b='  <!-- タスクテンプレート -->',c='  <!-- メンバー管理',d='\n@if (deletingMember)';
assert.equal(before.slice(0,before.indexOf(a)),after.slice(0,after.indexOf(a)));
assert.equal(before.slice(before.indexOf(b),before.indexOf(c)),after.slice(after.indexOf(b),after.indexOf(c)));
assert.equal(before.slice(before.indexOf(d)),after.slice(after.indexOf(d)));
for(const fn of ['addHoliday()','removeHoliday(holiday.date)','addMyLeave()','removeMyLeave(leave.date)','addMemberLeave()','removeMemberLeave(member.uid, leave.date)','reorderMembers($event)','openEdit(member)','openDelete(member)']) assert.equal(before.split(fn).length,after.split(fn).length,fn);
console.log('PASS: 対象外HTMLは一致。登録・削除・編集・並べ替えのイベントを維持。');
