import { deletionMocks } from './deletion-test-mocks';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TasksService } from './tasks.service';
import { DashboardComponent } from '../../features/dashboard/dashboard';
import { BoardComponent } from '../../features/board/board.component';
import { MyTasksComponent } from '../../features/my-tasks/my-tasks';
import { Timestamp } from 'firebase/firestore';
import { getWeekMonday } from '../utils/week-utils';

const { invoke } = deletionMocks;

describe('completed child workload never returns to the parent assignee', () => {
  function setup(otherStatus = '未着手', ownStatus = '未着手') {
    const service: any = Object.create(TasksService.prototype);
    const tasks = signal([
      { id: 'parent', parentId: null, assigneeId: 'owner', status: '未着手', estimatedHours: 11, focusHours: 11, focusThisWeek: true },
      { id: 'other-child', parentId: 'parent', assigneeId: 'other', status: otherStatus, estimatedHours: 2, focusThisWeek: false },
      { id: 'own-child', parentId: 'parent', assigneeId: 'owner', status: ownStatus, estimatedHours: 6, focusThisWeek: false },
      { id: 'remaining-child', parentId: 'parent', assigneeId: 'owner', status: '未着手', estimatedHours: 3, focusThisWeek: false },
    ]);
    Object.assign(service, { tasks });
    return service;
  }
  for (const [otherStatus, ownStatus, ownerHours, otherHours] of [
    ['未着手', '未着手', 9, 2], ['完了', '未着手', 9, 0], ['完了', '完了', 3, 0], ['アーカイブ済み', '完了', 3, 0],
  ] as const) {
    it(`counts owner ${ownerHours}h and other ${otherHours}h when child statuses are ${otherStatus}/${ownStatus}`, () => {
      const service = setup(otherStatus, ownStatus);
      for (const [uid, expected] of [['owner', ownerHours], ['other', otherHours]] as const) {
        expect(service.getMemberActiveHours(uid)).toBe(expected);
        expect(service.getMemberFocusHours(uid)).toBe(expected);
        expect(service.getMemberWeeklyHours(uid)[0]).toBe(expected);
      }
      expect(service.tasks()[0].estimatedHours).toBe(11);
      expect(service.tasks()[0].focusHours).toBe(11);
    });
  }
  it('also excludes completed child work from future-week forecasts', () => {
    const service = setup('完了', '完了');
    const nextWeek = getWeekMonday(new Date()); nextWeek.setDate(nextWeek.getDate() + 7);
    service.tasks.update((tasks: any[]) => tasks.map(task => task.id === 'parent' ? { ...task, focusThisWeek: false, targetWeekStart: Timestamp.fromDate(nextWeek) } : task));
    expect(service.getMemberWeeklyHours('owner')).toEqual([0, 3, 0, 0]);
    expect(service.getMemberWeeklyHours('other')).toEqual([0, 0, 0, 0]);
  });
  it('preserves the unallocated portion of a parent estimate', () => {
    const service = setup('完了', '完了');
    service.tasks.update((tasks: any[]) => tasks.map(task => task.id === 'parent' ? { ...task, estimatedHours: 14, focusHours: 14 } : task));
    expect(service.getMemberActiveHours('owner')).toBe(6);
    expect(service.getMemberFocusHours('owner')).toBe(6);
  });
  it('does not restore completed unassigned child work to the parent', () => {
    const service = setup('完了', '完了');
    service.tasks.update((tasks: any[]) => tasks.map(task => task.id === 'other-child' ? { ...task, assigneeId: null } : task));
    expect(service.getMemberFocusHours('owner')).toBe(3);
  });
});

