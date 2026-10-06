import { leaveDayFraction, mergeMemberLeaves } from '../utils/leave-utils';
import { calculateLoadPercent } from '../utils/load-display';
import { observeActiveUser } from './active-user';
import { Injectable, inject, Injector, runInInjectionContext, computed, effect } from '@angular/core';
import { Auth, user } from '@angular/fire/auth';
import { Storage, ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from '@angular/fire/storage';
import { toSignal } from '@angular/core/rxjs-interop';
import { Observable, switchMap, of, map, catchError } from 'rxjs';
import { Firestore, collectionData, docData } from '@angular/fire/firestore';
import { Functions } from '@angular/fire/functions';
import { httpsCallable } from 'firebase/functions';
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  setDoc,
  deleteDoc,
  serverTimestamp,
  query,
  orderBy,
  where,
  getDocs,
  getDoc,
  writeBatch,
  runTransaction,
  deleteField,
  Timestamp,
} from 'firebase/firestore';
import {
  Task,
  Member,
  TaskStatus,
  TaskComment,
  TaskNotification,
  TaskActivity,
  TaskAttachment,
  TaskTemplate,
  RecurrenceType,
  TeamSettings,
  TeamHoliday,
  MemberLeave,
} from '../models/task.model';
import { getWeekIndex, getWeekMonday, formatDateString } from '../utils/week-utils';

export class RecurrenceGenerationError extends Error {
  constructor(public readonly retry: () => Promise<void>) {
    super('タスクは完了しましたが、繰り返しの次回作成に失敗しました。');
  }
}

const VALID_STATUSES: Set<string> = new Set<string>([
  '未着手',
  '進行中',
  '差し戻し中',
  '完了',
  'アーカイブ済み',
]);

@Injectable({ providedIn: 'root' })
export class TasksService {
  private firestore = inject(Firestore);
  private storage = inject(Storage);
  private functions = inject(Functions);
  private auth = inject(Auth);
  private injector = inject(Injector);
  private activeUser = observeActiveUser(this.auth, this.firestore, this.injector);
  private tasksCollection = collection(this.firestore, 'tasks');
  private membersCollection = collection(this.firestore, 'members');
  private templatesCollection = collection(this.firestore, 'taskTemplates');
  private teamSettingsDoc = doc(this.firestore, 'teamSettings', 'default');
  private watchedTaskIds = new Set<string>();
  private weeklyFocusActivated = false;
  private rootReorderQueue: Promise<void> = Promise.resolve();
  private lastRootTaskOrder = 0;
  private subtaskReorderQueues = new Map<string, Promise<void>>();
  private lastSubtaskOrder = new Map<string, number>();
  private completionRequests = new Map<string, Promise<void>>();

  tasks = toSignal(
    this.activeUser.pipe(
      switchMap((currentUser) => {
        if (!currentUser) return of([]);
        return runInInjectionContext(this.injector, () =>
          (
            collectionData(query(this.tasksCollection, orderBy('order')), {
              idField: 'id',
            }) as Observable<Task[]>
          ).pipe(map((tasks) => tasks.filter((t) => VALID_STATUSES.has(t.status)))),
        );
      }),
    ) as Observable<Task[]>,
    { initialValue: [] as Task[] },
  );

  constructor() {
    effect(() => {
      const tasks = this.tasks();
      if (tasks.length > 0 && !this.weeklyFocusActivated) {
        this.weeklyFocusActivated = true;
        this.autoActivateWeeklyFocus(tasks);
      }
    });
  }

  private async autoActivateWeeklyFocus(tasks: Task[]): Promise<void> {
    const currentMonday = getWeekMonday(new Date());
    const targets = tasks.filter(
      (t) =>
        !t.focusThisWeek &&
        t.targetWeekStart &&
        t.status !== '完了' &&
        t.status !== 'アーカイブ済み' &&
        getWeekMonday(
          t.targetWeekStart instanceof Timestamp ? t.targetWeekStart.toDate() : new Date(t.targetWeekStart as any),
        ).getTime() === currentMonday.getTime(),
    );
    for (const t of targets) {
      const ref = doc(this.firestore, 'tasks', t.id);
      const hours = t.focusHours ?? t.estimatedHours ?? 0;
      await updateDoc(ref, {
        focusThisWeek: true,
        focusHours: this.capFocusHours(hours, t.estimatedHours ?? 0),
      });
    }
  }

  private allMembers = toSignal(
    this.activeUser.pipe(
      switchMap((currentUser) => {
        if (!currentUser) return of([]);
        return runInInjectionContext(this.injector, () =>
          collectionData(this.membersCollection, { idField: 'uid' }),
        );
      }),
    ) as Observable<Member[]>,
    { initialValue: [] as Member[] },
  );

  members = computed(() => this.allMembers().filter((m) => !m.disabled));

  disabledMembers = computed(() => this.allMembers().filter((m) => m.disabled));

  teamSettings = toSignal(
    this.activeUser.pipe(
      switchMap((currentUser) => {
        if (!currentUser) return of({ holidays: [] } as TeamSettings);
        return runInInjectionContext(this.injector, () =>
          (docData(this.teamSettingsDoc) as Observable<TeamSettings>).pipe(
            map((data) => data ?? { holidays: [] }),
            catchError(() => of({ holidays: [], _error: true } as TeamSettings)),
          ),
        );
      }),
    ) as Observable<TeamSettings>,
    { initialValue: { holidays: [] } as TeamSettings },
  );

  private allTemplates = toSignal(
    this.activeUser.pipe(
      switchMap((currentUser) => {
        if (!currentUser) return of([]);
        return runInInjectionContext(this.injector, () =>
          (collectionData(query(this.templatesCollection, orderBy('createdAt')), {
            idField: 'id',
          }) as Observable<TaskTemplate[]>).pipe(
            catchError(() => of([] as TaskTemplate[])),
          ),
        );
      }),
    ) as Observable<TaskTemplate[]>,
    { initialValue: [] as TaskTemplate[] },
  );

  templates = toSignal(
    this.activeUser.pipe(
      switchMap((currentUser) => {
        if (!currentUser) return of([]);
        return runInInjectionContext(this.injector, () =>
          (
            collectionData(
              query(this.templatesCollection, where('createdBy', '==', currentUser.uid)),
              { idField: 'id' }
            ) as Observable<TaskTemplate[]>
          ).pipe(
            map((templates) =>
              [...templates].sort(
                (a, b) =>
                  (a.createdAt?.toMillis() ?? 0) - (b.createdAt?.toMillis() ?? 0),
              ),
            ),
          ),
        );
      }),
    ) as Observable<TaskTemplate[]>,
    { initialValue: [] as TaskTemplate[] },
  );

  // --- CRUD ---

  private capFocusHours(focusHours: number, estimatedHours: number): number {
    const maxHours = Number.isFinite(estimatedHours) ? Math.max(0, estimatedHours) : 0;
    const requestedHours = Number.isFinite(focusHours) ? Math.max(0, focusHours) : 0;
    return Math.min(requestedHours, maxHours);
  }

