import { signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deletionMocks } from './deletion-test-mocks';
import { PersonalTaskOrderService, applyPersonalOrder, mergeVisibleOrder } from './personal-task-order.service';
import { BoardComponent } from '../../features/board/board.component';

describe('personal task order', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps hidden tasks in place when reordering filtered tasks', () => {
    expect(mergeVisibleOrder(['a', 'b', 'c', 'd'], ['d', 'b'])).toEqual(['a', 'd', 'c', 'b']);
  });

  it('ignores deleted tasks and appends new tasks in their base order', () => {
    expect(applyPersonalOrder([{ id: 'a' }, { id: 'b' }, { id: 'c' }], ['deleted', 'b']).map(task => task.id)).toEqual(['b', 'a', 'c']);
  });

  const makeService = () => Object.assign(Object.create(PersonalTaskOrderService.prototype), {
    auth: { currentUser: signal({ uid: 'alice' }) },
    state: signal({ uid: 'alice', error: false, records: [] }),
    tasksService: { tasks: signal(['a', 'b', 'c'].map((id, order) => ({ id, order, parentId: null, status: '未着手' }))) },
    firestore: {},
    pending: signal(new Map()),
    saves: new Map(),
  });

  it('uses the latest stored order and writes only the current user document', async () => {
    const service = makeService();
    deletionMocks.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ taskIds: ['c', 'a', 'b'] }) });
    await service.reorder('root:未着手', ['b', 'a']);
    expect(deletionMocks.doc).toHaveBeenCalledWith(service.firestore, 'members', 'alice', 'taskOrders', 'root:未着手');
    expect(deletionMocks.setDoc).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ taskIds: ['c', 'b', 'a'] }));
    expect(deletionMocks.updateDoc).not.toHaveBeenCalled();
  });

  it('does not reuse the previous account order during account switching', async () => {
    const service = makeService();
    service.auth.currentUser.set({ uid: 'bob' });
    expect(service.canReorder()).toBe(false);
    await expect(service.reorder('root:未着手', ['b', 'a'])).rejects.toThrow();
    expect(deletionMocks.setDoc).not.toHaveBeenCalled();
  });

  it('rejects tasks from another column', async () => {
    const service = makeService();
    await expect(service.reorder('root:完了', ['a'])).rejects.toThrow();
    expect(deletionMocks.setDoc).not.toHaveBeenCalled();
  });

  it('shows the new order immediately and retains it until the subscription acknowledges it', async () => {
    const service = makeService();
    let finish!: (ids: string[]) => void;
    deletionMocks.runTransaction.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const saving = service.reorder('root:未着手', ['b', 'a', 'c']);
    const ids = () => service.sort(service.tasksService.tasks(), 'root:未着手').map((task: any) => task.id);
    expect(ids()).toEqual(['b', 'a', 'c']);
    await Promise.resolve();
    await Promise.resolve();
    finish(['b', 'a', 'c']);
    await saving;
    expect(ids()).toEqual(['b', 'a', 'c']);
    service.state.set({ uid: 'alice', error: false, records: [{ scope: 'root:未着手', taskIds: ['b', 'a', 'c'] }] });
    service.clearAcknowledgedOrders();
    expect(service.pending().size).toBe(0);
    expect(ids()).toEqual(['b', 'a', 'c']);
  });

  it('restores the saved order when saving fails', async () => {
    const service = makeService();
    deletionMocks.runTransaction.mockRejectedValueOnce(new Error('offline'));
    const saving = service.reorder('root:未着手', ['b', 'a', 'c']);
    expect(service.sort(service.tasksService.tasks(), 'root:未着手')[0].id).toBe('b');
    await expect(saving).rejects.toThrow('offline');
    expect(service.sort(service.tasksService.tasks(), 'root:未着手')[0].id).toBe('a');
  });

  it('saves successive drags in order without an earlier completion replacing the latest display', async () => {
    const service = makeService();
    let finish!: (ids: string[]) => void;
    deletionMocks.runTransaction.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    deletionMocks.runTransaction.mockResolvedValueOnce(['c', 'b', 'a']);
    const first = service.reorder('root:未着手', ['b', 'a', 'c']);
    const second = service.reorder('root:未着手', ['c', 'b', 'a']);
    await Promise.resolve();
    await Promise.resolve();
    expect(deletionMocks.runTransaction).toHaveBeenCalledTimes(1);
    finish(['b', 'a', 'c']);
    await first;
    expect(service.sort(service.tasksService.tasks(), 'root:未着手').map((task: any) => task.id)).toEqual(['c', 'b', 'a']);
    await second;
  });

  it('allows personal vertical movement but denies unauthorized column movement', async () => {
    const tasks = [{ id: 'a' }, { id: 'b' }];
    let finish!: () => void;
    const personal = { canReorder: () => true, reorder: vi.fn(() => new Promise<void>(resolve => { finish = resolve; })) };
    const board = Object.assign(Object.create(BoardComponent.prototype), {
      personalTaskOrder: personal,
      rootTasksByColumn: () => ({ '未着手': tasks }),
      canMoveTask: () => false,
      setSortBy: vi.fn(),
      sortBy: () => 'none',
      cdr: { detectChanges: vi.fn() },
      notificationService: { show: vi.fn() },
      tasksService: { updateStatus: vi.fn() },
    });
    const container = { data: tasks };
    const saving = board.onDrop({ item: { data: tasks[0] }, previousContainer: container, container, currentIndex: 1 }, '未着手');
    expect(personal.reorder).toHaveBeenCalledWith('root:未着手', ['b', 'a']);
    expect(board.cdr.detectChanges).toHaveBeenCalledTimes(1);
    finish();
    await saving;
    personal.reorder.mockClear();
    await board.onDrop({ item: { data: tasks[0] }, previousContainer: container, container: { data: [] }, currentIndex: 0 }, '進行中');
    expect(personal.reorder).not.toHaveBeenCalled();
    expect(board.tasksService.updateStatus).not.toHaveBeenCalled();
    expect(board.notificationService.show).toHaveBeenCalledWith('権限エラー', expect.any(String));
  });
});
