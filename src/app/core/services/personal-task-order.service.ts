import { Injectable, Injector, effect, inject, runInInjectionContext, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Firestore, collectionData } from '@angular/fire/firestore';
import { collection, doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { catchError, map, of, switchMap } from 'rxjs';
import { AuthService } from './auth.service';
import { TasksService } from './tasks.service';
import { Task } from '../models/task.model';

export function applyPersonalOrder<T extends { id: string }>(items: T[], ids: string[]): T[] {
  const ranks = new Map(ids.map((id, index) => [id, index]));
  return [...items].sort((a, b) => (ranks.get(a.id) ?? Infinity) - (ranks.get(b.id) ?? Infinity));
}

export function mergeVisibleOrder(fullIds: string[], visibleIds: string[]): string[] {
  const visible = new Set(visibleIds);
  let next = 0;
  return fullIds.map(id => visible.has(id) ? visibleIds[next++] : id);
}

@Injectable({ providedIn: 'root' })
export class PersonalTaskOrderService {
  private auth = inject(AuthService);
  private firestore = inject(Firestore);
  private injector = inject(Injector);
  private tasksService = inject(TasksService);
  private pending = signal(new Map<string, { uid: string; scope: string; ids: string[]; committed: boolean }>());
  private saves = new Map<string, Promise<void>>();
  private state = toSignal(toObservable(this.auth.currentUser).pipe(switchMap(user => {
    if (!user) return of(null);
    return runInInjectionContext(this.injector, () => collectionData(
      collection(this.firestore, 'members', user.uid, 'taskOrders'), { idField: 'scope' },
    )).pipe(
      map(records => ({ uid: user.uid, error: false, records })),
      catchError(() => of({ uid: user.uid, error: true, records: [] })),
    );
  })), { initialValue: null });

  constructor() {
    effect(() => this.clearAcknowledgedOrders());
  }

  private clearAcknowledgedOrders(): void {
    const state = this.state();
    const uid = this.auth.currentUser()?.uid;
    const pending = this.pending();
    const next = new Map(pending);
    for (const [key, entry] of pending) {
      const saved = state && state.uid === uid ? state.records.find(record => record['scope'] === entry.scope)?.['taskIds'] : null;
      if (entry.uid !== uid || (entry.committed && Array.isArray(saved) && saved.length === entry.ids.length && saved.every((id, index) => id === entry.ids[index]))) next.delete(key);
    }
    if (next.size !== pending.size) this.pending.set(next);
  }

  canReorder(): boolean {
    const state = this.state();
    return !!state && state.uid === this.auth.currentUser()?.uid && !state.error;
  }

  sort(tasks: Task[], scope: string): Task[] {
    const state = this.state();
    if (!state || state.uid !== this.auth.currentUser()?.uid || state.error) return [...tasks];
    const local = this.pending().get(JSON.stringify([state.uid, scope]));
    const ids = local?.ids ?? state.records.find(record => record['scope'] === scope)?.['taskIds'];
    return applyPersonalOrder(tasks, Array.isArray(ids) ? ids.filter(id => typeof id === 'string') : []);
  }

  async reorder(scope: string, orderedIds: string[]): Promise<void> {
    const uid = this.auth.currentUser()?.uid;
    if (!uid || !this.canReorder()) throw new Error('個人の並び順を取得できていません。再読み込みしてください');
    const tasks = this.tasksService.tasks().filter(task => scope.startsWith('children:')
      ? task.parentId === scope.slice(9)
      : !task.parentId && (scope === 'root:進行中' ? ['進行中', '差し戻し中'].includes(task.status) : scope === `root:${task.status}`));
    const base = [...tasks].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    const validIds = new Set(base.map(task => task.id));
    if (new Set(orderedIds).size !== orderedIds.length || orderedIds.some(id => !validIds.has(id))) {
      throw new Error('タスクの並び順が更新中に変更されました');
    }
    const reference = doc(this.firestore, 'members', uid, 'taskOrders', scope);
    const key = JSON.stringify([uid, scope]);
    const entry = { uid, scope, ids: mergeVisibleOrder(this.sort(base, scope).map(task => task.id), orderedIds), committed: false };
    this.pending.update(entries => new Map(entries).set(key, entry));
    const previous = this.saves.get(key) ?? Promise.resolve();
    const save = previous.catch(() => {}).then(() => runTransaction(this.firestore, async transaction => {
      const snapshot = await transaction.get(reference);
      const saved = snapshot.exists() ? snapshot.data()['taskIds'] : [];
      const fullIds = applyPersonalOrder(base, Array.isArray(saved) ? saved : []).map(task => task.id);
      const taskIds = mergeVisibleOrder(fullIds, orderedIds);
      if (taskIds.length > 3000) throw new Error('この一覧の並び替えは3000件までです');
      transaction.set(reference, { taskIds, updatedAt: serverTimestamp() });
      return taskIds;
    })).then(taskIds => {
      if (this.pending().get(key) === entry) {
        entry.ids = taskIds;
        entry.committed = true;
        this.pending.update(entries => new Map(entries));
        this.clearAcknowledgedOrders();
      }
    }).catch(error => {
      if (this.pending().get(key) === entry) this.pending.update(entries => { const next = new Map(entries); next.delete(key); return next; });
      throw error;
    });
    this.saves.set(key, save);
    try { await save; }
    finally { if (this.saves.get(key) === save) this.saves.delete(key); }
  }
}