describe('parent estimate preservation', () => {
  it('rechecks the parent estimate when a conflicting write triggers a transaction retry', async () => {
    const service: any = Object.create(TasksService.prototype);
    Object.assign(service, { firestore: {}, tasksCollection: {} });
    deletionMocks.getDocs.mockResolvedValue({ docs: [{ data: () => ({ estimatedHours: 10 }) }] });
    const abandonedUpdate = vi.fn();
    const committedUpdate = vi.fn();
    deletionMocks.runTransaction.mockImplementationOnce(async (_firestore, callback) => {
      await callback({ get: async () => ({ exists: () => true, data: () => ({ estimatedHours: 8 }) }), update: abandonedUpdate });
      // Firestore discards the conflicting attempt; another user has committed 12h.
      await callback({ get: async () => ({ exists: () => true, data: () => ({ estimatedHours: 12 }) }), update: committedUpdate });
    });
    await service.syncParentEstimate('parent');
    expect(abandonedUpdate).toHaveBeenCalledExactlyOnceWith(expect.anything(), { estimatedHours: 10 });
    expect(committedUpdate).not.toHaveBeenCalled();
  });
  it('does not recreate a parent deleted before transaction commit', async () => {
    const service: any = Object.create(TasksService.prototype);
    Object.assign(service, { firestore: {}, tasksCollection: {} });
    deletionMocks.getDocs.mockResolvedValue({ docs: [{ data: () => ({ estimatedHours: 10 }) }] });
    deletionMocks.getDoc.mockResolvedValue({ exists: () => false });
    deletionMocks.updateDoc.mockClear();
    await service.syncParentEstimate('parent');
    expect(deletionMocks.updateDoc).not.toHaveBeenCalled();
  });
  for (const [parentHours, childHours, expected] of [[8, 2, 8], [8, 10, 10], [10, 1, 10], [8, 0, 8]]) {
    it(`keeps parent ${parentHours}h with child total ${childHours}h at ${expected}h`, async () => {
      const service: any = Object.create(TasksService.prototype);
      Object.assign(service, { firestore: {}, tasksCollection: {} });
      deletionMocks.updateDoc.mockClear();
      deletionMocks.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ estimatedHours: parentHours, focusHours: 8 }) });
      deletionMocks.getDocs.mockResolvedValue({ docs: [{ data: () => ({ estimatedHours: childHours, status: '完了' }) }] });
      await service.syncParentEstimate('parent');
      if (expected > parentHours) expect(deletionMocks.updateDoc).toHaveBeenCalledExactlyOnceWith(expect.anything(), { estimatedHours: expected });
      else expect(deletionMocks.updateDoc).not.toHaveBeenCalled();
    });
  }
});

describe('holiday lookup failure', () => {
  function setup() {
    const service: any = Object.create(TasksService.prototype);
    Object.assign(service, {
      teamSettings: signal({ holidays: [], _error: true }),
      members: signal([{ uid: 'user', weeklyCapacityHours: 40, leaves: [] }]),
      tasks: signal([{ id: 'task', assigneeId: 'user', parentId: null, status: '未着手', estimatedHours: 4,
        focusThisWeek: true, focusHours: 1, recurrence: 'daily' }]),
    });
    return service;
  }
  it('does not calculate capacity or load from an empty fallback holiday list', () => {
    const service = setup();
    expect(service.getWorkingDays('user', 0)).toBeNaN();
    expect(service.getEffectiveCapacity('user', 0)).toBeNaN();
    expect(service.getFocusLoadPercent('user')).toBe(-2);
    expect(service.getWeeklyLoadPercent('user', 1, 1)).toBe(-2);
    expect(service.getMemberFocusHours('user')).toBe(1);
    expect(service.getMemberWeeklyHours('user')[1]).toBeNaN();
  });
  it('restores normal calculations when holiday settings are available again', () => {
    const service = setup();
    service.teamSettings.set({ holidays: [] });
    expect(service.getWorkingDays('user', 0)).toBe(5);
    expect(service.getEffectiveCapacity('user', 0)).toBe(40);
    expect(service.getFocusLoadPercent('user')).toBe(3);
    expect(service.getMemberWeeklyHours('user')).toEqual([1, 20, 20, 20]);
  });
  it('distinguishes a genuine zero capacity from a lookup failure', () => {
    const service = setup();
    service.teamSettings.set({ holidays: [] });
    service.members.set([{ uid: 'user', weeklyCapacityHours: 0 }]);
    expect(service.getFocusLoadPercent('user')).toBe(-1);
  });
  for (const Component of [BoardComponent, MyTasksComponent, DashboardComponent]) {
    it(`${Component.name} displays lookup failure without a false load category`, () => {
      const component: any = Object.create(Component.prototype);
      expect(component.loadLabel(-2)).toBe('計算できません');
      expect(component.loadLevel(-2)).toBe('unknown');
      expect(component.loadLabel(-1)).toBe('稼働予定なし');
      expect(component.loadLabel(80)).toBe('80%');
    });
  }
});

