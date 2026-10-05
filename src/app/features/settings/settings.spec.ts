import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi, afterEach } from 'vitest';
import { SettingsComponent } from './settings';
import { TasksService } from '../../core/services/tasks.service';
import { AuthService } from '../../core/services/auth.service';
import { NotificationService } from '../../core/services/notification.service';

describe('Settings UI interactions', () => {
  const member = (uid: string) => ({ uid, name: uid, role: 'manager', weeklyCapacityHours: 40, avatarColor: '#123456', leaves: [{ date: '2026-10-07', label: '有給' }] });
  let fixture: ReturnType<typeof TestBed.createComponent<SettingsComponent>>;
  let tasks: any;
  beforeEach(async () => {
    tasks = { disabledMembers: signal([]), members: signal([member('self'), member('other')]), teamSettings: signal({ holidays: [{ date: '2026-10-12', name: '休日' }] }), templates: signal([]), getFocusLoadPercent: () => 0, addHoliday: vi.fn().mockResolvedValue(undefined), addLeave: vi.fn().mockResolvedValue(undefined), removeHoliday: vi.fn().mockResolvedValue(undefined), removeLeave: vi.fn().mockResolvedValue(undefined) };
    await TestBed.configureTestingModule({ imports: [SettingsComponent], providers: [
      { provide: TasksService, useValue: tasks },
      { provide: AuthService, useValue: { currentUser: signal({ uid: 'self' }) } },
      { provide: NotificationService, useValue: { show: vi.fn() } },
    ] }).compileComponents();
    fixture = TestBed.createComponent(SettingsComponent);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('#team-holidays-body')).toBeNull();
    expect(fixture.nativeElement.querySelector('#my-leaves-body')).toBeNull();
    const toggles = fixture.nativeElement.querySelectorAll('.leave-collapse-btn');
    for (const toggle of toggles) {
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      toggle.click();
    }
    await fixture.whenStable();
  });
  afterEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());
  const click = (selector: string) => (fixture.nativeElement.querySelector(selector) as HTMLElement).click();
  async function input(selector: string, value: string) {
    const el = fixture.nativeElement.querySelector(selector) as HTMLInputElement;
    el.value = value; el.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
  }
  it('collapses holiday and own leave cards independently and preserves draft inputs', async () => {
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
  it('registers own afternoon leave from the UI and rejects half-day ranges', async () => {
    fixture.nativeElement.querySelectorAll('.leave-editor-toggle')[1].click(); await fixture.whenStable();
    await input('#leave-editor-form [aria-label="開始日"]', '2026-10-07');
    click('#leave-editor-form .leave-period-control'); await fixture.whenStable();
    fixture.nativeElement.querySelectorAll('#leave-editor-form .leave-period-options button')[2].click(); await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('#leave-editor-form .leave-period-options')).toBeNull();
    click('#leave-editor-form .add-btn'); await fixture.whenStable();
    expect(tasks.addLeave).toHaveBeenCalledWith('self', [{ date: '2026-10-07', label: '有給', period: 'pm' }]);
    tasks.addLeave.mockClear();
    fixture.componentInstance.newLeaveStartDate = '2026-10-07';
    fixture.componentInstance.newLeaveEndDate = '2026-10-08';
    fixture.componentInstance.newLeavePeriod = 'am';
    await fixture.componentInstance.addMyLeave();
    expect(tasks.addLeave).not.toHaveBeenCalled();
  });
  it('registers member morning leave and rejects multi-day half leave', async () => {
    fixture.componentInstance.openAddMemberLeave('other');
    fixture.componentInstance.memberLeaveStartDate = '2026-10-07';
    fixture.componentInstance.memberLeavePeriod = 'am';
    await fixture.componentInstance.addMemberLeave();
    expect(tasks.addLeave).toHaveBeenCalledWith('other', [{ date: '2026-10-07', label: '有給', period: 'am' }]);
    tasks.addLeave.mockClear();
    fixture.componentInstance.openAddMemberLeave('other');
    fixture.componentInstance.memberLeaveStartDate = '2026-10-07';
    fixture.componentInstance.memberLeaveEndDate = '2026-10-08';
    fixture.componentInstance.memberLeavePeriod = 'pm';
    await fixture.componentInstance.addMemberLeave();
    expect(tasks.addLeave).not.toHaveBeenCalled();
  });
  it('closes period menu on outside click and Escape', async () => {
    fixture.nativeElement.querySelectorAll('.leave-editor-toggle')[1].click(); await fixture.whenStable();
    click('#leave-editor-form .leave-period-control'); await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.leave-period-options')).toBeTruthy();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.leave-period-options')).toBeNull();
    click('#leave-editor-form .leave-period-control'); await fixture.whenStable();
    document.body.click(); await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.leave-period-options')).toBeNull();
  });
  it('imports only selected year holidays and reports saved count', async () => {
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
  it('opens and closes holiday and own leave inputs with accessible buttons', async () => {
    const editors = fixture.nativeElement.querySelectorAll('.leave-editor');
    for (const editor of editors) {
      const toggle = editor.querySelector('.leave-editor-toggle');
      expect(editor.querySelector('input')).toBeNull();
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      toggle.click(); await fixture.whenStable();
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(editor.querySelector('input[type="date"]')).toBeTruthy();
      toggle.click(); await fixture.whenStable();
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(editor.querySelector('input')).toBeNull();
    }
  });
  it('registers holidays and own weekday leave through rendered inputs', async () => {
    click('.leave-editor-toggle'); await fixture.whenStable();
    await input('[aria-label="日付"]', '2026-10-12');
    await input('[aria-label="休日名"]', '会社休日');
    click('.leave-editor .add-btn'); await fixture.whenStable();
    expect(tasks.addHoliday).toHaveBeenCalledWith({date: '2026-10-12', name: '会社休日'});
    fixture.nativeElement.querySelectorAll('.leave-editor-toggle')[1].click(); await fixture.whenStable();
    await input('.leave-settings [aria-label="開始日"]', '2026-10-09');
    await input('.leave-settings [aria-label="終了日（空欄なら開始日のみ）"]', '2026-10-12');
    fixture.nativeElement.querySelector('#leave-editor-form .add-btn').click(); await fixture.whenStable();
    expect(tasks.addLeave).toHaveBeenCalledWith('self', [{ date: '2026-10-09', label: '有給' }, { date: '2026-10-12', label: '有給' }]);
  });
  it('opens member editing and deletion modals and dispatches leave removal', async () => {
    click('.member-row.cdk-drag .edit-btn'); await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.modal')).toBeTruthy();
    fixture.componentInstance.cancelEdit(); fixture.detectChanges();
    click('.member-row.cdk-drag .delete-btn'); await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.delete-warning')).toBeTruthy();
    click('.leave-remove'); await fixture.whenStable();
    expect(tasks.removeHoliday).toHaveBeenCalledWith('2026-10-12');
    click('.member-row.cdk-drag .member-leaves-toggle'); await fixture.whenStable();
    click('.member-row.cdk-drag .leave-remove-btn'); await fixture.whenStable();
    expect(tasks.removeLeave).toHaveBeenCalledWith('other', '2026-10-07');
  });
  it('opens and closes pinned and draggable member leaves independently', async () => {
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
  it('shows direct add for empty leaves and switches to collapse after registration', async () => {
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
  it('opens and submits another member leave form', async () => {
    click('.member-row.cdk-drag .member-leaves-toggle'); await fixture.whenStable();
    click('.member-row.cdk-drag .add-leave-btn'); await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.member-row.cdk-drag .member-leave-add-form')).toBeTruthy();
    await input('.member-row.cdk-drag [aria-label="開始日"]', '2026-10-07');
    click('.member-row.cdk-drag .add-btn'); await fixture.whenStable();
    expect(tasks.addLeave).toHaveBeenCalledWith('other', [{date: '2026-10-07', label: '有給'}]);
  });
});