  async createTask(data: Partial<Task>): Promise<string> {
    const uid = this.auth.currentUser?.uid;
    if (!uid) throw new Error('ログインしてください');
    const rawHours = data.estimatedHours ?? 0;
    const estimatedHours = Number.isFinite(rawHours) && rawHours >= 0 ? rawHours : 0;
    const focusThisWeek = data.focusThisWeek ?? false;
    const docRef = await addDoc(this.tasksCollection, {
      title: data.title ?? '',
      description: data.description ?? '',
      parentId: data.parentId ?? null,
      assigneeId: data.assigneeId ?? null,
      createdBy: data.recurrencePreviousTaskId ? (data.createdBy ?? null) : uid,
      status: data.status ?? '未着手',
      estimatedHours,
      actualHours: null,
      dueDate: data.dueDate ?? null,
      blockedBy: data.blockedBy ?? [],
      order: data.order ?? Date.now(),
      createdAt: serverTimestamp(),
      statusUpdatedAt: serverTimestamp(),
      reviewReason: null,
      proposedDueDate: null,
      priority: data.priority ?? null,
      focusThisWeek,
      focusHours: focusThisWeek
        ? this.capFocusHours(data.focusHours ?? estimatedHours, estimatedHours)
        : null,
      targetWeekStart: data.targetWeekStart ?? null,
      recurrence: data.recurrence ?? null,
      recurrenceSourceId: data.recurrenceSourceId ?? null,
      recurrencePreviousTaskId: data.recurrencePreviousTaskId ?? null,
    });

    this.addActivity(docRef.id, 'created').catch(() => {});

    if (data.parentId) {
      await this.syncParentEstimate(data.parentId);
    }
    const currentUserUid = this.auth.currentUser?.uid;
    const creatorMember = this.members().find((m) => m.uid === currentUserUid);
    const authorName = creatorMember?.name ?? 'システム';

    // 通知先のUIDを格納するSet（重複を防ぐため）
    const targetUids = new Set<string>();

    // 1. マネージャーを追加（自分以外）
    this.members().forEach((m) => {
      if (m.role === 'manager' && m.uid !== currentUserUid) {
        targetUids.add(m.uid);
      }
    });

    // 2. 担当者を追加（担当者が設定されており、かつ自分以外の場合）
    if (data.assigneeId && data.assigneeId !== currentUserUid) {
      targetUids.add(data.assigneeId);
    }

    // 各対象者のドキュメントへ通知を追加
    const notificationPromises = Array.from(targetUids).map((uid) =>
      this.addNotification(uid, {
        taskId: docRef.id,
        taskTitle: data.title ?? '名称未設定タスク',
        authorName: authorName,
        text: '新しいタスクが作成されました。',
        read: false,
        createdAt: null as any,
        type: 'task_created',
      }),
    );

    // Promise.allで非同期実行
    Promise.all(notificationPromises).catch((err) => console.error('通知作成エラー:', err));
    return docRef.id;
  }

  private async syncParentEstimate(parentId: string): Promise<void> {
    const parentRef = doc(this.firestore, 'tasks', parentId);
    const childrenQuery = query(this.tasksCollection, where('parentId', '==', parentId));
    const childrenSnap = await getDocs(childrenQuery);
    const childTotal = childrenSnap.docs
      .reduce((sum, d) => sum + ((d.data() as Task).estimatedHours ?? 0), 0);

    await runTransaction(this.firestore, async transaction => {
      const parentSnap = await transaction.get(parentRef);
      if (!parentSnap.exists()) return;
      const parentData = parentSnap.data() as Task;
      if (childTotal > (parentData.estimatedHours ?? 0)) {
        transaction.update(parentRef, { estimatedHours: childTotal });
      }
    });
  }

  async updateStatus(taskId: string, status: TaskStatus): Promise<void> {
    const task = this.tasks().find((t) => t.id === taskId);
    const oldStatus = task?.status ?? null;
    const ref = doc(this.firestore, 'tasks', taskId);
    await updateDoc(ref, {
      status,
      statusUpdatedAt: serverTimestamp(),
    });
    // アクティビティログ
    if (oldStatus && oldStatus !== status) {
      this.addActivity(taskId, 'status_change', oldStatus, status).catch(() => {});
    }
    if (task?.parentId) await this.syncParentEstimate(task.parentId);
  }

  async updateTask(taskId: string, data: Partial<Task>): Promise<void> {
    const task = this.tasks().find((t) => t.id === taskId);
    const ref = doc(this.firestore, 'tasks', taskId);
    const updateData: Partial<Task> = { ...data };
    const focusThisWeek = data.focusThisWeek ?? task?.focusThisWeek ?? false;
    const estimatedHours = data.estimatedHours ?? task?.estimatedHours ?? 0;

    if (
      focusThisWeek &&
      (data.estimatedHours !== undefined ||
        data.focusHours !== undefined ||
        data.focusThisWeek === true)
    ) {
      const focusHours = data.focusHours ?? task?.focusHours ?? estimatedHours;
      updateData.focusHours = this.capFocusHours(focusHours, estimatedHours);
    }

    await updateDoc(ref, updateData);

    if (data.assigneeId !== undefined && task && data.assigneeId !== task.assigneeId) {
      const oldName = this.members().find((m) => m.uid === task.assigneeId)?.name ?? '未割当';
      const newName = this.members().find((m) => m.uid === data.assigneeId)?.name ?? '未割当';
      this.addActivity(taskId, 'assignee_change', oldName, newName).catch(() => {});

      const currentUserUid = this.auth.currentUser?.uid;
      const actor = this.members().find((m) => m.uid === currentUserUid);
      const authorName = actor?.name ?? 'システム';
      if (data.assigneeId && data.assigneeId !== currentUserUid) {
        this.addNotification(data.assigneeId, {
          taskId,
          taskTitle: task.title ?? '名称未設定タスク',
          authorName,
          text: `${authorName}さんがあなたを担当に設定しました。`,
          read: false,
          createdAt: null as any,
        }).catch((err) => console.error('通知作成エラー:', err));
      }
    }

    if (data.priority !== undefined && task && data.priority !== task.priority) {
      const labels: Record<string, string> = { high: '高', medium: '中', low: '低' };
      const oldLabel = labels[task.priority ?? ''] ?? '未設定';
      const newLabel = labels[data.priority ?? ''] ?? '未設定';
      this.addActivity(taskId, 'priority_change', oldLabel, newLabel).catch(() => {});
    }

    if (data.dueDate !== undefined && task) {
      const oldTimestamp = task.dueDate?.toDate().getTime() ?? null;
      const newTimestamp = data.dueDate?.toDate().getTime() ?? null;
      if (oldTimestamp !== newTimestamp) {
        this.addActivity(
          taskId,
          'due_date_change',
          this.formatActivityDueDate(task.dueDate),
          this.formatActivityDueDate(data.dueDate),
        ).catch(() => {});
      }
    }

    if (data.estimatedHours !== undefined && task && data.estimatedHours !== task.estimatedHours) {
      this.addActivity(
        taskId,
        'estimate_change',
        `${task.estimatedHours ?? 0}h`,
        `${data.estimatedHours}h`,
      ).catch(() => {});
      if (task.parentId) {
        await this.syncParentEstimate(task.parentId);
      }
    }

    if (data.focusThisWeek !== undefined && task && data.focusThisWeek !== task.focusThisWeek) {
      this.addActivity(
        taskId,
        'focus_change',
        task.focusThisWeek ? 'ON' : 'OFF',
        data.focusThisWeek ? 'ON' : 'OFF',
      ).catch(() => {});
    }
  }

  async updateTaskOrders(updates: { id: string; order: number }[]): Promise<void> {
    for (let start = 0; start < updates.length; start += 500) {
      const batch = writeBatch(this.firestore);
      updates.slice(start, start + 500).forEach(({ id, order }) => {
        batch.update(doc(this.firestore, 'tasks', id), { order });
      });
      await batch.commit();
    }
  }