describe('comment drafts during submission', () => {
  async function setup() {
    const CommentPanelComponent = (BoardComponent as any).ɵcmp.directiveDefs()
      .find((definition: any) => definition.selectors?.[0]?.[0] === 'app-comment-panel').type;
    let finish!: () => void;
    const panel: any = Object.create(CommentPanelComponent.prototype);
    Object.assign(panel, {
      newComment: ' first ', task: signal({ id: 'task', assigneeId: null }),
      auth: { currentUser: signal({ uid: 'user' }) }, isSubmitting: signal(false),
      tasksService: { members: signal([]), addComment: vi.fn(() => new Promise<void>(resolve => finish = resolve)) },
      notificationService: { show: vi.fn() },
    });
    return { panel, finish: () => finish() };
  }
  it('keeps a new draft and prevents duplicate submissions while saving', async () => {
    const { panel, finish } = await setup();
    const pending = panel.submitComment();
    panel.newComment = 'next';
    await panel.submitComment();
    finish(); await pending;
    expect(panel.newComment).toBe('next');
    expect(panel.tasksService.addComment).toHaveBeenCalledExactlyOnceWith('task', 'first', 'user', 'ゲスト');
    expect(panel.isSubmitting()).toBe(false);
  });
  it('clears an unchanged draft only after a successful save', async () => {
    const { panel, finish } = await setup();
    const pending = panel.submitComment();
    expect(panel.newComment).toBe(' first ');
    finish(); await pending;
    expect(panel.newComment).toBe('');
  });
  it('does not clear the draft after switching to a different task', async () => {
    const { panel, finish } = await setup();
    const pending = panel.submitComment();
    panel.task.set({ id: 'other', assigneeId: null });
    finish(); await pending;
    expect(panel.newComment).toBe(' first ');
  });
  it('keeps the draft and releases submission state when saving fails', async () => {
    const { panel } = await setup();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    panel.tasksService.addComment.mockRejectedValue(new Error('offline'));
    await panel.submitComment();
    expect(panel.newComment).toBe(' first ');
    expect(panel.isSubmitting()).toBe(false);
    expect(panel.notificationService.show).toHaveBeenCalledWith('エラー', 'コメントの送信に失敗しました');
    vi.mocked(console.error).mockRestore();
  });
});

