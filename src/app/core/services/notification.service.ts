import { Injectable, signal } from '@angular/core';

export interface ToastMessage {
  id: number;
  title: string;
  body: string;
}

@Injectable({ providedIn: 'root' })
export class NotificationService {
  toasts = signal<ToastMessage[]>([]);
  private nextId = 0;

  show(title: string, body: string, durationMs = 4000): void {
    const id = this.nextId++;
    // 常に最新1件だけ表示（連打しても山積みにならない）
    this.toasts.set([{ id, title, body }]);
    setTimeout(() => this.dismiss(id), durationMs);
  }

  showRecurrenceFailure(): void {
    this.show('次回生成エラー', 'タスクは完了しました。次回タスクを作れませんでした。「次回タスクが未生成です」から再試行してください。');
  }

  dismiss(id: number): void {
    this.toasts.update((t) => t.filter((m) => m.id !== id));
  }
}