  async reorderRootTasks(orderedTaskIds: string[]): Promise<void> {
    const pending = this.rootReorderQueue.catch(() => {}).then(async () => {
      const rootTasks = this.tasks().filter((task) => task.parentId === null);
      const rootTaskIds = new Set(rootTasks.map((task) => task.id));
      if (
        new Set(orderedTaskIds).size !== orderedTaskIds.length ||
        orderedTaskIds.some((id) => !rootTaskIds.has(id))
      ) {
        throw new Error('タスクの並び順が更新中に変更されました');
      }

      const firstOrder =
        Math.max(
          Date.now(),
          this.lastRootTaskOrder,
          ...rootTasks.map((task) => task.order),
        ) + 1;
      this.lastRootTaskOrder = firstOrder + orderedTaskIds.length - 1;
      await this.updateTaskOrders(
        orderedTaskIds.map((id, index) => ({ id, order: firstOrder + index })),
      );
    });

    this.rootReorderQueue = pending;
    await pending;
  }

  async reorderSubtasks(parentId: string, orderedTaskIds: string[]): Promise<void> {
    const previous = this.subtaskReorderQueues.get(parentId) ?? Promise.resolve();
    const pending = previous.catch(() => {}).then(async () => {
      const siblings = this.tasks().filter((task) => task.parentId === parentId);
      const siblingIds = new Set(siblings.map((task) => task.id));
      if (
        orderedTaskIds.length !== siblings.length ||
        new Set(orderedTaskIds).size !== siblings.length ||
        orderedTaskIds.some((id) => !siblingIds.has(id))
      ) {
        throw new Error('サブタスクの並び順が更新中に変更されました');
      }

      const firstOrder =
        Math.max(
          Date.now(),
          this.lastSubtaskOrder.get(parentId) ?? 0,
          ...siblings.map((task) => task.order),
        ) + 1;
      this.lastSubtaskOrder.set(parentId, firstOrder + orderedTaskIds.length - 1);
      await this.updateTaskOrders(
        orderedTaskIds.map((id, index) => ({ id, order: firstOrder + index })),
      );
    });

    this.subtaskReorderQueues.set(parentId, pending);
    try {
      await pending;
    } finally {
      if (this.subtaskReorderQueues.get(parentId) === pending) {
        this.subtaskReorderQueues.delete(parentId);
      }
    }
  }

  completeTask(taskId: string, actualHours: number): Promise<void> {
    const pending = this.completionRequests.get(taskId);
    if (pending) return pending;
    const request = this.performCompletion(taskId, actualHours).finally(() => {
      this.completionRequests.delete(taskId);
    });
    this.completionRequests.set(taskId, request);
    return request;
  }

  private async performCompletion(taskId: string, actualHours: number): Promise<void> {
    const safeHours = Number.isFinite(actualHours) && actualHours >= 0 ? actualHours : 0;
    const task = this.tasks().find((t) => t.id === taskId);
    if (!task) throw new Error('タスクが見つかりません。画面を再読み込みしてください');
    if (task.status === '完了' || task.status === 'アーカイブ済み') {
      if (task.recurrence) {
        try { await this.spawnRecurrence(task); }
        catch { throw new RecurrenceGenerationError(() => this.retryRecurrence(taskId)); }
      }
      return;
    }
    if (this.isBlocked(task)) {
      throw new Error(`「${task.title}」は依存タスクが完了するまで完了にできません`);
    }
    const oldStatus = task?.status ?? null;
    const ref = doc(this.firestore, 'tasks', taskId);
    await updateDoc(ref, {
      status: '完了',
      actualHours: safeHours,
      statusUpdatedAt: serverTimestamp(),
    });
    // アクティビティログ
    this.addActivity(taskId, 'completed', oldStatus, '完了').catch(() => {});

    // 完了通知: マネージャーとタスク作成者に通知
    const currentUserUid = this.auth.currentUser?.uid;
    const actor = this.members().find((m) => m.uid === currentUserUid);
    const authorName = actor?.name ?? 'システム';
    const targetUids = new Set<string>();

    this.members().forEach((m) => {
      if (m.role === 'manager' && m.uid !== currentUserUid) targetUids.add(m.uid);
    });
    if (task?.createdBy && task.createdBy !== currentUserUid) {
      targetUids.add(task.createdBy);
    }

    const notificationPromises = Array.from(targetUids).map((uid) =>
      this.addNotification(uid, {
        taskId,
        taskTitle: task?.title ?? '名称未設定タスク',
        authorName,
        text: `タスクが完了しました（実績: ${actualHours}h）`,
        read: false,
        createdAt: null as any,
        type: 'task_completed',
      }),
    );
    Promise.all(notificationPromises).catch((err) => console.error('通知作成エラー:', err));
    try {
      await this.spawnRecurrence(task);
    } catch {
      throw new RecurrenceGenerationError(() => this.retryRecurrence(taskId));
    } finally {
      if (task.parentId) await this.syncParentEstimate(task.parentId);
    }
  }

  canDeleteTask(task: Task): boolean {
    const uid = this.auth.currentUser?.uid;
    const member = this.members().find((member) => member.uid === uid);
    return !!member && (member.role === 'manager' || task.createdBy === uid || task.assigneeId === uid);
  }

  async deleteTask(taskId: string): Promise<{ cleanupPending: boolean }> {
    const callable = httpsCallable<{ taskId: string }, { cleanupPending: boolean }>(this.functions, 'deleteTaskSafely');
    const response = await callable({ taskId });
    return response.data;
  }

  async updateMemberCapacity(memberId: string, capacityHours: number): Promise<void> {
    const safeHours = Math.max(1, Math.min(80, Math.round(capacityHours)));
    const ref = doc(this.firestore, 'members', memberId);
    await updateDoc(ref, {
      weeklyCapacityHours: safeHours,
    });
  }

  async updateMemberRole(memberId: string, role: 'manager' | 'member'): Promise<void> {
    const ref = doc(this.firestore, 'members', memberId);
    await updateDoc(ref, { role });
  }

  async updateMemberName(memberId: string, name: string): Promise<void> {
    const ref = doc(this.firestore, 'members', memberId);
    await updateDoc(ref, { name });
  }

  async updateMemberTheme(memberId: string, theme: string): Promise<void> {
    const ref = doc(this.firestore, 'members', memberId);
    await updateDoc(ref, { theme });
  }

  /** メンバー情報をアトミックに一括更新 */
  async updateMemberBatch(
    memberId: string,
    data: { role: 'manager' | 'member'; name: string; weeklyCapacityHours: number },
  ): Promise<void> {
    const safeHours = Math.max(1, Math.min(80, Math.round(data.weeklyCapacityHours)));
    const ref = doc(this.firestore, 'members', memberId);
    const batch = writeBatch(this.firestore);
    batch.update(ref, {
      role: data.role,
      name: data.name,
      weeklyCapacityHours: safeHours,
    });
    await batch.commit();
  }

