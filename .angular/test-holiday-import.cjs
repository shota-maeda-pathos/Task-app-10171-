const fs=require('fs'),p='src/app/features/settings/settings.spec.ts';let s=fs.readFileSync(p,'utf8').replace("import { vi } from 'vitest';","import { vi, afterEach } from 'vitest';");s=s.replace("  const click =", "  afterEach(() => vi.restoreAllMocks());\n  const click =");s=s.replace("  it('opens and closes holiday and own leave",`  it('imports only selected year holidays and reports saved count', async () => {
    const year = fixture.componentInstance.holidayImportYear;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ [year + '-01-01']: '元日', [(year + 1) + '-01-01']: '元日' }) } as Response);
    tasks.addHolidays = vi.fn().mockResolvedValue(1);
    const button = fixture.nativeElement.querySelector('.holiday-import button');
    button.click(); await fixture.whenStable();
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(tasks.addHolidays).toHaveBeenCalledWith([{ date: year + '-01-01', name: '元日' }]);
    expect(fixture.componentInstance.importingHolidays()).toBe(false);
  });
  it('does not save invalid data and restores import button after errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const year = fixture.componentInstance.holidayImportYear;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ [year + '-02-30']: '不正な日付' }) } as Response);
    tasks.addHolidays = vi.fn();
    await fixture.componentInstance.importJapaneseHolidays();
    expect(tasks.addHolidays).not.toHaveBeenCalled();
    expect(fixture.componentInstance.notificationService.show).toHaveBeenCalledWith('エラー', expect.any(String));
    expect(fixture.componentInstance.importingHolidays()).toBe(false);
  });
  it('blocks repeat clicks while importing and hides imports for non-managers', async () => {
    fixture.componentInstance.importingHolidays.set(true);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await fixture.componentInstance.importJapaneseHolidays();
    expect(fetchSpy).not.toHaveBeenCalled();
    tasks.members.set([{ ...member('self'), role: 'member' }, member('other')]);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.holiday-import')).toBeNull();
  });
  it('opens and closes holiday and own leave`);
fs.writeFileSync(p,s);

