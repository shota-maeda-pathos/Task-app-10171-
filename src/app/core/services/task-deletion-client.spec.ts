import { signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deletionMocks } from './deletion-test-mocks';
import { TasksService } from './tasks.service';
import { DashboardComponent } from '../../features/dashboard/dashboard';
import { BoardComponent } from '../../features/board/board.component';
import { MyTasksComponent } from '../../features/my-tasks/my-tasks';
import { Timestamp } from 'firebase/firestore';
import { getWeekMonday } from '../utils/week-utils';

const { invoke } = deletionMocks;

// Register at the test entry point so imports from other component suites cannot
// initialize the real Firebase modules before these mocks.
vi.mock('firebase/firestore', async importOriginal => {
  const { deletionMocks: mocks } = await import('./deletion-test-mocks');
  return { ...await importOriginal<typeof import('firebase/firestore')>(),
    doc: mocks.doc, getDoc: mocks.getDoc, deleteDoc: mocks.deleteDoc,
    setDoc: mocks.setDoc, updateDoc: mocks.updateDoc };
});
vi.mock('firebase/functions', async importOriginal => {
  const { deletionMocks: mocks } = await import('./deletion-test-mocks');
  return { ...await importOriginal<typeof import('firebase/functions')>(), httpsCallable: () => mocks.invoke };
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