describe('daily recurrence workload', () => {
  function weeklyDate(week: number) {
    const date = getWeekMonday(new Date());
    date.setDate(date.getDate() + week * 7);
    return Timestamp.fromDate(date);
  }
  function setup(changes: Record<string, unknown> = {}) {
    const service: any = Object.create(TasksService.prototype);
    Object.assign(service, {
      tasks: signal([{ id: 'daily', parentId: null, assigneeId: 'user', status: '未着手', estimatedHours: 4,
        focusThisWeek: true, focusHours: 1, recurrence: 'daily', targetWeekStart: null, dueDate: null, ...changes }]),
      getWorkingDays: vi.fn(() => 5),
    });
    return service;
  }
  it('uses the explicit one-hour plan for current focus and forecast', () => {
    const service = setup();
    expect(service.getMemberFocusHours('user')).toBe(1);
    expect(service.getMemberWeeklyHours('user')).toEqual([1, 20, 20, 20]);
    expect(service.getMemberWeeklyTaskCounts('user')).toEqual([1, 1, 1, 1]);
  });
  it('preserves an explicit zero-hour plan', () => {
    const service = setup({ focusHours: 0 });
    expect(service.getMemberFocusHours('user')).toBe(0);
    expect(service.getMemberWeeklyHours('user')[0]).toBe(0);
  });
  it('uses occurrence estimate and working days when no weekly hours were specified', () => {
    const service = setup({ focusHours: null });
    service.getWorkingDays.mockImplementation((_uid: string, week: number) => [4, 3, 0, 5][week]);
    expect(service.getMemberFocusHours('user')).toBe(16);
    expect(service.getMemberWeeklyHours('user')).toEqual([16, 12, 0, 20]);
  });
  it('excludes the current week for a recurrence starting next week', () => {
    const service = setup({ targetWeekStart: weeklyDate(1) });
    expect(service.getMemberFocusHours('user')).toBe(0);
    expect(service.getMemberFocusTaskCount('user')).toBe(0);
    expect(service.getMemberWeeklyHours('user')).toEqual([0, 20, 20, 20]);
    expect(service.getMemberWeeklyTaskCounts('user')).toEqual([0, 1, 1, 1]);
  });
  it('uses the due week when no target week is present', () => {
    const service = setup({ focusThisWeek: false, dueDate: weeklyDate(2) });
    expect(service.getMemberWeeklyHours('user')).toEqual([0, 0, 20, 20]);
    expect(service.getMemberWeeklyTaskCounts('user')).toEqual([0, 0, 1, 1]);
  });
  it('does not include a start beyond the forecast horizon', () => {
    const service = setup({ targetWeekStart: weeklyDate(4), dueDate: weeklyDate(0) });
    expect(service.getMemberWeeklyHours('user')).toEqual([0, 0, 0, 0]);
    expect(service.getMemberWeeklyTaskCounts('user')).toEqual([0, 0, 0, 0]);
  });
  it('continues daily recurrence forecasting when the start week is in the past', () => {
    const service = setup({ targetWeekStart: weeklyDate(-2), focusThisWeek: false });
    expect(service.getMemberWeeklyHours('user')).toEqual([20, 20, 20, 20]);
  });
  it('keeps the full-child-estimate allocation policy for focused parents', () => {
    const service = setup({ recurrence: null, assigneeId: 'other' });
    service.tasks.set([...service.tasks(), { id: 'child', parentId: 'daily', assigneeId: 'user', status: '未着手', estimatedHours: 8, focusThisWeek: false }]);
    expect(service.getMemberFocusHours('user')).toBe(8);
    expect(service.getMemberWeeklyHours('user')[0]).toBe(8);
  });
  it('does not inherit current-week work from a daily parent starting next week', () => {
    const service = setup({ targetWeekStart: weeklyDate(1), assigneeId: 'other' });
    service.tasks.set([...service.tasks(), { id: 'child', parentId: 'daily', assigneeId: 'user', status: '未着手', estimatedHours: 8, focusThisWeek: false }]);
    expect(service.getMemberFocusHours('user')).toBe(0);
    expect(service.getMemberWeeklyHours('user')[0]).toBe(0);
  });
});

describe('server task deletion client', () => {
  it('uses the server callable and returns cleanup status', async () => {
    const service = Object.create(TasksService.prototype);
    Object.assign(service, { functions: {} });
    invoke.mockResolvedValue({ data: { cleanupPending: true } });
    expect(await service.deleteTask('task')).toEqual({ cleanupPending: true });
    expect(invoke).toHaveBeenCalledWith({ taskId: 'task' });
  });

  it('propagates callable errors without attempting client deletion', async () => {
    const service = Object.create(TasksService.prototype);
    Object.assign(service, { functions: {} });
    invoke.mockRejectedValue(new Error('offline'));
    await expect(service.deleteTask('task')).rejects.toThrow('offline');
  });

  it('requires an active member and matches manager/creator/current assignee', () => {
    const service = Object.create(TasksService.prototype);
    const members = signal([{ uid: 'user', role: 'member' }]);
    Object.assign(service, { auth: { currentUser: { uid: 'user' } }, members });
    expect(service.canDeleteTask({ createdBy: 'other', assigneeId: 'user' })).toBe(true);
    expect(service.canDeleteTask({ createdBy: 'user', assigneeId: 'other' })).toBe(true);
    expect(service.canDeleteTask({ createdBy: 'other', assigneeId: 'other' })).toBe(false);
    members.set([{ uid: 'user', role: 'manager' }]);
    expect(service.canDeleteTask({ createdBy: 'other', assigneeId: 'other' })).toBe(true);
    members.set([]);
    expect(service.canDeleteTask({ createdBy: 'user', assigneeId: 'user' })).toBe(false);
  });
});

