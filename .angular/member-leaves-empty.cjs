const fs=require('fs'),base='src/app/features/settings/';let s=fs.readFileSync(base+'settings.html','utf8');s=s.replaceAll('              <button type="button" class="member-leaves-toggle"','              @if (getMemberLeaves(member.uid).length > 0) {\n              <button type="button" class="member-leaves-toggle"');s=s.replaceAll("{{ getMemberLeaves(member.uid).length ? getMemberLeaves(member.uid).length + '日' : '未登録' }}","{{ getMemberLeaves(member.uid).length }}日");s=s.replaceAll('              @if (expandedMemberLeaves().has(member.uid)) {','              }\n              @if (getMemberLeaves(member.uid).length === 0 || expandedMemberLeaves().has(member.uid)) {');fs.writeFileSync(base+'settings.html',s);
s=fs.readFileSync(base+'settings.spec.ts','utf8');const t=`  it('shows direct add for empty leaves and switches to collapse after registration', async () => {
    tasks.members.set([ { ...member('self'), leaves: [] }, { ...member('other'), leaves: [] } ]);
    await fixture.whenStable();
    const rows = fixture.nativeElement.querySelectorAll('.member-row');
    for (const row of rows) {
      expect(row.querySelector('.member-leaves-toggle')).toBeNull();
      expect(row.querySelector('.add-leave-btn')).toBeTruthy();
    }
    tasks.addLeave.mockImplementation(async (uid: string, leaves: any[]) => {
      tasks.members.update((members: any[]) => members.map(m => m.uid === uid ? { ...m, leaves } : m));
    });
    click('.member-row.cdk-drag .add-leave-btn'); await fixture.whenStable();
    expect(rows[1].querySelector('.member-leave-add-form')).toBeTruthy();
    click('.member-row.cdk-drag .cancel-btn-sm'); await fixture.whenStable();
    expect(rows[1].querySelector('.member-leave-add-form')).toBeNull();
    click('.member-row.cdk-drag .add-leave-btn'); await fixture.whenStable();
    await input('.member-row.cdk-drag [aria-label="開始日"]', '2026-10-07');
    click('.member-row.cdk-drag .add-btn'); await fixture.whenStable();
    expect(rows[1].querySelector('.member-leaves-toggle').getAttribute('aria-expanded')).toBe('false');
    expect(rows[1].querySelector('.member-leave-body')).toBeNull();
    click('.member-row.cdk-drag .member-leaves-toggle'); await fixture.whenStable();
    expect(rows[1].querySelector('.member-leave-row')).toBeTruthy();
    tasks.members.set([{ ...member('self'), leaves: [] }, { ...member('other'), leaves: [] }]);
    await fixture.whenStable();
    expect(rows[1].querySelector('.member-leaves-toggle')).toBeNull();
    expect(rows[1].querySelector('.add-leave-btn')).toBeTruthy();
  });
`;
s=s.replace("  it('opens and submits another member leave form'",t+"  it('opens and submits another member leave form'");fs.writeFileSync(base+'settings.spec.ts',s);
