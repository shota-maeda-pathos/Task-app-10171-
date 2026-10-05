import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi, afterEach } from 'vitest';
import { SettingsComponent } from './settings';
import { TasksService } from '../../core/services/tasks.service';
import { AuthService } from '../../core/services/auth.service';
import { NotificationService } from '../../core/services/notification.service';
import { MyTasksComponent } from '../my-tasks/my-tasks';
import { Router } from '@angular/router';

describe('My Tasks assignee selection', () => {
  async function setup(role: 'member' | 'manager') {
    const members = signal([{ uid: 'self', name: 'Self', role, weeklyCapacityHours: 40 }, { uid: 'other', name: 'Other', role: 'member', weeklyCapacityHours: 40 }]);
    const makeTask = (id: string, assigneeId: string | null, parentId: string | null = null) => ({ id, title: id, assigneeId, parentId, status: '未着手', estimatedHours: 1, focusThisWeek: false, order: 1, blockedBy: [] });
    const tasks = { members, tasks: signal([makeTask('self-task', 'self'), makeTask('other-task', 'other'), makeTask('unassigned-root', null), makeTask('unassigned-child', null, 'other-task')]), teamSettings: signal({ holidays: [] }),
      getMemberFocusHours: vi.fn(() => 7), getMemberFocusTaskCount: vi.fn(() => 2), getFocusLoadPercent: vi.fn(() => 18), getEffectiveCapacity: vi.fn(() => 40), getMemberWeeklyHours: vi.fn(() => [7, 8, 9, 10]), isBlocked: () => false, getBlockingCount: () => 0, getEpicProgress: () => 0 };
    await TestBed.configureTestingModule({ imports: [MyTasksComponent], providers: [
      { provide: TasksService, useValue: tasks }, { provide: AuthService, useValue: { currentUser: signal({ uid: 'self' }) } },
      { provide: NotificationService, useValue: { show: vi.fn() } }, { provide: Router, useValue: {} },
    ] }).compileComponents();
    const fixture = TestBed.createComponent(MyTasksComponent);
    await fixture.whenStable();
    return { fixture, tasks, members };
  }
  it('hides the selector for members and ignores another assignee in retained filter state', async () => {
    const { fixture, tasks } = await setup('member');
    fixture.componentInstance.filterAssignee.set('other');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.assignee-filter')).toBeNull();
    expect(fixture.componentInstance.myTasks().map(task => task.id)).toEqual(['self-task']);
    expect(fixture.componentInstance.focusHours()).toBe(7);
    expect(tasks.getMemberFocusHours).toHaveBeenLastCalledWith('self');
  });
  it('lets managers select another member and uses that member for metrics', async () => {
    const { fixture, tasks } = await setup('manager');
    const select = fixture.nativeElement.querySelector('.assignee-filter') as HTMLSelectElement;
    expect(select).toBeTruthy();
    select.value = 'other'; select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(fixture.componentInstance.myTasks().map(task => task.id)).toEqual(['other-task']);
    expect(tasks.getMemberFocusHours).toHaveBeenLastCalledWith('other');
  });
  it('shows only unassigned roots and uses dashes instead of personal metrics', async () => {
    const { fixture, tasks } = await setup('manager');
    Object.values(tasks).filter(value => typeof value === 'function' && 'mockClear' in value).forEach(value => (value as any).mockClear());
    fixture.componentInstance.filterAssignee.set('unassigned');
    fixture.detectChanges();
    expect(fixture.componentInstance.rootTasks().map(task => task.id)).toEqual(['unassigned-root']);
    expect(fixture.nativeElement.querySelector('.summary-card-load .summary-value').textContent.trim()).toBe('—');
    expect(fixture.nativeElement.querySelector('.summary-card-focus .summary-value').textContent.trim()).toBe('—');
    expect([...fixture.nativeElement.querySelectorAll('.forecast-detail')].every((element: any) => element.textContent.trim() === '—')).toBe(true);
    expect(tasks.getMemberFocusHours).not.toHaveBeenCalled();
    expect(tasks.getMemberWeeklyHours).not.toHaveBeenCalled();
    expect(tasks.getEffectiveCapacity).not.toHaveBeenCalled();
  });
  it('returns to personal tasks immediately when manager privileges are removed', async () => {
    const { fixture, members } = await setup('manager');
    fixture.componentInstance.filterAssignee.set('other');
    fixture.detectChanges();
    members.update(list => list.map(member => ({ ...member, role: 'member' as const })));
    fixture.detectChanges();
    expect(fixture.componentInstance.myTasks().map(task => task.id)).toEqual(['self-task']);
    expect(fixture.nativeElement.querySelector('.assignee-filter')).toBeNull();
  });
});

