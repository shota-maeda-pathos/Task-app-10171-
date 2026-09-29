import { afterRenderEffect, Component, ElementRef, inject, input, output, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { TasksService } from '../../../core/services/tasks.service';
import { AuthService } from '../../../core/services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { Task, TaskComment, TaskActivity, TaskAttachment } from '../../../core/models/task.model';
import { of, switchMap, combineLatest, map, catchError } from 'rxjs';

@Component({
  selector: 'app-comment-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './comment-panel.html',
  styleUrl: './comment-panel.scss',
})
export class CommentPanelComponent {
  tasksService = inject(TasksService);
  auth = inject(AuthService);
  notificationService = inject(NotificationService);

  task = input<Task | null>(null);
  closed = output<void>();
  commentsList = viewChild<ElementRef<HTMLDivElement>>('commentsList');
  private shouldFollowLatest = true;
  private lastTaskId: string | null = null;

  panelTab = signal<'comments' | 'history'>('comments');

  newComment = '';
  isSubmitting = signal(false);

  comments = toSignal(
    toObservable(this.task).pipe(
      switchMap((t) => {
        if (!t) return of([] as TaskComment[]);
        return this.tasksService.getComments(t.id);
      }),
    ),
    { initialValue: [] as TaskComment[] },
  );

  activities = toSignal(
    toObservable(this.task).pipe(
      switchMap((t) => {
        if (!t) return of([] as TaskActivity[]);
        return this.tasksService.getActivities(t.id).pipe(
          catchError(() => of([] as TaskActivity[])),
        );
      }),
    ),
    { initialValue: [] as TaskActivity[] },
  );

  // コメント + アクティビティを時系列に統合
  timeline = toSignal(
    toObservable(this.task).pipe(
      switchMap((t) => {
        if (!t) return of([]);
        return combineLatest([
          this.tasksService.getComments(t.id).pipe(catchError(() => of([] as TaskComment[]))),
          this.tasksService.getActivities(t.id).pipe(catchError(() => of([] as TaskActivity[]))),
        ]).pipe(
          map(([comments, activities]) => {
            const items: { kind: 'comment' | 'activity'; data: any; time: number }[] = [];
            comments.forEach(c => items.push({
              kind: 'comment', data: c, time: c.createdAt?.toDate?.()?.getTime() ?? 0,
            }));
            activities.forEach(a => items.push({
              kind: 'activity', data: a, time: a.createdAt?.toDate?.()?.getTime() ?? 0,
            }));
            return items.sort((a, b) => a.time - b.time);
          }),
        );
      }),
    ),
    { initialValue: [] as { kind: 'comment' | 'activity'; data: any; time: number }[] },
  );

  private scrollTimelineToLatest = afterRenderEffect(() => {
    this.timeline();
    const taskId = this.task()?.id ?? null;
    if (taskId !== this.lastTaskId) {
      this.shouldFollowLatest = true;
      this.lastTaskId = taskId;
    }
    const list = this.commentsList()?.nativeElement;
    if (list && this.shouldFollowLatest) list.scrollTop = list.scrollHeight;
  });

  onCommentsScroll(): void {
    const list = this.commentsList()?.nativeElement;
    if (!list) return;
    this.shouldFollowLatest = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
  }

  attachments = toSignal(
    toObservable(this.task).pipe(
      switchMap((t) => {
        if (!t) return of([] as TaskAttachment[]);
        return this.tasksService.getAttachments(t.id).pipe(
          catchError(() => of([] as TaskAttachment[])),
        );
      }),
    ),
    { initialValue: [] as TaskAttachment[] },
  );

  attachUploading = signal(false);
  attachError = signal('');
  attachmentsExpanded = signal(false);
  previewAttachment: TaskAttachment | null = null;

  toggleAttachments(): void {
    this.attachmentsExpanded.update((expanded) => !expanded);
  }

  activityLabel(act: TaskActivity): string {
    switch (act.type) {
      case 'status_change':
        return `ステータスを「${act.oldValue}」→「${act.newValue}」に変更`;
      case 'completed':
        return `タスクを完了しました`;
      case 'assignee_change':
        return `担当者を「${act.oldValue}」→「${act.newValue}」に変更`;
      case 'priority_change':
        return `優先度を「${act.oldValue}」→「${act.newValue}」に変更`;
      case 'created':
        return `タスクを作成しました`;
      case 'review_request':
        return `差し戻しを申請しました`;
      case 'review_approve':
        return `差し戻しを承認しました`;
      case 'review_reject':
        return `差し戻しを却下しました`;
      default:
        return '更新しました';
    }
  }


  formatTime(timestamp: any): string {
    if (!timestamp?.toDate) return '';
    const d = timestamp.toDate();
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  isMyComment(comment: TaskComment): boolean {
    return comment.authorId === this.auth.currentUser()?.uid;
  }

  async submitComment(): Promise<void> {
    const text = this.newComment.trim();
    const task = this.task();
    const user = this.auth.currentUser();
    if (!text || !task || !user || this.isSubmitting()) return;

    this.isSubmitting.set(true);
    const submitted = text;
    this.newComment = '';

    const member = this.tasksService.members().find((m) => m.uid === user.uid);
    const authorName = member?.name ?? user.displayName ?? user.email?.split('@')[0] ?? 'ゲスト';

    try {
      await this.tasksService.addComment(task.id, submitted, user.uid, authorName);
    } catch (err) {
      console.error('コメント送信エラー:', err);
    }

    this.isSubmitting.set(false);

    // 1. 通知を送る対象者のIDリスト（重複を防ぐためにSetを使用）
    const targetUids = new Set<string>();

    // 担当者がいれば追加
    if (task.assigneeId) {
      targetUids.add(task.assigneeId);
    }

    // マネージャー全員を追加
    this.tasksService.members().forEach((m) => {
      if (m.role === 'manager') {
        targetUids.add(m.uid);
      }
    });

    // コメントした本人は通知対象から外す
    targetUids.delete(user.uid);

    // 2. 対象者全員に通知を送信
    targetUids.forEach((uid) => {
      this.tasksService
        .addNotification(uid, {
          taskId: task.id,
          taskTitle: task.title,
          authorName,
          text: submitted,
          read: false,
          createdAt: null as any,
          type: 'comment',
        })
        .catch((err) => console.error('通知追加エラー:', err));
    });
  }

  async deleteComment(comment: TaskComment): Promise<void> {
    const task = this.task();
    if (!task) return;
    await this.tasksService.deleteComment(task.id, comment.id);
  }

  // ===== リアクション =====
  quickEmojis = ['👍', '❤️', '😂', '🎉', '👀', '🙏'];
  showEmojiPicker: string | null = null;

  toggleEmojiPicker(commentId: string): void {
    this.showEmojiPicker = this.showEmojiPicker === commentId ? null : commentId;
  }

  reactionError = signal('');

  async addReaction(comment: TaskComment, emoji: string): Promise<void> {
    const task = this.task();
    if (!task) return;
    this.showEmojiPicker = null;
    this.reactionError.set('');
    try {
      await this.tasksService.toggleReaction(task.id, comment.id, emoji);
    } catch (err) {
      console.error('リアクションエラー:', err);
      this.reactionError.set('リアクションの保存に失敗しました（権限エラー）');
    }
  }

  hasMyReaction(comment: TaskComment, emoji: string): boolean {
    const uid = this.auth.currentUser()?.uid;
    if (!uid || !comment.reactions) return false;
    return comment.reactions[emoji]?.includes(uid) ?? false;
  }

  getReactions(comment: TaskComment): { emoji: string; count: number; mine: boolean; names: string[] }[] {
    if (!comment.reactions) return [];
    const uid = this.auth.currentUser()?.uid;
    return Object.entries(comment.reactions)
      .filter(([, users]) => users.length > 0)
      .map(([emoji, users]) => ({
        emoji,
        count: users.length,
        mine: uid ? users.includes(uid) : false,
        names: users.map(
          (userId) => this.tasksService.members().find((member) => member.uid === userId)?.name ?? '不明なメンバー',
        ),
      }));
  }

  // ===== ファイル添付 =====
  readonly MAX_FILE_SIZE = 500 * 1024; // 500KB

  openFilePicker(input: HTMLInputElement): void {
    if (this.attachUploading()) return;

    try {
      if (typeof input.showPicker === 'function') {
        input.showPicker();
      } else {
        input.click();
      }
    } catch (error) {
      console.error('ファイル選択ダイアログを開けません:', error);
      this.attachError.set('ファイル選択を開けませんでした。ページを再読み込みしてもう一度お試しください。');
    }
  }

  onFileSelect(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    input.value = '';
    const task = this.task();
    if (!task) {
      this.attachError.set('添付先のタスクが見つかりません');
      return;
    }

    if (file.size > this.MAX_FILE_SIZE) {
      this.attachError.set(`ファイルサイズが大きすぎます（上限500KB、選択: ${Math.round(file.size / 1024)}KB）`);
      return;
    }

    this.attachError.set('');
    this.attachUploading.set(true);

    const reader = new FileReader();
    reader.onload = async () => {
      if (typeof reader.result !== 'string') {
        this.attachError.set('ファイルの読み込みに失敗しました');
        this.attachUploading.set(false);
        return;
      }

      try {
        await this.tasksService.addAttachment(
          task.id,
          file.name,
          file.type,
          file.size,
          reader.result,
        );
      } catch (err) {
        console.error('添付エラー:', err);
        this.attachError.set('ファイルの添付に失敗しました');
      } finally {
        this.attachUploading.set(false);
      }
    };
    reader.onerror = () => {
      this.attachError.set('ファイルの読み込みに失敗しました');
      this.attachUploading.set(false);
    };
    reader.readAsDataURL(file);
  }

  async deleteAttachment(att: TaskAttachment): Promise<void> {
    const task = this.task();
    if (!task) return;
    await this.tasksService.deleteAttachment(task.id, att.id);
  }

  isImage(att: TaskAttachment): boolean {
    return att.fileType.startsWith('image/');
  }

  formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + 'B';
    return Math.round(bytes / 1024) + 'KB';
  }

  openPreview(att: TaskAttachment): void {
    this.previewAttachment = att;
  }

  closePreview(): void {
    this.previewAttachment = null;
  }

  downloadAttachment(att: TaskAttachment): void {
    const a = document.createElement('a');
    a.href = att.dataUrl;
    a.download = att.fileName;
    a.click();
  }
}
