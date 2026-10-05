const fs=require('fs'),base='src/app/features/settings/';let s=fs.readFileSync(base+'settings.ts','utf8');s=s.replace('  holidayEditorOpen = signal(false);','  teamHolidaysExpanded = signal(true);\n  myLeavesExpanded = signal(true);\n\n  holidayEditorOpen = signal(false);');fs.writeFileSync(base+'settings.ts',s);
s=fs.readFileSync(base+'settings.html','utf8');for(const [title,state,id] of [['チーム休日','teamHolidaysExpanded','team-holidays-body'],['自分の休暇','myLeavesExpanded','my-leaves-body']]) {
 const titleIndex=s.indexOf('<h3>'+title);const headingStart=s.lastIndexOf('<div class="leave-card-heading">',titleIndex);const headingEnd=s.indexOf('</div>',titleIndex)+6;const sectionEnd=s.indexOf('</section>',headingEnd);
 const heading=s.slice(headingStart,headingEnd);const headingInner=heading.slice('<div class="leave-card-heading">'.length,-6);
 const next=`<div class="leave-card-heading leave-collapse-heading"><div>${headingInner}</div>
      <button type="button" class="leave-collapse-btn" [attr.aria-expanded]="${state}()" aria-controls="${id}" [attr.aria-label]="${state}() ? '${title}を折りたたむ' : '${title}を開く'" (click)="${state}.update(open => !open)">
        <span class="leave-collapse-arrow" [class.closed]="!${state}()" aria-hidden="true">▴</span>
      </button>
    </div>
    @if (${state}()) {
      <div id="${id}">${s.slice(headingEnd,sectionEnd)}</div>
    }
    `;
 s=s.slice(0,headingStart)+next+s.slice(sectionEnd);
}fs.writeFileSync(base+'settings.html',s);
fs.appendFileSync(base+'settings.scss',`\n.leave-collapse-heading {
  display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 0;
  & + div { margin-top: 16px; }
}
.leave-collapse-btn {
  width: 28px; height: 28px; flex: 0 0 28px; display: flex; align-items: center; justify-content: center;
  border: 1px solid var(--line); border-radius: 6px; background: var(--card); color: var(--ink);
  font-size: 14px; cursor: pointer; transition: color .15s, border-color .15s, background .15s;
  &:hover { color: var(--accent); border-color: var(--accent); background: rgba(var(--accent-rgb), .06); }
}
.leave-collapse-arrow {
  display: inline-block; transition: transform .2s; line-height: 1;
  &.closed { transform: rotate(180deg); }
}\n`);
s=fs.readFileSync(base+'settings.spec.ts','utf8');s=s.replace("  it('imports only selected year",`  it('collapses holiday and own leave cards independently and preserves draft inputs', async () => {
    const buttons = fixture.nativeElement.querySelectorAll('.leave-collapse-btn');
    click('#team-holidays-body .leave-editor-toggle'); await fixture.whenStable();
    await input('[aria-label="休日名"]', '会社休日');
    buttons[0].click(); await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('#team-holidays-body')).toBeNull();
    expect(fixture.nativeElement.querySelector('#my-leaves-body')).toBeTruthy();
    expect(buttons[0].getAttribute('aria-expanded')).toBe('false');
    buttons[0].click(); await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('#team-holidays-body [aria-label="休日名"]').value).toBe('会社休日');
    buttons[1].click(); await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('#my-leaves-body')).toBeNull();
    expect(fixture.nativeElement.querySelector('#team-holidays-body')).toBeTruthy();
    buttons[1].click(); await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('#my-leaves-body')).toBeTruthy();
  });
  it('imports only selected year`);fs.writeFileSync(base+'settings.spec.ts',s);
