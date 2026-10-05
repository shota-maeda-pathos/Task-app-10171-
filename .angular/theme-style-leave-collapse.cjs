const fs=require('fs'),base='src/app/features/settings/';let s=fs.readFileSync(base+'settings.html','utf8');
for(const [title,state,id,count,desc] of [['チーム休日','teamHolidaysExpanded','team-holidays-body','teamHolidays','チーム全員の負荷計算から除外する日です。'],['自分の休暇','myLeavesExpanded','my-leaves-body','myLeaves','あなたの負荷計算から除外する日です。']]) {
const i=s.indexOf('<div class="leave-card-heading leave-collapse-heading"><div><h3>'+title);if(i<0)throw Error(title);const end=s.indexOf('    @if ('+state+'())',i);
s=s.slice(0,i)+`<button type="button" class="theme-toggle leave-collapse-btn" [attr.aria-expanded]="${state}()" aria-controls="${id}" [attr.aria-label]="${state}() ? '${title}を折りたたむ' : '${title}を開く'" (click)="${state}.update(open => !open)">
      <span class="theme-toggle-text">
        <span class="theme-toggle-label">${title} <span class="leave-count">{{ ${count}().length }}日</span></span>
        <span class="theme-toggle-value">${desc}</span>
      </span>
      <span class="theme-toggle-arrow" [class.open]="${state}()" aria-hidden="true">▾</span>
    </button>
`+s.slice(end);
}
s=s.replaceAll('<section class="leave-card"><button','<section class="leave-card leave-collapsible"><button');fs.writeFileSync(base+'settings.html',s);
s=fs.readFileSync(base+'settings.scss','utf8');const i=s.indexOf('\n.leave-collapse-heading {');s=s.slice(0,i)+`\n.leave-card.leave-collapsible {
  padding: 0;
  .leave-collapse-btn { border: 0; border-radius: 11px; }
  .leave-collapse-btn:hover { box-shadow: inset 0 0 0 1px var(--accent); }
  #team-holidays-body, #my-leaves-body { padding: 0 18px 18px; }
}
@media (max-width: 480px) {
  .leave-card.leave-collapsible {
    .leave-collapse-btn { padding: 14px 16px; }
    #team-holidays-body, #my-leaves-body { padding: 0 16px 16px; }
  }
}\n`;fs.writeFileSync(base+'settings.scss',s);