  async deleteMember(memberId: string): Promise<void> {
    // 削除するメンバーに割り当てられたタスクの担当を解除
    const assignedQuery = query(this.tasksCollection, where('assigneeId', '==', memberId));
    const assignedSnap = await getDocs(assignedQuery);
    const batch = writeBatch(this.firestore);
    assignedSnap.docs.forEach((d) => {
      batch.update(d.ref, { assigneeId: null });
    });
    await batch.commit();

    // 通知サブコレクションを削除
    const notifCol = collection(this.firestore, 'members', memberId, 'notifications');
    const notifSnap = await getDocs(notifCol);
    const notifBatch = writeBatch(this.firestore);
    notifSnap.docs.forEach((d) => notifBatch.delete(d.ref));
    await notifBatch.commit();

    // メンバーを無効化（再ログイン防止のためドキュメントは残す）
    const ref = doc(this.firestore, 'members', memberId);
    await updateDoc(ref, { disabled: true });
  }

  async restoreMember(memberId: string): Promise<void> {
    const ref = doc(this.firestore, 'members', memberId);
    await updateDoc(ref, { disabled: deleteField() });
  }

  // --- 差し戻し/交渉フロー ---

  async requestReview(taskId: string, reason: string, proposedDueDate?: Date): Promise<void> {
    const task = this.tasks().find((t) => t.id === taskId); // タスク情報を取得
    const ref = doc(this.firestore, 'tasks', taskId);
    await updateDoc(ref, {
      status: '差し戻し中',
      reviewReason: reason,
      proposedDueDate: proposedDueDate ?? null,
      statusUpdatedAt: serverTimestamp(),
    });

    this.addActivity(taskId, 'review_request', '進行中', '差し戻し中').catch(() => {});

    // ▼ 通知処理 ▼
    const currentUserUid = this.auth.currentUser?.uid;
    const actor = this.members().find((m) => m.uid === currentUserUid);
    const authorName = actor?.name ?? 'システム';
    const targetUids = new Set<string>();

    // マネージャーとタスク作成者に通知
    this.members().forEach((m) => {
      if (m.role === 'manager' && m.uid !== currentUserUid) targetUids.add(m.uid);
    });
    if (task?.createdBy && task.createdBy !== currentUserUid) {
      targetUids.add(task.createdBy);
    }

    const notificationPromises = Array.from(targetUids).map((uid) =>
      this.addNotification(uid, {
        taskId,
        taskTitle: task?.title ?? '名称未設定タスク',
        authorName,
        text: `理由: ${reason}`,
        read: false,
        createdAt: null as any,
        type: 'returned',
      }),
    );
    Promise.all(notificationPromises).catch((err) => console.error('通知作成エラー:', err));
  }

  async approveReview(taskId: string): Promise<void> {
    const task = this.tasks().find((t) => t.id === taskId);
    const nextDueDate = task?.proposedDueDate ?? task?.dueDate ?? null;
    const ref = doc(this.firestore, 'tasks', taskId);
    await updateDoc(ref, {
      status: '未着手',
      dueDate: nextDueDate,
      reviewReason: null,
      proposedDueDate: null,
      statusUpdatedAt: serverTimestamp(),
    });

    this.addActivity(taskId, 'review_approve', '差し戻し中', '未着手').catch(() => {});
    const oldDueDate = task?.dueDate?.toDate().getTime() ?? null;
    const approvedDueDate = nextDueDate?.toDate().getTime() ?? null;
    if (task && oldDueDate !== approvedDueDate) {
      this.addActivity(
        taskId,
        'due_date_change',
        this.formatActivityDueDate(task.dueDate),
        this.formatActivityDueDate(nextDueDate),
      ).catch(() => {});
    }

    const currentUserUid = this.auth.currentUser?.uid;
    const actor = this.members().find((m) => m.uid === currentUserUid);
    const authorName = actor?.name ?? 'システム';
    const targetUids = new Set<string>();

    // 担当者とタスク作成者に通知
    if (task?.assigneeId && task.assigneeId !== currentUserUid) {
      targetUids.add(task.assigneeId);
    }
    if (task?.createdBy && task.createdBy !== currentUserUid) {
      targetUids.add(task.createdBy);
    }

    const notificationPromises = Array.from(targetUids).map((uid) =>
      this.addNotification(uid, {
        taskId,
        taskTitle: task?.title ?? '名称未設定タスク',
        authorName,
        text: '差し戻し申請が承認され、未着手に戻りました。',
        read: false,
        createdAt: null as any,
        type: 'review_approved',
      }),
    );
    Promise.all(notificationPromises).catch((err) => console.error('通知作成エラー:', err));
  }

  async rejectReview(taskId: string): Promise<void> {
    const task = this.tasks().find((t) => t.id === taskId);
    const ref = doc(this.firestore, 'tasks', taskId);
    await updateDoc(ref, {
      status: '進行中',
      reviewReason: null,
      proposedDueDate: null,
      statusUpdatedAt: serverTimestamp(),
    });

    this.addActivity(taskId, 'review_reject', '差し戻し中', '進行中').catch(() => {});

    const currentUserUid = this.auth.currentUser?.uid;
    const actor = this.members().find((m) => m.uid === currentUserUid);
    const authorName = actor?.name ?? 'システム';
    const targetUids = new Set<string>();

    // 担当者に通知
    if (task?.assigneeId && task.assigneeId !== currentUserUid) {
      targetUids.add(task.assigneeId);
    }

    const notificationPromises = Array.from(targetUids).map((uid) =>
      this.addNotification(uid, {
        taskId,
        taskTitle: task?.title ?? '名称未設定タスク',
        authorName,
        text: '差し戻し申請が却下され、進行中に戻りました。',
        read: false,
        createdAt: null as any,
        type: 'review_rejected',
      }),
    );
    Promise.all(notificationPromises).catch((err) => console.error('通知作成エラー:', err));
  }

  async withdrawReview(taskId: string): Promise<void> {
    const task = this.tasks().find((t) => t.id === taskId);
    const ref = doc(this.firestore, 'tasks', taskId);
    await updateDoc(ref, {
      status: '進行中',
      reviewReason: null,
      proposedDueDate: null,
      statusUpdatedAt: serverTimestamp(),
    });

    this.addActivity(taskId, 'review_withdraw', '差し戻し中', '進行中').catch(() => {});

    const currentUserUid = this.auth.currentUser?.uid;
    const actor = this.members().find((m) => m.uid === currentUserUid);
    const authorName = actor?.name ?? 'システム';

    const managerUids = this.members()
      .filter((m) => m.role === 'manager' && m.uid !== currentUserUid)
      .map((m) => m.uid);

    const notificationPromises = managerUids.map((uid) =>
      this.addNotification(uid, {
        taskId,
        taskTitle: task?.title ?? '名称未設定タスク',
        authorName,
        text: '差し戻し申請が取り消されました。',
        read: false,
        createdAt: null as any,
        type: 'review_withdrawn',
      }),
    );
    Promise.all(notificationPromises).catch((err) => console.error('通知作成エラー:', err));
  }

  // --- 派生ロジック ---

  getLoadPercent(memberId: string): number {
    const member = this.members().find((m) => m.uid === memberId);
    if (!member) return 0;

    const totalHours = this.getMemberActiveHours(memberId);
    if (!member.weeklyCapacityHours || member.weeklyCapacityHours <= 0) return 0;
    return Math.round((totalHours / member.weeklyCapacityHours) * 100);
  }

  getEpicProgress(epicId: string): number {
    const children = this.tasks().filter((t) => t.parentId === epicId);
    if (children.length === 0) return 0;
    const done = children.filter((t) => t.status === '完了').length;
    return Math.round((done / children.length) * 100);
  }

