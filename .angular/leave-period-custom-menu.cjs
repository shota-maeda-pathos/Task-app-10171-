const fs=require('fs'),base='src/app/features/settings/';let s=fs.readFileSync(base+'settings.ts','utf8');s=s.replace('Component, inject, computed, signal','Component, HostListener, inject, computed, signal');s=s.replace('  newLeavePeriod: LeavePeriod = \'full\';',`  newLeavePeriod: LeavePeriod = 'full';
  leavePeriodMenu = signal<string | null>(null);
  readonly leavePeriodOptions: { value: LeavePeriod; label: string }[] = [
    { value: 'full', label: '全日' }, { value: 'am', label: '午前休' }, { value: 'pm', label: '午後休' },
  ];
  periodName(period: LeavePeriod): string {
    return this.leavePeriodOptions.find(option => option.value === period)?.label ?? '全日';
  }
  selectLeavePeriod(target: string, period: LeavePeriod): void {
    if (target === 'own') this.newLeavePeriod = period;
    else this.memberLeavePeriod = period;
    this.leavePeriodMenu.set(null);
  }
  @HostListener('document:click', ['$event'])
  closeLeavePeriodMenu(event: MouseEvent): void {
    if (!(event.target instanceof Element) || !event.target.closest('.leave-period-menu')) this.leavePeriodMenu.set(null);
  }
  @HostListener('document:keydown.escape')
  dismissLeavePeriodMenu(): void { this.leavePeriodMenu.set(null); }`);fs.writeFileSync(base+'settings.ts',s);
s=fs.readFileSync(base+'settings.html','utf8');for(const [state,key] of [['newLeavePeriod',"'own'"],['memberLeavePeriod','member.uid']]) {
const old=`<select class="leave-period-select" [(ngModel)]="${state}" aria-label="休暇区分"><option value="full">全日</option><option value="am">午前休</option><option value="pm">午後休</option></select>`;
const replacement=`<div class="leave-period-menu">
  <button type="button" class="leave-period-control" aria-label="休暇区分" aria-haspopup="true" [attr.aria-expanded]="leavePeriodMenu() === ${key}" (click)="leavePeriodMenu.set(leavePeriodMenu() === ${key} ? null : ${key})">{{ periodName(${state}) }} <span aria-hidden="true">▾</span></button>
  @if (leavePeriodMenu() === ${key}) {
    <div class="leave-period-options" role="group" aria-label="休暇区分の選択肢">
      @for (option of leavePeriodOptions; track option.value) {
        <button type="button" [class.selected]="${state} === option.value" [attr.aria-pressed]="${state} === option.value" (click)="selectLeavePeriod(${key}, option.value)">{{ option.label }}</button>
      }
    </div>
  }
</div>`;s=s.replaceAll(old,replacement);
}fs.writeFileSync(base+'settings.html',s);
s=fs.readFileSync(base+'settings.scss','utf8');const start=s.indexOf('\n.leave-settings .leave-period-select,');if(start<0)throw Error('Style missing');s=s.slice(0,start)+`\n.leave-period-menu { position: relative; flex: 0 0 auto; }
.leave-period-control {
  display: inline-flex; align-items: center; gap: 5px; padding: 5px 8px; min-height: 30px;
  border: none; background: transparent; color: var(--muted); font: inherit; font-size: 11.5px; cursor: pointer;
  &:hover, &[aria-expanded='true'] { color: var(--accent); background: rgba(var(--accent-rgb), .06); border-radius: 6px; }
}
.leave-period-options {
  position: absolute; top: calc(100% + 6px); right: 0; z-index: 50; min-width: 140px;
  padding: 5px; border: 1px solid var(--line); border-radius: 10px;
  background: var(--card); box-shadow: 0 8px 24px rgba(var(--ink-rgb), .12);
  button { width: 100%; padding: 9px 10px; border: none; background: transparent; color: var(--ink); font: inherit; font-size: 12px; text-align: left; cursor: pointer; }
  button:hover, button.selected { color: var(--accent); }
}\n`;fs.writeFileSync(base+'settings.scss',s);
s=fs.readFileSync(base+'settings.spec.ts','utf8');s=s.replace(`    const select = fixture.nativeElement.querySelector('#leave-editor-form [aria-label="休暇区分"]');
    select.value = 'pm'; select.dispatchEvent(new Event('change', { bubbles: true })); await fixture.whenStable();`,`    click('#leave-editor-form .leave-period-control'); await fixture.whenStable();
    fixture.nativeElement.querySelectorAll('#leave-editor-form .leave-period-options button')[2].click(); await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('#leave-editor-form .leave-period-options')).toBeNull();`);
s=s.replace("  it('imports only selected year",`  it('closes period menu on outside click and Escape', async () => {
    fixture.nativeElement.querySelectorAll('.leave-editor-toggle')[1].click(); await fixture.whenStable();
    click('#leave-editor-form .leave-period-control'); await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.leave-period-options')).toBeTruthy();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.leave-period-options')).toBeNull();
    click('#leave-editor-form .leave-period-control'); await fixture.whenStable();
    document.body.click(); await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.leave-period-options')).toBeNull();
  });
  it('imports only selected year`);fs.writeFileSync(base+'settings.spec.ts',s);
