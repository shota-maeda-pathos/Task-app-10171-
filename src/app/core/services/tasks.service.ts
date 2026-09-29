import { Injectable, inject, Injector, runInInjectionContext } from '@angular/core';
import { Auth, user } from '@angular/fire/auth';
import { toSignal } from '@angular/core/rxjs-interop';
import { Observable, switchMap, of, map } from 'rxjs';
import { Firestore, collectionData } from '@angular/fire/firestore';
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
} from '../models/task.model';

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
  private auth = inject(Auth);
  private injector = inject(Injector);
  private tasksCollection = collection(this.firestore, 'tasks');
  private membersCollection = collection(this.firestore, 'members');
  private watchedTaskIds = new Set<string>();

  tasks = toSignal(
    user(this.auth).pipe(
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

  members = toSignal(
    user(this.auth).pipe(
      switchMap((currentUser) => {
        if (!currentUser) return of([]);
        return runInInjectionContext(this.injector, () =>
          collectionData(this.membersCollection, { idField: 'uid' }),
        );
      }),
    ) as Observable<Member[]>,
    { initialValue: [] as Member[] },
  );

  // --- CRUD ---

  async createTask(data: Partial<Task>): Promise<string> {
    const docRef = await addDoc(this.tasksCollection, {
      title: data.title ?? '',
      description: data.description ?? '',
      parentId: data.parentId ?? null,
      assigneeId: data.assigneeId ?? null,
      createdBy: data.createdBy ?? null,
      status: data.status ?? '未着手',
      estimatedHours: data.estimatedHours ?? 0,
      actualHours: null,
      dueDate: data.dueDate ?? null,
      blockedBy: data.blockedBy ?? [],
      order: data.order ?? Date.now(),
      createdAt: serverTimestamp(),
      statusUpdatedAt: serverTimestamp(),
      reviewReason: null,
      proposedDueDate: null,
      priority: data.priority ?? null,
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
    const parentSnap = await getDoc(parentRef);
    if (!parentSnap.exists()) return;
    const parentData = parentSnap.data() as Task;

    const childrenQuery = query(this.tasksCollection, where('parentId', '==', parentId));
    const childrenSnap = await getDocs(childrenQuery);
    const childTotal = childrenSnap.docs.reduce(
      (sum, d) => sum + ((d.data() as Task).estimatedHours ?? 0),
      0,
    );

    if (childTotal > (parentData.estimatedHours ?? 0)) {
      await updateDoc(parentRef, { estimatedHours: childTotal });
    }
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
  }

  async updateTask(taskId: string, data: Partial<Task>): Promise<void> {
    const task = this.tasks().find((t) => t.id === taskId);
    const ref = doc(this.firestore, 'tasks', taskId);
    await updateDoc(ref, data);

    if (data.assigneeId !== undefined && task && data.assigneeId !== task.assigneeId) {
      const oldName = this.members().find((m) => m.uid === task.assigneeId)?.name ?? '未割当';
      const newName = this.members().find((m) => m.uid === data.assigneeId)?.name ?? '未割当';
      this.addActivity(taskId, 'assignee_change', oldName, newName).catch(() => {});
    }

    if (data.priority !== undefined && task && data.priority !== task.priority) {
      const labels: Record<string, string> = { high: '高', medium: '中', low: '低' };
      const oldLabel = labels[task.priority ?? ''] ?? '未設定';
      const newLabel = labels[data.priority ?? ''] ?? '未設定';
      this.addActivity(taskId, 'priority_change', oldLabel, newLabel).catch(() => {});
    }

    // 見積もり時間が変わった場合、親タスクも同期する
    if (data.estimatedHours !== undefined) {
      if (task?.parentId) {
        await this.syncParentEstimate(task.parentId);
      }
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

  async completeTask(taskId: string, actualHours: number): Promise<void> {
    const task = this.tasks().find((t) => t.id === taskId);
    const oldStatus = task?.status ?? null;
    const ref = doc(this.firestore, 'tasks', taskId);
    await updateDoc(ref, {
      status: '完了',
      actualHours,
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
  }

  async deleteTask(taskId: string): Promise<void> {
    const task = this.tasks().find((t) => t.id === taskId);
    const parentId = task?.parentId ?? null;

    // 子タスクがあれば道連れで消す
    const children = this.tasks().filter((t) => t.parentId === taskId);
    for (const child of children) {
      await deleteDoc(doc(this.firestore, 'tasks', child.id));
    }
    await deleteDoc(doc(this.firestore, 'tasks', taskId));

    // 親タスクがある場合、削除後に親の見積もりを再計算して更新
    if (parentId) {
      await this.syncParentAfterDelete(parentId);
    }
  }

  private async syncParentAfterDelete(parentId: string): Promise<void> {
    const parentRef = doc(this.firestore, 'tasks', parentId);
    const parentSnap = await getDoc(parentRef);
    if (!parentSnap.exists()) return;
    const parentData = parentSnap.data() as Task;

    const childrenQuery = query(this.tasksCollection, where('parentId', '==', parentId));
    const childrenSnap = await getDocs(childrenQuery);
    const remainingTotal = childrenSnap.docs.reduce(
      (sum, d) => sum + ((d.data() as Task).estimatedHours ?? 0),
      0,
    );

    if (remainingTotal !== (parentData.estimatedHours ?? 0)) {
      await updateDoc(parentRef, { estimatedHours: remainingTotal });
    }
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

    // メンバードキュメントを削除
    const ref = doc(this.firestore, 'members', memberId);
    await deleteDoc(ref);
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
    const ref = doc(this.firestore, 'tasks', taskId);
    await updateDoc(ref, {
      status: '未着手',
      dueDate: task?.proposedDueDate ?? task?.dueDate ?? null,
      reviewReason: null,
      proposedDueDate: null,
      statusUpdatedAt: serverTimestamp(),
    });

    this.addActivity(taskId, 'review_approve', '差し戻し中', '未着手').catch(() => {});

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
        // 親タスクの場合: 子タスクに割り当てられていない残り時間だけを負荷として計上
        const assignedChildHours = children
          .filter(
            (c) => c.status !== '完了' && c.status !== 'アーカイブ済み' && c.assigneeId !== null,
          )
          .reduce((sum, c) => sum + (c.estimatedHours ?? 0), 0);
        const remaining = Math.max(0, (t.estimatedHours ?? 0) - assignedChildHours);
        totalHours += remaining;
      } else {
        // 通常タスク・子タスクはそのまま計上
        totalHours += t.estimatedHours ?? 0;
      }
    }

    return totalHours;
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
    dataUrl: string,
  ): Promise<void> {
    const uid = this.auth.currentUser?.uid;
    if (!uid) return;
    const member = this.members().find((m) => m.uid === uid);
    const col = collection(this.firestore, 'tasks', taskId, 'attachments');
    await addDoc(col, {
      taskId,
      fileName,
      fileType,
      fileSize,
      dataUrl,
      authorId: uid,
      authorName: member?.name ?? '不明',
      createdAt: serverTimestamp(),
    });
  }

  async deleteAttachment(taskId: string, attachmentId: string): Promise<void> {
    const ref = doc(this.firestore, 'tasks', taskId, 'attachments', attachmentId);
    await deleteDoc(ref);
  }
}