  isBlocked(task: Task): boolean {
    if (!task.blockedBy || task.blockedBy.length === 0) return false;
    return task.blockedBy.some((depId) => {
      const dep = this.tasks().find((t) => t.id === depId);
      return dep && dep.status !== '完了';
    });
  }

  isStalled(task: Task, thresholdDays = 3): boolean {
    if (task.status === '完了' || !task.statusUpdatedAt) return false;
    const updated = task.statusUpdatedAt.toDate();
    const diffDays = (Date.now() - updated.getTime()) / (1000 * 60 * 60 * 24);
    return diffDays >= thresholdDays;
  }

  async dismissStalled(taskId: string): Promise<void> {
    const ref = doc(this.firestore, 'tasks', taskId);
    await updateDoc(ref, { statusUpdatedAt: serverTimestamp() });
  }

  // --- 祝日・休暇 ---

  async addHoliday(holiday: TeamHoliday): Promise<boolean> {
    return runTransaction(this.firestore, async transaction => {
      const snapshot = await transaction.get(this.teamSettingsDoc);
      const current = (snapshot.data()?.['holidays'] ?? []) as TeamHoliday[];
      if (current.some((h) => h.date === holiday.date)) return false;
      transaction.set(this.teamSettingsDoc, {
        holidays: [...current, holiday].sort((a, b) => a.date.localeCompare(b.date)),
      }, { merge: true });
      return true;
    });
  }

  async addHolidays(holidays: TeamHoliday[]): Promise<number> {
    return runTransaction(this.firestore, async transaction => {
      const snapshot = await transaction.get(this.teamSettingsDoc);
      const current = (snapshot.data()?.['holidays'] ?? []) as TeamHoliday[];
      const added = getNewHolidays(current, holidays);
      if (added.length > 0) {
        transaction.set(this.teamSettingsDoc, {
          holidays: [...current, ...added].sort((a, b) => a.date.localeCompare(b.date)),
        }, { merge: true });
      }
      return added.length;
    });
  }

  async removeHoliday(date: string): Promise<void> {
    await runTransaction(this.firestore, async transaction => {
      const snapshot = await transaction.get(this.teamSettingsDoc);
      const current = (snapshot.data()?.['holidays'] ?? []) as TeamHoliday[];
      transaction.set(this.teamSettingsDoc, {
        holidays: current.filter((h) => h.date !== date),
      }, { merge: true });
    });
  }