describe('Settings UI interactions', () => {
  const member = (uid: string) => ({ uid, name: uid, role: 'manager', weeklyCapacityHours: 40, avatarColor: '#123456', leaves: [{ date: '2026-10-07', label: '有給' }] });
  let fixture: ReturnType<typeof TestBed.createComponent<SettingsComponent>>;
  let tasks: any;
  let notificationShow: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    tasks = { disabledMembers: signal([]), members: signal([member('self'), member('other')]), teamSettings: signal({ holidays: [{ date: '2026-10-12', name: '休日' }] }), templates: signal([]), getFocusLoadPercent: () => 0, addHoliday: vi.fn().mockResolvedValue(true), addLeave: vi.fn().mockResolvedValue(undefined), removeHoliday: vi.fn().mockResolvedValue(undefined), removeLeave: vi.fn().mockResolvedValue(undefined) };
    notificationShow = vi.fn();
    await TestBed.configureTestingModule({ imports: [SettingsComponent], providers: [
      { provide: TasksService, useValue: tasks },
      { provide: AuthService, useValue: { currentUser: signal({ uid: 'self' }) } },
      { provide: NotificationService, useValue: { show: notificationShow } },
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
  it('shows a saving state and disables own leave inputs while saving', async () => {
    let resolveSave!: () => void;
    tasks.addLeave.mockImplementation(() => new Promise<void>((resolve) => { resolveSave = resolve; }));
    fixture.nativeElement.querySelectorAll('.leave-editor-toggle')[1].click();
    await fixture.whenStable();
    await input('#leave-editor-form [aria-label="開始日"]', '2026-10-07');

    const saveButton = fixture.nativeElement.querySelector('#leave-editor-form .add-btn') as HTMLButtonElement;
    saveButton.click();
    fixture.detectChanges();

    expect(saveButton.textContent).toContain('保存中…');
    expect(fixture.nativeElement.querySelector('#leave-editor-form [aria-label="開始日"]')).toHaveProperty('disabled', true);
    expect(fixture.nativeElement.querySelector('#leave-editor-form [aria-label="休暇名"]')).toHaveProperty('disabled', true);

    resolveSave();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(saveButton.textContent).toContain('追加');
    expect(fixture.nativeElement.querySelector('#leave-editor-form [aria-label="開始日"]').disabled).toBe(false);
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
  it('preserves a changed own leave draft after saving the original values', async () => {
    let finish!: () => void;
    tasks.addLeave.mockImplementation(() => new Promise<void>(resolve => finish = resolve));
    const component = fixture.componentInstance;
    component.newLeaveStartDate = '2026-10-07';
    component.newLeavePeriod = 'am';
    const pending = component.addMyLeave();
    component.newLeaveStartDate = '2026-10-08';
    component.newLeaveLabel = '次の休暇';
    component.newLeavePeriod = 'pm';
    finish(); await pending;
    expect(tasks.addLeave).toHaveBeenCalledWith('self', [{ date: '2026-10-07', label: '有給', period: 'am' }]);
    expect(component.newLeaveStartDate).toBe('2026-10-08');
    expect(component.newLeaveLabel).toBe('次の休暇');
    expect(component.newLeavePeriod).toBe('pm');
  });
  it('keeps another member leave editor open after the previous save completes', async () => {
    let finish!: () => void;
    tasks.addLeave.mockImplementation(() => new Promise<void>(resolve => finish = resolve));
    const component = fixture.componentInstance;
    component.openAddMemberLeave('other');
    component.memberLeaveStartDate = '2026-10-07';
    const pending = component.addMemberLeave();
    component.openAddMemberLeave('self');
    component.memberLeaveStartDate = '2026-10-08';
    finish(); await pending;
    expect(component.addMemberLeaveTarget).toBe('self');
    expect(component.memberLeaveStartDate).toBe('2026-10-08');
  });
  it('preserves the next holiday draft after the previous save completes', async () => {
    let finish!: (added: boolean) => void;
    tasks.addHoliday.mockImplementation(() => new Promise<boolean>(resolve => finish = resolve));
    const component = fixture.componentInstance;
    component.newHolidayDate = '2026-10-07';
    component.newHolidayName = '休日';
    const pending = component.addHoliday();
    component.newHolidayName = '次の休日';
    finish(true); await pending;
    expect(component.newHolidayName).toBe('次の休日');
    expect(component.newHolidayDate).toBe('2026-10-07');
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
  it('uses trash icons and confirms successful holiday and leave deletions', async () => {
    click('.member-row.cdk-drag .edit-btn'); await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.modal')).toBeTruthy();
    fixture.componentInstance.cancelEdit(); fixture.detectChanges();
    click('.member-row.cdk-drag .delete-btn'); await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.delete-warning')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('#team-holidays-body .leave-remove svg')).toBeTruthy();
    click('.leave-remove'); await fixture.whenStable();
    expect(tasks.removeHoliday).toHaveBeenCalledWith('2026-10-12');
    expect(notificationShow).toHaveBeenCalledWith('削除完了', 'チーム休日を削除しました');
    expect(fixture.nativeElement.querySelector('#my-leaves-body .leave-remove svg')).toBeTruthy();
    await fixture.componentInstance.removeMyLeave('2026-10-07');
    expect(tasks.removeLeave).toHaveBeenCalledWith('self', '2026-10-07');
    expect(notificationShow).toHaveBeenCalledWith('削除完了', '休暇を削除しました');
    click('.member-row.cdk-drag .member-leaves-toggle'); await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.member-row.cdk-drag .leave-remove-btn svg')).toBeTruthy();
    click('.member-row.cdk-drag .leave-remove-btn'); await fixture.whenStable();
    expect(tasks.removeLeave).toHaveBeenCalledWith('other', '2026-10-07');
    expect(notificationShow).toHaveBeenCalledWith('削除完了', 'メンバーの休暇を削除しました');
  });
  it('notifies when a holiday deletion fails', async () => {
    tasks.removeHoliday.mockRejectedValueOnce(new Error('write failed'));
    await fixture.componentInstance.removeHoliday('2026-10-12');
    expect(notificationShow).toHaveBeenCalledWith('エラー', 'チーム休日の削除に失敗しました');
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
