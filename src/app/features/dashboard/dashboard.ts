import { Component, HostListener, inject, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Timestamp } from '@angular/fire/firestore';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { Router } from '@angular/router';
import { TasksService } from '../../core/services/tasks.service';
import { Member, Task } from '../../core/models/task.model';
import { AuthService } from '../../core/services/auth.service';
import { NotificationService } from '../../core/services/notification.service';
import { saveMemberOrder, sortMembersBySavedOrder } from '../../core/utils/member-order';

interface MemberStat {
  member: Member;
  completedCount: number;
  totalEstimated: number;
  totalActual: number;
  diff: number;
  accuracy: number | null;
  loadPct: number;
}

interface CalendarDay {
  date: Date;
  day: number;
  isToday: boolean;
  tasks: Task[];
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, DragDropModule],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class DashboardComponent {
  tasksService = inject(TasksService);
  auth = inject(AuthService);
  notificationService = inject(NotificationService);
  private router = inject(Router);
  isMobile = signal(typeof window !== 'undefined' && window.innerWidth <= 768);

  @HostListener('window:resize')
  onResize(): void {
    this.isMobile.set(window.innerWidth <= 768);
  }

  // チーム負荷の折りたたみ
  showOtherMembers = signal(false);
  private memberOrderVersion = signal(0);

  toggleOtherMembers(): void {
    this.showOtherMembers.update((v) => !v);
  }

  reorderOtherMembers(event: CdkDragDrop<MemberStat[]>): void {
    const uid = this.auth.currentUser()?.uid;
    if (!uid) return;

    const members = [...this.otherStats()];
    if (
      event.previousIndex < 0 ||
      event.currentIndex < 0 ||
      event.previousIndex >= members.length ||
      event.currentIndex >= members.length
    ) {
      return;
    }

    moveItemInArray(members, event.previousIndex, event.currentIndex);
    saveMemberOrder(uid, members.map((stat) => stat.member));
    this.memberOrderVersion.update((version) => version + 1);
  }

  // 自分の負荷データ
  myStats = computed(() => {
    const uid = this.auth.currentUser()?.uid;
    return this.memberStats().filter((s) => s.member.uid === uid);
  });

  // 他メンバーの負荷データ
  otherStats = computed(() => {
    const uid = this.auth.currentUser()?.uid;
    return this.memberStats().filter((s) => s.member.uid !== uid);
  });

  // メンバーのタスクを見る
  goToMember(uid: string): void {
    this.router.navigate(['/board'], { queryParams: { assigneeId: uid } });
  }

  // カレンダータスク詳細ポップアップ
  selectedCalTask: Task | null = null;

  openCalTask(task: Task): void {
    this.selectedCalTask = task;
  }

  closeCalTask(): void {
    this.selectedCalTask = null;
  }

  goToTask(taskId: string): void {
    this.selectedCalTask = null;
    this.router.navigate(['/board'], { queryParams: { taskId } });
  }

  // 完了タスク一覧(実績時間があるもの・親タスクのみ)
  completedTasks = computed(() =>
    this.tasksService.tasks().filter((t) => t.status === '完了' && t.actualHours !== null && t.parentId === null),
  );

  isCurrentUser(uid: string): boolean {
    return this.auth.currentUser()?.uid === uid;
  }

  // メンバーごとの統計
  memberStats = computed(() => {
    const uid = this.auth.currentUser()?.uid;
    this.memberOrderVersion();

    const stats = this.tasksService.members().map((m) => {
      const myCompleted = this.completedTasks().filter((t) => t.assigneeId === m.uid);
      const totalEstimated = myCompleted.reduce((sum, t) => sum + (t.estimatedHours ?? 0), 0);
      const totalActual = myCompleted.reduce((sum, t) => sum + (t.actualHours ?? 0), 0);
      const diff = totalActual - totalEstimated;
      const accuracy =
        totalEstimated > 0 && totalActual > 0
          ? Math.round((totalEstimated / totalActual) * 100)
          : null;

      return {
        member: m,
        completedCount: myCompleted.length,
        totalEstimated,
        totalActual,
        diff,
        accuracy,
        loadPct: this.tasksService.getLoadPercent(m.uid),
      };
    });

    return sortMembersBySavedOrder(
      stats,
      uid ?? null,
      (stat) => stat.member.uid,
      (a, b) => b.loadPct - a.loadPct,
    );
  });

  // 今週完了したタスク数
  weeklyCompleted = computed(() => {
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    return this.completedTasks().filter((t) => {
      if (!t.statusUpdatedAt?.toDate) return false;
      return t.statusUpdatedAt.toDate().getTime() > weekAgo;
    }).length;
  });

  // 全体の進捗
  totalTasks = computed(
    () =>
      this.tasksService
        .tasks()
        .filter((t) => t.parentId === null && t.status !== 'アーカイブ済み').length,
  );
  doneTasks = computed(
    () =>
      this.tasksService
        .tasks()
        .filter((t) => t.parentId === null && t.status === '完了').length,
  );
  archivedTasks = computed(() =>
    this.tasksService.tasks().filter((t) => t.status === 'アーカイブ済み'),
  );
  progressPct = computed(() =>
    this.totalTasks() > 0 ? Math.round((this.doneTasks() / this.totalTasks()) * 100) : 0,
  );

  diffLabel(diff: number): string {
    if (diff > 0) return `+${diff}h 超過`;
    if (diff < 0) return `${diff}h 短縮`;
    return '見積もり通り';
  }

  diffClass(diff: number): string {
    if (diff > 0) return 'over';
    if (diff < 0) return 'under';
    return 'exact';
  }

  loadLevel(pct: number): string {
    if (pct >= 100) return 'danger';
    if (pct >= 80) return 'warn';
    return 'ok';
  }
  // カレンダー用: 今月と来月の日付グリッドを生成

  getMemberName(memberId: string | null): string {
    if (!memberId) return '未割当';
    return this.tasksService.members().find((m) => m.uid === memberId)?.name ?? '不明';
  }

  getMemberColor(memberId: string | null): string {
    return this.tasksService.members().find((m) => m.uid === memberId)?.avatarColor ?? '#9AA3B2';
  }
  priorityColor(priority: string | null): string {
    switch (priority) {
      case 'high':
        return '#d64545';
      case 'medium':
        return '#c98a3a';
      case 'low':
        return '#3fa37a';
      default:
        return '#4c5fd5';
    }
  }

  priorityLabel(priority: string | null): string {
    switch (priority) {
      case 'high': return '高';
      case 'medium': return '中';
      case 'low': return '低';
      default: return '—';
    }
  }

  formatDueDate(task: Task): string {
    if (!task.dueDate?.toDate) return '未設定';
    const d = task.dueDate.toDate();
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  }

  // 過去4週間の完了タスク推移
  weeklyCompletionData = computed(() => {
    const weeks = [];
    const now = new Date();

    for (let i = 3; i >= 0; i--) {
      const weekStart = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() - i * 7 - now.getDay(),
      );
      const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
      const label = `${weekStart.getMonth() + 1}/${weekStart.getDate()}週`;

      const count = this.tasksService.tasks().filter((t) => {
        if (t.status !== '完了' || !t.statusUpdatedAt?.toDate || t.parentId !== null) return false;
        const completed = t.statusUpdatedAt.toDate();
        return completed >= weekStart && completed < weekEnd;
      }).length;

      weeks.push({ label, count });
    }
    return weeks;
  });

  maxWeeklyCount = computed(() => {
    const max = Math.max(...this.weeklyCompletionData().map((w) => w.count));
    return max === 0 ? 1 : max;
  });
  // 表示月のオフセット(0=今月、1=来月、-1=先月)
  monthOffset = signal(0);

  calendarMonths = computed(() => {
    const now = new Date();
    const months = [];
    const monthCount = this.isMobile() ? 1 : 2;

    for (let m = 0; m < monthCount; m++) {
      const offset = this.monthOffset() + m;
      const baseDate = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      const year = baseDate.getFullYear();
      const month = baseDate.getMonth();
      const firstDay = new Date(year, month, 1);
      const lastDay = new Date(year, month + 1, 0);
      const startPad = firstDay.getDay();
      const days: (CalendarDay | null)[] = [];

      for (let i = 0; i < startPad; i++) {
        days.push(null);
      }

      for (let d = 1; d <= lastDay.getDate(); d++) {
        const date = new Date(year, month, d);
        const isToday = date.toDateString() === now.toDateString();
        const tasks = this.tasksService.tasks().filter((t) => {
          if (t.status === '完了' || !t.dueDate?.toDate) return false;
          const due = t.dueDate.toDate();
          return due.getFullYear() === year && due.getMonth() === month && due.getDate() === d;
        });
        days.push({ date, day: d, isToday, tasks });
      }

      months.push({ label: `${year}年${month + 1}月`, days });
    }

    return months;
  });

  async moveTaskDueDate(task: Task, date: Date): Promise<void> {
    const currentDueDate = task.dueDate?.toDate();
    if (
      currentDueDate &&
      currentDueDate.getFullYear() === date.getFullYear() &&
      currentDueDate.getMonth() === date.getMonth() &&
      currentDueDate.getDate() === date.getDate()
    ) {
      return;
    }

    const dueDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    try {
      await this.tasksService.updateTask(task.id, { dueDate: Timestamp.fromDate(dueDate) });
    } catch (error) {
      console.error('締切日の変更に失敗しました:', error);
      this.notificationService.show('エラー', 'タスクの締切変更に失敗しました');
    }
  }

  async restoreTask(task: Task): Promise<void> {
    await this.tasksService.updateStatus(task.id, '完了');
    this.notificationService.show('復元完了', `「${task.title}」をボードに戻しました`);
  }

  deletingTask: Task | null = null;

  openDeleteTask(task: Task): void {
    this.deletingTask = task;
  }

  cancelDeleteTask(): void {
    this.deletingTask = null;
  }

  async confirmDeleteTask(): Promise<void> {
    if (!this.deletingTask) return;
    const task = this.deletingTask;
    this.deletingTask = null;
    try {
      await this.tasksService.deleteTask(task.id);
      this.notificationService.show('削除完了', `「${task.title}」を削除しました`);
    } catch (e) {
      console.error('タスク削除エラー:', e);
      this.notificationService.show('エラー', 'タスクの削除に失敗しました');
    }
  }
}
