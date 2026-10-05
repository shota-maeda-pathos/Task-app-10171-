const fs=require('fs'),base='src/app/features/settings/';let s=fs.readFileSync(base+'settings.ts','utf8');s=s.replace('  holidayEditorOpen = signal(false);',`  expandedMemberLeaves = signal<ReadonlySet<string>>(new Set());

  toggleMemberLeaves(uid: string): void {
    this.expandedMemberLeaves.update(current => {
      const expanded = new Set(current);
      if (expanded.has(uid)) expanded.delete(uid);
      else expanded.add(uid);
      return expanded;
    });
  }

  holidayEditorOpen = signal(false);`);fs.writeFileSync(base+'settings.ts',s);
s=fs.readFileSync(base+'settings.html','utf8');
const start=`<details class="member-leaves"><summary>休暇 <span>{{ getMemberLeaves(member.uid).length ? getMemberLeaves(member.uid).length + '日' : '未登録' }}</span></summary><div class="member-leave-body">`;
let count=0;
while(s.includes(start)) {
const i=s.indexOf(start),end=s.indexOf('</details>',i);const body=s.slice(i+start.length,end).replace(/<\/div>\s*$/,'');
s=s.slice(0,i)+`<div class="member-leaves">
              <button type="button" class="member-leaves-toggle"
                [attr.aria-expanded]="expandedMemberLeaves().has(member.uid)"
                [attr.aria-controls]="'member-leaves-' + member.uid"
                (click)="toggleMemberLeaves(member.uid)">
                <span>休暇 <span>{{ getMemberLeaves(member.uid).length ? getMemberLeaves(member.uid).length + '日' : '未登録' }}</span></span>
                <span aria-hidden="true">{{ expandedMemberLeaves().has(member.uid) ? '⌃' : '⌄' }}</span>
              </button>
              @if (expandedMemberLeaves().has(member.uid)) {
                <div class="member-leave-body" [id]="'member-leaves-' + member.uid">${body}</div>
              }
            </div>`+s.slice(end+'</details>'.length);count++;
}
if(count!==2)throw Error('Expected two member sections');fs.writeFileSync(base+'settings.html',s);
s=fs.readFileSync(base+'settings.scss','utf8');s=s.replace(/    summary \{\s*display: flex; align-items: center; gap: 8px;[\s\S]*?    &\[open\] summary::after \{ content: '⌃'; \}/,`    .member-leaves-toggle {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      width: 100%; min-height: 36px; padding: 4px 0;
      border: 0; background: transparent; text-align: left;
      font-size: 12px; color: var(--muted);
      &:hover { color: var(--accent); }
    }`);fs.writeFileSync(base+'settings.scss',s);
s=fs.readFileSync(base+'settings.spec.ts','utf8').replaceAll('.member-row.cdk-drag summary','.member-row.cdk-drag .member-leaves-toggle');
s=s.replace("    click('.member-row.cdk-drag .leave-remove-btn');", "    click('.member-row.cdk-drag .member-leaves-toggle'); await fixture.whenStable();\n    click('.member-row.cdk-drag .leave-remove-btn');");
const test=`  it('opens and closes pinned and draggable member leaves independently', async () => {
    const rows = fixture.nativeElement.querySelectorAll('.member-row');
    for (const row of rows) {
      const toggle = row.querySelector('.member-leaves-toggle');
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(row.querySelector('.member-leave-body')).toBeNull();
      toggle.click(); await fixture.whenStable();
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(row.querySelector('.member-leave-body')).toBeTruthy();
    }
    rows[0].querySelector('.member-leaves-toggle').click(); await fixture.whenStable();
    expect(rows[0].querySelector('.member-leave-body')).toBeNull();
    expect(rows[1].querySelector('.member-leave-body')).toBeTruthy();
  });
`;
s=s.replace("  it('opens and submits another member leave form'",test+"  it('opens and submits another member leave form'");fs.writeFileSync(base+'settings.spec.ts',s);