describe('deletion confirmation retry', () => {
  it('keeps the dashboard confirmation open after failure', async () => {
    const component = Object.create(DashboardComponent.prototype);
    const task = { id: 'task', title: 'Task' };
    Object.assign(component, { deletingTask: task, deleteInProgress: signal(false), tasksService: { deleteTask: vi.fn().mockRejectedValue(new Error('permission-denied')) }, notificationService: { show: vi.fn() } });
    await component.confirmDeleteTask();
    expect(component.deletingTask).toBe(task);
    expect(component.deleteInProgress()).toBe(false);
    expect(component.notificationService.show).toHaveBeenCalledWith('エラー', 'permission-denied');
  });

  it('keeps the board confirmation and comment panel after failure', async () => {
    const component = Object.create(BoardComponent.prototype);
    const close = vi.fn();
    const task = { id: 'task', title: 'Task' };
    Object.assign(component, { deletingTask: task, deleteInProgress: signal(false), selectedTask: signal(task), isTaskInDeleteTree: () => true, closeCommentPanel: close, tasksService: { deleteTask: vi.fn().mockRejectedValue(new Error('offline')) }, notificationService: { show: vi.fn() } });
    await component.confirmDelete();
    expect(component.deletingTask).toBe(task);
    expect(close).not.toHaveBeenCalled();
    expect(component.deleteInProgress()).toBe(false);
  });

  it('ignores a duplicate confirmation while deletion is in progress', async () => {
    const component = Object.create(DashboardComponent.prototype);
    const remove = vi.fn();
    Object.assign(component, { deletingTask: { id: 'task' }, deleteInProgress: signal(true), tasksService: { deleteTask: remove } });
    await component.confirmDeleteTask();
    expect(remove).not.toHaveBeenCalled();
  });

  it('keeps only unsuccessful roots selected after a multi-selection failure', async () => {
    const component = Object.create(BoardComponent.prototype);
    const tasks = [{ id: 'first' }, { id: 'second' }];
    const remove = vi.fn().mockResolvedValueOnce({ cleanupPending: false }).mockRejectedValueOnce(new Error('offline'));
    Object.assign(component, { bulkSelected: signal(new Set(['first', 'second'])), bulkDeleting: true, deleteInProgress: signal(false), selectedTask: signal(null), isTaskInDeleteTree: () => false, tasksService: { tasks: () => tasks, canDeleteTask: () => true, deleteTask: remove }, notificationService: { show: vi.fn() } });
    await component.bulkDelete();
    expect([...component.bulkSelected()]).toEqual(['second']);
    expect(component.bulkDeleting).toBe(true);
    expect(component.deleteInProgress()).toBe(false);
  });

  it('does not start bulk deletion when a visible descendant is forbidden', async () => {
    const component = Object.create(BoardComponent.prototype);
    const tasks = [{ id: 'first' }, { id: 'second' }, { id: 'child', parentId: 'second' }];
    const remove = vi.fn();
    Object.assign(component, { bulkSelected: signal(new Set(['first', 'second'])), deleteInProgress: signal(false), tasksService: { tasks: () => tasks, canDeleteTask: (task: { id: string }) => task.id !== 'child', deleteTask: remove }, notificationService: { show: vi.fn() } });
    await component.bulkDelete();
    expect(remove).not.toHaveBeenCalled();
    expect(component.bulkSelected().size).toBe(2);
  });
});
describe('shared task completion', () => {
  const task = { id: 'child', title: 'Child', status: '未着手', estimatedHours: 0, parentId: 'parent', blockedBy: ['dependency'] };
  let service: any;
  beforeEach(() => {
    deletionMocks.updateDoc.mockReset().mockResolvedValue(undefined);
    service = Object.create(TasksService.prototype);
    Object.assign(service, {
      tasks: signal([task, { id: 'dependency', status: '完了' }]), members: signal([]),
      firestore: {}, auth: { currentUser: { uid: 'user' } }, completionRequests: new Map(),
      addActivity: vi.fn().mockResolvedValue(undefined), spawnRecurrence: vi.fn().mockResolvedValue(undefined),
      syncParentEstimate: vi.fn().mockResolvedValue(undefined),
    });
  });
  it('rejects a zero-hour child with an unfinished dependency before writing', async () => {
    service.tasks.set([task, { id: 'dependency', status: '進行中' }]);
    await expect(service.completeTask('child', 0)).rejects.toThrow('依存タスク');
    expect(deletionMocks.updateDoc).not.toHaveBeenCalled();
    expect(service.spawnRecurrence).not.toHaveBeenCalled();
  });
  it('waits for completion persistence before generating the next occurrence', async () => {
    let resolve!: () => void;
    deletionMocks.updateDoc.mockReturnValue(new Promise<void>(done => resolve = done));
    const pending = service.completeTask('child', 0);
    expect(service.spawnRecurrence).not.toHaveBeenCalled();
    resolve();
    await pending;
    expect(service.spawnRecurrence).toHaveBeenCalledExactlyOnceWith(task);
  });
  it('does not generate an occurrence when completion persistence fails', async () => {
    deletionMocks.updateDoc.mockRejectedValue(new Error('offline'));
    await expect(service.completeTask('child', 0)).rejects.toThrow('offline');
    expect(service.spawnRecurrence).not.toHaveBeenCalled();
  });
  it('joins repeated clicks while completion is pending', async () => {
    const first = service.completeTask('child', 0);
    const second = service.completeTask('child', 0);
    await Promise.all([first, second]);
    expect(deletionMocks.updateDoc).toHaveBeenCalledTimes(1);
    expect(service.spawnRecurrence).toHaveBeenCalledTimes(1);
  });
  it('reports partial completion when next occurrence creation fails', async () => {
    service.spawnRecurrence.mockRejectedValue(new Error('offline'));
    await expect(service.completeTask('child', 0)).rejects.toThrow('タスクは完了しましたが');
    expect(service.syncParentEstimate).toHaveBeenCalledWith('parent');
  });
  it('refreshes parent remaining hours after completing a child', async () => {
    await service.completeTask('child', 0);
    expect(service.syncParentEstimate).toHaveBeenCalledExactlyOnceWith('parent');
  });
  it('does not repeat completion or recurrence for an already completed task', async () => {
    service.tasks.set([{ ...task, status: '完了' }]);
    await service.completeTask('child', 0);
    expect(deletionMocks.updateDoc).not.toHaveBeenCalled();
    expect(service.spawnRecurrence).not.toHaveBeenCalled();
  });
});

