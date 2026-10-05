const fs=require('fs');let p='src/app/features/settings/settings.ts',s=fs.readFileSync(p,'utf8');s=s.replace('teamHolidaysExpanded = signal(true)','teamHolidaysExpanded = signal(false)').replace('myLeavesExpanded = signal(true)','myLeavesExpanded = signal(false)');fs.writeFileSync(p,s);
p='src/app/features/settings/settings.spec.ts';s=fs.readFileSync(p,'utf8');const anchor='    fixture = TestBed.createComponent(SettingsComponent);\n    await fixture.whenStable();';s=s.replace(anchor,anchor+`\n    expect(fixture.nativeElement.querySelector('#team-holidays-body')).toBeNull();
    expect(fixture.nativeElement.querySelector('#my-leaves-body')).toBeNull();
    const toggles = fixture.nativeElement.querySelectorAll('.leave-collapse-btn');
    for (const toggle of toggles) {
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      toggle.click();
    }
    await fixture.whenStable();`);fs.writeFileSync(p,s);
