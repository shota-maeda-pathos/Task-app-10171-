import { Injectable, signal } from '@angular/core';

export interface ToastMessage {
  id: number;
  title: string;
  body: string;
  retry?: () => Promise<void>;
  busy?: boolean;
}

@Injectable({ providedIn: 'root' })
export class NotificationService {
  toasts = signal<ToastMessage[]>([]);
  private nextId = 0;

  show(title: string, body: string, durationMs = 4000): void {
    const id = this.nextId++;
    // 常に最新1件だけ表示（連打しても山積みにならない）
    this.toasts.update(toasts => [...toasts.filter(toast => toast.retry), { id, title, body }]);
    setTimeout(() => this.dismiss(id), durationMs);
  }

  showRetry(retry: () => Promise<void>): void {
    const id = this.nextId++;
    this.toasts.update(toasts => [...toasts.filter(toast => toast.retry), {
      id, title: '次回生成エラー', body: 'タスクは完了しました。次回タスクを作れませんでした。', retry,
    }]);
  }

  async runRetry(id: number): Promise<void> {
    const toast = this.toasts().find(toast => toast.id === id);
    if (!toast?.retry || toast.busy) return;
    this.toasts.update(toasts => toasts.map(item => item.id === id ? { ...item, busy: true } : item));
    try {
      await toast.retry();
      this.dismiss(id);
      this.show('次回生成', '次回タスクの生成を確認しました');
    } catch {
      this.toasts.update(toasts => toasts.map(item => item.id === id ? {
        ...item, busy: false, body: '次回生成に失敗しました。通信状態を確認して再試行してください。',
      } : item));
    }
  }

  dismiss(id: number): void {
    this.toasts.update((t) => t.filter((m) => m.id !== id));
  }
}