for (const Component of [BoardComponent, MyTasksComponent]) {
  describe(`${Component.name} completion paths`, () => {
    const task = { id: 'child', title: 'Child', status: '未着手', estimatedHours: 0, parentId: 'parent' };
    function setup(blocked = false) {
      const component: any = Object.create(Component.prototype);
      Object.assign(component, {
        tasksService: { isBlocked: vi.fn(() => blocked), completeTask: vi.fn().mockResolvedValue(undefined) },
        notificationService: { show: vi.fn() }, canMoveTask: () => true,
        expandedTaskId: signal('parent'), columns: ['未着手'],
      });
      return component;
    }
    it('keeps blocked zero-hour children incomplete through the checkbox', async () => {
      const component = setup(true);
      await component.toggleSubtaskStatus(task);
      expect(component.tasksService.completeTask).not.toHaveBeenCalled();
      expect(component.notificationService.show).toHaveBeenCalledWith('ブロック中', expect.any(String));
    });
    it('routes zero-hour children through shared completion and preserves expansion', async () => {
      const component = setup();
      await component.toggleSubtaskStatus(task);
      expect(component.tasksService.completeTask).toHaveBeenCalledExactlyOnceWith('child', 0);
      expect(component.expandedTaskId()).toBe('parent');
    });
    it('shows an error instead of success after a failed save', async () => {
      const component = setup();
      component.tasksService.completeTask.mockRejectedValue(new Error('offline'));
      await component.startComplete(task);
      expect(component.notificationService.show).toHaveBeenCalledExactlyOnceWith('完了エラー', 'offline');
    });
    it('retains the hours dialog when completion fails', async () => {
      const component = setup();
      component.completingTask = task;
      component.actualHoursInput = 1;
      component.tasksService.completeTask.mockRejectedValue(new Error('blocked'));
      await component.confirmComplete();
      expect(component.completingTask).toBe(task);
    });
  });
}