  async addLeave(memberId: string, leaves: MemberLeave[]): Promise<void> {
    const ref = doc(this.firestore, 'members', memberId);
    await runTransaction(this.firestore, async transaction => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists()) throw new Error('メンバーが見つかりません');
      const current = (snapshot.data()['leaves'] ?? []) as MemberLeave[];
      transaction.update(ref, { leaves: mergeMemberLeaves(current, leaves) });
    });
  }

  async removeLeave(memberId: string, date: string): Promise<void> {
    const ref = doc(this.firestore, 'members', memberId);
    await runTransaction(this.firestore, async transaction => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists()) throw new Error('メンバーが見つかりません');
      const current = (snapshot.data()['leaves'] ?? []) as MemberLeave[];
      transaction.update(ref, { leaves: current.filter((l) => l.date !== date) });
    });
  }

  getWorkingDays(memberId: string, weekIndex: number): number {
    if (this.teamSettings()?._error) return Number.NaN;
    const monday = getWeekMonday(new Date());
    const weekStart = new Date(monday);
    weekStart.setDate(weekStart.getDate() + weekIndex * 7);

    const holidays = this.teamSettings()?.holidays ?? [];
    const member = this.members().find((m) => m.uid === memberId);
    const leaves = member?.leaves ?? [];

    let workingDays = 5;
    for (let i = 0; i < 5; i++) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      const dateStr = formatDateString(d);
      if (holidays.some((h) => h.date === dateStr)) {
        workingDays--;
      } else {
        workingDays -= leaveDayFraction(leaves.filter(leave => leave.date === dateStr));
      }
    }
    return workingDays;
  }

  getBlockingCount(taskId: string): number {
    return this.tasks().filter((t) => t.blockedBy?.includes(taskId) && t.status !== '完了').length;
  }

  getMemberActiveHours(memberId: string): number {
    const tasks = this.tasks();
    let totalHours = 0;

    for (const t of tasks) {
      if (t.status === '完了' || t.status === 'アーカイブ済み') continue;
      if (t.assigneeId !== memberId) continue;

      const children = tasks.filter((c) => c.parentId === t.id);

      if (children.length > 0) {
        const assignedChildHours = children
          .filter(
            (c) => c.assigneeId !== null || c.status === '完了' || c.status === 'アーカイブ済み',
          )
          .reduce((sum, c) => sum + (c.estimatedHours ?? 0), 0);
        const remaining = Math.max(0, (t.estimatedHours ?? 0) - assignedChildHours);
        totalHours += remaining;
      } else {
        totalHours += t.estimatedHours ?? 0;
      }
    }

    return totalHours;
  }

  private dailyStartWeek(task: Task): number {
    const date = task.targetWeekStart ?? task.dueDate;
    if (!date) return 0;
    const start = date instanceof Timestamp ? date.toDate() : new Date(date as any);
    return Math.max(0, Math.round((getWeekMonday(start).getTime() - getWeekMonday(new Date()).getTime()) / (7 * 24 * 60 * 60 * 1000)));
  }

  getMemberFocusHours(memberId: string): number {
    const tasks = this.tasks();
    let totalHours = 0;
    const countedTaskIds = new Set<string>();

    for (const t of tasks) {
      if (t.status === '完了' || t.status === 'アーカイブ済み') continue;
      if (t.assigneeId !== memberId) continue;
      if (!t.focusThisWeek) continue;
      if (t.recurrence === 'daily' && this.dailyStartWeek(t) > 0) continue;

      countedTaskIds.add(t.id);

      let hours = t.focusHours ?? t.estimatedHours ?? 0;
      if (t.recurrence === 'daily' && t.focusHours == null) {
        hours = (t.estimatedHours ?? 0) * this.getWorkingDays(memberId, 0);
      }

      const children = tasks.filter((c) => c.parentId === t.id);

      if (children.length > 0) {
        const assignedChildHours = children
          .filter(
            (c) =>
              c.assigneeId !== null || c.status === '完了' || c.status === 'アーカイブ済み',
          )
          .reduce((sum, c) => sum + (c.estimatedHours ?? 0), 0);
        const remaining = Math.max(0, hours - assignedChildHours);
        totalHours += remaining;
      } else {
        totalHours += hours;
      }
    }

    // 親タスクがフォーカス中の場合、その子タスクの時間も担当者に加算
    for (const t of tasks) {
      if (t.status === '完了' || t.status === 'アーカイブ済み') continue;
      if (t.assigneeId !== memberId) continue;
      if (!t.parentId) continue;
      if (countedTaskIds.has(t.id)) continue;
      if (t.recurrence === 'daily' && this.dailyStartWeek(t) > 0) continue;

      const parent = tasks.find((p) => p.id === t.parentId);
      if (parent && parent.focusThisWeek && (parent.recurrence !== 'daily' || this.dailyStartWeek(parent) === 0)) {
        totalHours += t.estimatedHours ?? 0;
      }
    }

    return totalHours;
  }

  getFocusLoadPercent(memberId: string): number {
    const focusHours = this.getMemberFocusHours(memberId);
    const cap = this.getEffectiveCapacity(memberId, 0);
    return calculateLoadPercent(focusHours, cap);
  }

  getMemberFocusTaskCount(memberId: string): number {
    return this.tasks().filter(
      (t) =>
        t.assigneeId === memberId &&
        t.status !== '完了' &&
        t.status !== 'アーカイブ済み' &&
        (t.recurrence !== 'daily' || this.dailyStartWeek(t) === 0) &&
        t.focusThisWeek,
    ).length;
  }

  async toggleFocus(taskId: string, focusThisWeek: boolean, focusHours?: number): Promise<void> {
    const ref = doc(this.firestore, 'tasks', taskId);
    const task = this.tasks().find((t) => t.id === taskId);
    if (focusThisWeek) {
      const estimatedHours = task?.estimatedHours ?? 0;
      await updateDoc(ref, {
        focusThisWeek: true,
        focusHours: this.capFocusHours(
          focusHours ?? task?.focusHours ?? estimatedHours,
          estimatedHours,
        ),
        targetWeekStart: Timestamp.fromDate(getWeekMonday(new Date())),
      });
    } else {
      const targetWeek = task?.targetWeekStart?.toDate();
      const currentWeek = getWeekMonday(new Date());
      const clearTargetWeek =
        targetWeek && getWeekMonday(targetWeek).getTime() === currentWeek.getTime();
      await updateDoc(ref, {
        focusThisWeek: false,
        focusHours: null,
        ...(clearTargetWeek ? { targetWeekStart: null } : {}),
      });
    }
    this.addActivity(taskId, 'focus_change', focusThisWeek ? 'OFF' : 'ON', focusThisWeek ? 'ON' : 'OFF').catch(() => {});
  }

  getMemberWeeklyHours(memberId: string): number[] {
    const tasks = this.tasks();
    const weekly = [0, 0, 0, 0];

    for (const t of tasks) {
      if (t.status === '完了' || t.status === 'アーカイブ済み') continue;
      if (t.assigneeId !== memberId) continue;

      const weekIndices: { idx: number; hours: number }[] = [];

      if (t.focusThisWeek && (t.recurrence !== 'daily' || this.dailyStartWeek(t) === 0)) {
        weekIndices.push({ idx: 0, hours: t.focusHours ?? t.estimatedHours ?? 0 });
      }

      const scheduledWeek = t.targetWeekStart
        ? getWeekIndex(t.targetWeekStart instanceof Timestamp ? t.targetWeekStart.toDate() : new Date(t.targetWeekStart))
        : t.dueDate
          ? getWeekIndex(t.dueDate instanceof Timestamp ? t.dueDate.toDate() : new Date(t.dueDate))
          : null;

      if (scheduledWeek !== null && scheduledWeek > 0 && !weekIndices.some((w) => w.idx === scheduledWeek)) {
        weekIndices.push({ idx: scheduledWeek, hours: t.estimatedHours ?? 0 });
      }

      if (t.recurrence) {
        const perOccurrence = t.estimatedHours ?? 0;
        if (t.recurrence === 'daily') {
          for (let w = this.dailyStartWeek(t); w <= 3; w++) {
            const weeklyTotal = w === 0 && t.focusThisWeek && t.focusHours != null
              ? t.focusHours
              : perOccurrence * this.getWorkingDays(memberId, w);
            const existing = weekIndices.find((wi) => wi.idx === w);
            if (existing) {
              existing.hours = weeklyTotal;
            } else {
              weekIndices.push({ idx: w, hours: weeklyTotal });
            }
          }
        } else {
          const baseWeek = weekIndices.length > 0 ? Math.min(...weekIndices.map((w) => w.idx)) : 0;
          const step = t.recurrence === 'weekly' ? 1 : t.recurrence === 'biweekly' ? 2 : 4;
          for (let w = baseWeek + step; w <= 3; w += step) {
            if (!weekIndices.some((wi) => wi.idx === w)) {
              weekIndices.push({ idx: w, hours: perOccurrence });
            }
          }
        }
      }

      if (weekIndices.length === 0 && t.parentId && !(t.recurrence === 'daily' && this.dailyStartWeek(t) > 0)) {
        const parent = tasks.find((p) => p.id === t.parentId);
        if (parent) {
          let parentIdx: number | null = null;
          if (parent.focusThisWeek && (parent.recurrence !== 'daily' || this.dailyStartWeek(parent) === 0)) {
            parentIdx = 0;
          } else {
            parentIdx = parent.targetWeekStart
              ? getWeekIndex(parent.targetWeekStart instanceof Timestamp ? parent.targetWeekStart.toDate() : new Date(parent.targetWeekStart))
              : parent.dueDate
                ? getWeekIndex(parent.dueDate instanceof Timestamp ? parent.dueDate.toDate() : new Date(parent.dueDate))
                : null;
          }
          if (parentIdx !== null) {
            weekIndices.push({ idx: Math.max(0, Math.min(parentIdx, 3)), hours: t.estimatedHours ?? 0 });
          }
        }
      }

      if (weekIndices.length === 0) continue;

      const children = tasks.filter((c) => c.parentId === t.id);
      for (const { idx, hours } of weekIndices) {
        if (children.length > 0) {
          const assignedChildHours = children
            .filter(
              (c) =>
                c.assigneeId !== null || c.status === '完了' || c.status === 'アーカイブ済み',
            )
            .reduce((sum, c) => sum + (c.estimatedHours ?? 0), 0);
          const remaining = Math.max(0, hours - assignedChildHours);
          weekly[idx] += remaining;
        } else {
          weekly[idx] += hours;
        }
      }
    }

    return weekly;
  }

  getMemberWeeklyTaskCounts(memberId: string): number[] {
    const tasks = this.tasks();
    const counts = [0, 0, 0, 0];

    for (const t of tasks) {
      if (t.status === '完了' || t.status === 'アーカイブ済み') continue;
      if (t.assigneeId !== memberId) continue;
      if (t.parentId) continue;

      const counted = new Set<number>();

      if (t.focusThisWeek && (t.recurrence !== 'daily' || this.dailyStartWeek(t) === 0)) {
        counted.add(0);
      }

      const scheduledWeek = t.targetWeekStart
        ? getWeekIndex(t.targetWeekStart instanceof Timestamp ? t.targetWeekStart.toDate() : new Date(t.targetWeekStart))
        : t.dueDate
          ? getWeekIndex(t.dueDate instanceof Timestamp ? t.dueDate.toDate() : new Date(t.dueDate))
          : null;

      if (scheduledWeek !== null && scheduledWeek > 0) {
        counted.add(scheduledWeek);
      }

      if (t.recurrence === 'daily') {
        for (let w = this.dailyStartWeek(t); w <= 3; w++) counted.add(w);
      } else if (t.recurrence) {
        const baseWeek = counted.size > 0 ? Math.min(...counted) : 0;
        const step = t.recurrence === 'weekly' ? 1 : t.recurrence === 'biweekly' ? 2 : 4;
        for (let w = baseWeek + step; w <= 3; w += step) {
          counted.add(w);
        }
      }

      if (counted.size === 0) continue;
      for (const idx of counted) {
        counts[idx]++;
      }
    }

    return counts;
  }

  getEffectiveCapacity(memberId: string, weekIndex: number): number {
    if (this.teamSettings()?._error) return Number.NaN;
    const member = this.members().find((m) => m.uid === memberId);
    if (!member || !member.weeklyCapacityHours || member.weeklyCapacityHours <= 0) return 0;
    const workingDays = this.getWorkingDays(memberId, weekIndex);
    return member.weeklyCapacityHours * (workingDays / 5);
  }

  getWeeklyLoadPercent(memberId: string, weekHours: number, weekIndex: number = 0): number {
    const cap = this.getEffectiveCapacity(memberId, weekIndex);
    return calculateLoadPercent(weekHours, cap);
  }

  getComments(taskId: string): Observable<TaskComment[]> {
    return runInInjectionContext(this.injector, () => {
      const commentsCol = collection(this.firestore, 'tasks', taskId, 'comments');
      return collectionData(query(commentsCol, orderBy('createdAt')), {
        idField: 'id',
      }) as Observable<TaskComment[]>;
    });
  }

  async addComment(
    taskId: string,
    text: string,
    authorId: string,
    authorName: string,
  ): Promise<void> {
    const commentsCol = collection(this.firestore, 'tasks', taskId, 'comments');
    await addDoc(commentsCol, {
      taskId,
      text,
      authorId,
      authorName,
      createdAt: serverTimestamp(),
    });
  }

  async deleteComment(taskId: string, commentId: string): Promise<void> {
    const ref = doc(this.firestore, 'tasks', taskId, 'comments', commentId);
    await deleteDoc(ref);
  }

  // 自分が担当するタスクへの新着コメントを監視
  watchMyTaskComments(
    myUid: string,
    onNewComment: (taskTitle: string, authorName: string, text: string) => void,
  ): void {
    const myTasks = this.tasks().filter((t) => t.assigneeId === myUid && t.status !== '完了');

    myTasks.forEach((task) => {
      if (this.watchedTaskIds.has(task.id)) return;
      this.watchedTaskIds.add(task.id);

      const commentsCol = collection(this.firestore, 'tasks', task.id, 'comments');
      const q = query(commentsCol, orderBy('createdAt'));

      let initialized = false;
      let knownCount = 0;

      runInInjectionContext(this.injector, () => {
        collectionData(q, { idField: 'id' }).subscribe(async (comments: any[]) => {
          if (!initialized) {
            knownCount = comments.length;
            initialized = true;
            return;
          }
          if (comments.length > knownCount) {
            const newComment = comments[comments.length - 1];
            if (newComment.authorId !== myUid) {
              // トーストだけ表示（通知保存はコメント送信側で行う）
              onNewComment(task.title, newComment.authorName, newComment.text);
            }
            knownCount = comments.length;
          }
        });
      });
    });
  }

  // 通知を取得(リアルタイム購読)
  getNotifications(uid: string): Observable<TaskNotification[]> {
    return runInInjectionContext(this.injector, () => {
      const notifCol = collection(this.firestore, 'members', uid, 'notifications');
      return collectionData(query(notifCol, orderBy('createdAt', 'desc')), {
        idField: 'id',
      }) as Observable<TaskNotification[]>;
    });
  }

  // 通知を追加
  async addNotification(uid: string, data: Omit<TaskNotification, 'id'>): Promise<void> {
    const notifCol = collection(this.firestore, 'members', uid, 'notifications');
    await addDoc(notifCol, {
      ...data,
      createdAt: serverTimestamp(),
    });
  }

  // 通知を既読にする
  async markAsRead(uid: string, notifId: string): Promise<void> {
    const ref = doc(this.firestore, 'members', uid, 'notifications', notifId);
    await updateDoc(ref, { read: true });
  }

  // 通知を1件削除
  async deleteNotification(uid: string, notifId: string): Promise<void> {
    const ref = doc(this.firestore, 'members', uid, 'notifications', notifId);
    await deleteDoc(ref);
  }

  // 全通知を既読にする
  async markAllAsRead(uid: string): Promise<void> {
    const notifCol = collection(this.firestore, 'members', uid, 'notifications');
    const snap = await getDocs(notifCol);
    const batch = writeBatch(this.firestore);
    snap.docs.forEach((d) => {
      if (!d.data()['read']) {
        batch.update(d.ref, { read: true });
      }
    });
    await batch.commit();
  }

  // ===== リアクション =====
  async toggleReaction(taskId: string, commentId: string, emoji: string): Promise<void> {
    const uid = this.auth.currentUser?.uid;
    if (!uid) return;
    const ref = doc(this.firestore, 'tasks', taskId, 'comments', commentId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const data = snap.data();
    const reactions: Record<string, string[]> = data?.['reactions'] ?? {};
    const users = reactions[emoji] ?? [];
    if (users.includes(uid)) {
      reactions[emoji] = users.filter((u) => u !== uid);
      if (reactions[emoji].length === 0) delete reactions[emoji];
    } else {
      reactions[emoji] = [...users, uid];
    }
    await updateDoc(ref, { reactions });
  }

  // ===== アクティビティログ =====
  async addActivity(
    taskId: string,
    type: TaskActivity['type'],
    oldValue?: string | null,
    newValue?: string | null,
  ): Promise<void> {
    const uid = this.auth.currentUser?.uid;
    if (!uid) return;
    const member = this.members().find((m) => m.uid === uid);
    const col = collection(this.firestore, 'tasks', taskId, 'activities');
    await addDoc(col, {
      taskId,
      type,
      authorId: uid,
      authorName: member?.name ?? '不明',
      oldValue: oldValue ?? null,
      newValue: newValue ?? null,
      createdAt: serverTimestamp(),
    });
  }

  private formatActivityDueDate(dueDate: Timestamp | null | undefined): string {
    if (!dueDate) return '未設定';
    const date = dueDate.toDate();
    return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
  }

  getActivities(taskId: string): Observable<TaskActivity[]> {
    return runInInjectionContext(this.injector, () => {
      const col = collection(this.firestore, 'tasks', taskId, 'activities');
      const q = query(col, orderBy('createdAt', 'asc'));
      return collectionData(q, { idField: 'id' }) as Observable<TaskActivity[]>;
    });
  }

  // ===== ファイル添付 =====
  getAttachments(taskId: string): Observable<TaskAttachment[]> {
    return runInInjectionContext(this.injector, () => {
      const col = collection(this.firestore, 'tasks', taskId, 'attachments');
      const q = query(col, orderBy('createdAt', 'desc'));
      return collectionData(q, { idField: 'id' }) as Observable<TaskAttachment[]>;
    });
  }

  async addAttachment(
    taskId: string,
    fileName: string,
    fileType: string,
    fileSize: number,
    file: File,
  ): Promise<void> {
    const uid = this.auth.currentUser?.uid;
    if (!uid) return;
    const member = this.members().find((m) => m.uid === uid);
    const timestamp = Date.now();
    const safeName = fileName.replace(/[^a-zA-Z0-9._\-　-鿿豈-﫿]/g, '_');
    const path = `task-attachments/${taskId}/${uid}/${timestamp}_${safeName}`;
    const fileRef = storageRef(this.storage, path);
    await uploadBytes(fileRef, file);
    const downloadUrl = await getDownloadURL(fileRef);
    const col = collection(this.firestore, 'tasks', taskId, 'attachments');
    await addDoc(col, {
      taskId,
      fileName,
      fileType,
      fileSize,
      dataUrl: downloadUrl,
      storagePath: path,
      authorId: uid,
      authorName: member?.name ?? '不明',
      createdAt: serverTimestamp(),
    });
  }

  async deleteAttachment(taskId: string, attachmentId: string): Promise<void> {
    const docRef = doc(this.firestore, 'tasks', taskId, 'attachments', attachmentId);
    const snap = await getDoc(docRef);
    const data = snap.data();
    if (!snap.exists()) return;
    if (!this.auth.currentUser || data?.['authorId'] !== this.auth.currentUser.uid) {
      throw Object.assign(new Error('Only the attachment author can delete it'), { code: 'permission-denied' });
    }
    if (data?.['storagePath']) {
      const path = data['storagePath'] as string;
      const legacyPrefix = `task-attachments/${taskId}/`;
      const legacyFileName = path.startsWith(legacyPrefix) ? path.slice(legacyPrefix.length) : '';
      if (legacyFileName && !legacyFileName.includes('/')) {
        // Legacy filenames lack a UID. Rules verify this claim against the original attachment.
        const ownerRef = doc(this.firestore, 'tasks', taskId, 'attachmentOwners', legacyFileName);
        const owner = await getDoc(ownerRef);
        if (!owner.exists()) {
          await setDoc(ownerRef, { attachmentId, authorId: this.auth.currentUser.uid });
        }
      }
      try {
        await runInInjectionContext(this.injector, () => {
          const fileRef = storageRef(this.storage, data['storagePath']);
          return deleteObject(fileRef);
        });
      } catch (error) {
        // A missing file must not prevent removal of its attachment record.
        if ((error as { code?: string })?.code !== 'storage/object-not-found') throw error;
      }
    }
    await deleteDoc(docRef);
  }

  // --- 繰り返しタスク生成 ---

  async retryRecurrence(taskId: string): Promise<void> {
    const snapshot = await getDoc(doc(this.firestore, 'tasks', taskId));
    if (!snapshot.exists()) throw new Error('元のタスクが見つかりません');
    await this.spawnRecurrence({ ...snapshot.data(), id: taskId } as Task);
  }

  async spawnRecurrence(task: Task): Promise<void> {
    if (!task.recurrence) return;
    // Adopt an occurrence generated by the previous implementation rather than
    // adding another one when an older completed task is retried.
    const legacy = await getDocs(query(this.tasksCollection, where('recurrencePreviousTaskId', '==', task.id)));
    if (legacy.docs.length > 1) throw new Error('既存の次回タスクが複数あります。管理者に確認してください');
    const sourceRef = doc(this.firestore, 'tasks', task.id);
    const nextRef = legacy.docs[0]?.ref ?? doc(this.tasksCollection);
    const result = await runTransaction(this.firestore, async transaction => {
      const snapshot = await transaction.get(sourceRef);
      if (!snapshot.exists()) throw new Error('元のタスクが見つかりません');
      const source = snapshot.data() as Task;
      if (source.recurrenceNextTaskId) return { created: false, source };
      if (!source.recurrence || !['完了', 'アーカイブ済み'].includes(source.status)) {
        throw new Error('完了済みの繰り返しタスクのみ次回を作成できます');
      }
      if (legacy.docs.length) {
        const existing = await transaction.get(nextRef);
        if (!existing.exists() || existing.data()['recurrencePreviousTaskId'] !== task.id) {
          throw new Error('次回タスクが変更されました。再度お試しください');
        }
      } else {
        const nextDue = this.calcNextDueDate(source.dueDate?.toDate() ?? source.statusUpdatedAt?.toDate() ?? new Date(), source.recurrence);
        transaction.set(nextRef, {
          title: source.title, description: source.description ?? '', parentId: source.parentId ?? null,
          assigneeId: source.assigneeId ?? null, createdBy: source.createdBy ?? null, estimatedHours: source.estimatedHours,
          actualHours: null, dueDate: Timestamp.fromDate(nextDue), blockedBy: [], order: Date.now(),
          createdAt: serverTimestamp(), statusUpdatedAt: serverTimestamp(), status: '未着手',
          reviewReason: null, proposedDueDate: null, priority: source.priority ?? null,
          focusThisWeek: false, focusHours: null, targetWeekStart: Timestamp.fromDate(getWeekMonday(nextDue)),
          recurrence: source.recurrence, recurrenceSourceId: source.recurrenceSourceId ?? task.id,
          recurrencePreviousTaskId: task.id,
        });
      }
      transaction.update(sourceRef, { recurrenceNextTaskId: nextRef.id });
      return { created: legacy.docs.length === 0, source };
    });
    if (result.created) {
      this.addActivity(nextRef.id, 'created').catch(() => {});
      const actor = this.members().find(member => member.uid === this.auth.currentUser?.uid);
      const targets = new Set(this.members().filter(member => member.role === 'manager').map(member => member.uid));
      if (result.source.assigneeId) targets.add(result.source.assigneeId);
      targets.delete(this.auth.currentUser?.uid ?? '');
      for (const uid of targets) {
        this.addNotification(uid, {
          taskId: nextRef.id, taskTitle: result.source.title, authorName: actor?.name ?? 'システム',
          text: '新しいタスクが作成されました。', read: false, createdAt: null as any, type: 'task_created',
        }).catch(error => console.error('通知作成エラー:', error));
      }
    }
    if (result.source.parentId) await this.syncParentEstimate(result.source.parentId);
  }

  private calcNextDueDate(base: Date, type: RecurrenceType): Date {
    const d = new Date(base);
    switch (type) {
      case 'daily': d.setDate(d.getDate() + 1); break;
      case 'weekly': d.setDate(d.getDate() + 7); break;
      case 'biweekly': d.setDate(d.getDate() + 14); break;
      case 'monthly': {
        const originalDay = base.getDate();
        d.setMonth(d.getMonth() + 1, 1);
        const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        d.setDate(Math.min(originalDay, lastDay));
        break;
      }
    }
    return d;
  }

  // --- テンプレート ---

  async createTemplate(data: Omit<TaskTemplate, 'id' | 'createdAt'>): Promise<string> {
    const uid = this.auth.currentUser?.uid;
    if (!uid) throw new Error('ログインしてください');
    const docRef = await addDoc(this.templatesCollection, {
      ...data,
      createdBy: uid,
      createdAt: serverTimestamp(),
    });
    return docRef.id;
  }

  async updateTemplate(id: string, data: Partial<Omit<TaskTemplate, 'id' | 'createdAt'>>): Promise<void> {
    const ref = doc(this.firestore, 'taskTemplates', id);
    await updateDoc(ref, data);
  }

  async deleteTemplate(id: string): Promise<void> {
    const ref = doc(this.firestore, 'taskTemplates', id);
    await deleteDoc(ref);
  }

  async createTaskFromTemplate(template: TaskTemplate, overrides: { assigneeId: string | null; status: TaskStatus; createdBy: string | null }): Promise<string> {
    const taskId = await this.createTask({
      title: template.title,
      description: template.description,
      priority: template.priority,
      estimatedHours: template.estimatedHours,
      ...overrides,
    });

    for (const sub of template.subtasks) {
      await this.createTask({
        title: sub.title,
        estimatedHours: sub.estimatedHours,
        parentId: taskId,
        assigneeId: null,
        createdBy: overrides.createdBy,
        status: '未着手',
      });
    }

    return taskId;
  }
}

export function getNewHolidays(current: TeamHoliday[], holidays: TeamHoliday[]): TeamHoliday[] {
      const dates = new Set(current.map(holiday => holiday.date));
      return holidays.filter(holiday => {
        if (dates.has(holiday.date)) return false;
        dates.add(holiday.date);
        return true;
      });
}
