import { Component, HostListener, inject, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { TasksService } from '../../core/services/tasks.service';
import { AuthService } from '../../core/services/auth.service';
import { NotificationService } from '../../core/services/notification.service';
import { Task, TaskStatus } from '../../core/models/task.model';

type MyTaskTab = 'active' | 'completed';
type SortKey = 'default' | 'priority' | 'dueDate' | 'status';

@Component({
  selector: 'app-my-tasks',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './my-tasks.html',
  styleUrl: './my-tasks.scss',
})
export class MyTasksComponent {
  tasksService = inject(TasksService);
  auth = inject(AuthService);
  private notificationService = inject(NotificationService);
  private router = inject(Router);

  tab = signal<MyTaskTab>('active');
  sortKey = signal<SortKey>('default');
  searchQuery = signal('');
  expandedTaskId = signal<string | null>(null);
  expandedSubtaskIds = signal<Set<string>>(new Set());

  showSortMenu = false;
  completingTask: Task | null = null;
  actualHoursInput = 0;
  reviewingTask: Task | null = null;
  reviewReasonInput = '';

  myTasks = computed(() => {
    const uid = this.auth.currentUser()?.uid;
    if (!uid) return [];
    return this.tasksService
      .tasks()
      .filter((t) => t.assigneeId === uid && t.status !== 'アーカイブ済み');
  });

  rootTasks = computed(() => this.myTasks().filter((task) => !task.parentId));

  private filteredTasks = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    if (!q) return this.rootTasks();
    return this.rootTasks().filter((t) => t.title.toLowerCase().includes(q));
  });

  activeTasks = computed(() =>
    this.filteredTasks().filter((t) => t.status !== '完了'),
  );

  myCompletedTasks = computed(() =>
    this.filteredTasks().filter((t) => t.status === '完了'),
  );

  allCompletedTasks = computed(() =>
    this.rootTasks().filter((task) => task.status === '完了'),
  );

  progressPct = computed(() => {
    const total = this.rootTasks().length;
    if (total === 0) return 0;
    return Math.round((this.allCompletedTasks().length / total) * 100);
  });

  overdueTasks = computed(() => {
    const today = this.todayStart();
    return this.activeTasks().filter((t) => {
      if (!t.dueDate?.toDate) return false;
      const d = t.dueDate.toDate();
      return new Date(d.getFullYear(), d.getMonth(), d.getDate()) < today;
    });
  });

  todayDueTasks = computed(() => {
    const today = this.todayStart();
    const tomorrow = new Date(today.getTime() + 86400000);
    return this.activeTasks().filter((t) => {
      if (!t.dueDate?.toDate) return false;
      const d = t.dueDate.toDate();
      const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      return day >= today && day < tomorrow;
    });
  });

  upcomingTasks = computed(() => {
    const tomorrow = new Date(this.todayStart().getTime() + 86400000);
    return this.activeTasks()
      .filter((t) => {
        if (!t.dueDate?.toDate) return false;
        const d = t.dueDate.toDate();
        return new Date(d.getFullYear(), d.getMonth(), d.getDate()) >= tomorrow;
      })
      .sort((a, b) => a.dueDate!.toDate().getTime() - b.dueDate!.toDate().getTime());
  });

  noDueDateTasks = computed(() => this.activeTasks().filter((t) => !t.dueDate?.toDate));

  sortedActiveTasks = computed(() => {
    const tasks = [...this.activeTasks()];
    const key = this.sortKey();

    switch (key) {
      case 'priority': {
        const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
        return tasks.sort((a, b) => {
          const pa = order[a.priority ?? ''] ?? 3;
          const pb = order[b.priority ?? ''] ?? 3;
          return pa - pb;
        });
      }
      case 'dueDate':
        return tasks.sort((a, b) => {
          const da = a.dueDate?.toDate?.()?.getTime() ?? Infinity;
          const db = b.dueDate?.toDate?.()?.getTime() ?? Infinity;
          return da - db;
        });
      case 'status': {
        const order: Record<string, number> = { 進行中: 0, 差し戻し中: 1, 未着手: 2 };
        return tasks.sort((a, b) => {
          const sa = order[a.status] ?? 3;
          const sb = order[b.status] ?? 3;
          return sa - sb;
        });
      }
      default:
        return tasks;
    }
  });

  private todayStart(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  isOverdue(task: Task): boolean {
    if (!task.dueDate?.toDate) return false;
    const d = task.dueDate.toDate();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()) < this.todayStart();
  }

  isToday(task: Task): boolean {
    if (!task.dueDate?.toDate) return false;
    const d = task.dueDate.toDate();
    const today = this.todayStart();
    const tomorrow = new Date(today.getTime() + 86400000);
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return day >= today && day < tomorrow;
  }

  getUrgency(task: Task): string {
    if (this.isOverdue(task)) return 'overdue';
    if (this.isToday(task)) return 'today';
    return '';
  }

  statusClass(status: TaskStatus): string {
    switch (status) {
      case '未着手':
        return 'todo';
      case '進行中':
        return 'active';
      case '差し戻し中':
        return 'review';
      case '完了':
        return 'done';
      default:
        return '';
    }
  }

  priorityLabel(priority: string): string {
    switch (priority) {
      case 'high':
        return '高';
      case 'medium':
        return '中';
      case 'low':
        return '低';
      default:
        return '';
    }
  }

  dueDateStatus(task: Task): string {
    if (!task.dueDate?.toDate) return '';
    const d = task.dueDate.toDate();
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const today = this.todayStart();
    const diff = day.getTime() - today.getTime();
    if (diff < 0) return 'overdue';
    if (diff < 86400000) return 'today';
    if (diff < 86400000 * 3) return 'soon';
    return '';
  }

  formatDueDate(timestamp: any): string {
    if (!timestamp?.toDate) return '';
    const d = timestamp.toDate();
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  formatDueDateFull(task: Task): string {
    if (!task.dueDate?.toDate) return '未設定';
    const d = task.dueDate.toDate();
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  }

  getSortLabel(): string {
    switch (this.sortKey()) {
      case 'priority':
        return '優先度順';
      case 'dueDate':
        return '期限順';
      case 'status':
        return 'ステータス順';
      default:
        return '期限グループ';
    }
  }

  // --- カード展開 ---
  toggleExpand(taskId: string): void {
    this.expandedTaskId.update((id) => (id === taskId ? null : taskId));
  }

  // --- サブタスク ---
  getChildren(epicId: string): Task[] {
    return this.tasksService.tasks().filter((t) => t.parentId === epicId);
  }

  toggleSubtasks(epicId: string): void {
    this.expandedSubtaskIds.update((ids) => {
      const next = new Set(ids);
      if (next.has(epicId)) next.delete(epicId);
      else next.add(epicId);
      return next;
    });
  }

  async toggleSubtaskStatus(child: Task): Promise<void> {
    if (!this.canMoveTask(child)) {
      this.notificationService.show('権限エラー', '他人のタスクは更新できません');
      return;
    }
    const isDone = child.status === '完了';
    if (isDone) {
      await this.tasksService.updateTask(child.id, { actualHours: null });
      await this.tasksService.updateStatus(child.id, '未着手');
    } else {
      // サブタスクの完了：見積もり無しなら即完了、ありならモーダル表示
      // いずれもカード展開は維持する
      if (!child.estimatedHours) {
        await this.tasksService.completeTask(child.id, 0);
      } else {
        this.completingTask = child;
        this.actualHoursInput = child.estimatedHours;
      }
    }
  }

  // --- ステータス遷移（Board互換フロー） ---
  isManager(): boolean {
    const uid = this.auth.currentUser()?.uid;
    return this.tasksService.members().find((member) => member.uid === uid)?.role === 'manager';
  }

  canMoveTask(task: Task): boolean {
    const uid = this.auth.currentUser()?.uid;
    if (!uid) return false;
    if (this.isManager()) return true;
    return task.assigneeId === uid || task.createdBy === uid;
  }

  getMemberName(memberId: string | null): string {
    if (!memberId) return '未割当';
    return this.tasksService.members().find((m) => m.uid === memberId)?.name ?? '不明';
  }

  getMemberColor(memberId: string | null): string {
    return this.tasksService.members().find((m) => m.uid === memberId)?.avatarColor ?? '#9AA3B2';
  }

  getBlockedLabel(task: Task): string | null {
    if (!this.tasksService.isBlocked(task)) return null;
    const blockerId = task.blockedBy?.find((id) => {
      const b = this.tasksService.tasks().find((t) => t.id === id);
      return b && b.status !== '完了';
    });
    const blockerTitle =
      this.tasksService.tasks().find((t) => t.id === blockerId)?.title ?? '別のタスク';
    return `${blockerTitle} 待ち`;
  }

  requestReview(task: Task): void {
    if (task.status !== '進行中' || this.isManager()) return;
    this.reviewingTask = task;
    this.reviewReasonInput = '';
  }

  async confirmReview(): Promise<void> {
    const task = this.reviewingTask;
    const reason = this.reviewReasonInput.trim();
    if (!task || !reason) return;

    await this.tasksService.requestReview(task.id, reason);
    this.reviewingTask = null;
    this.expandedTaskId.set(null);
  }

  cancelReview(): void {
    this.reviewingTask = null;
  }

  async moveTask(task: Task, newStatus: TaskStatus): Promise<void> {
    if (newStatus === '完了' && this.tasksService.isBlocked(task)) {
      this.notificationService.show(
        'ブロック中',
        `「${task.title}」は依存タスクが完了するまで完了にできません`,
      );
      return;
    }
    if (newStatus === '完了') {
      this.startComplete(task);
    } else {
      if (task.status === '完了') {
        await this.tasksService.updateTask(task.id, { actualHours: null });
      }
      await this.tasksService.updateStatus(task.id, newStatus);
    }
  }

  startComplete(task: Task): void {
    if (!task.estimatedHours) {
      this.tasksService.completeTask(task.id, 0);
      this.expandedTaskId.set(null);
      return;
    }
    this.completingTask = task;
    this.actualHoursInput = task.estimatedHours;
  }

  async confirmComplete(): Promise<void> {
    const task = this.completingTask;
    if (!task) return;
    const isSubtask = !!task.parentId;
    await this.tasksService.completeTask(task.id, this.actualHoursInput);
    this.completingTask = null;
    // サブタスクの完了ではカード展開を維持する
    if (!isSubtask) {
      this.expandedTaskId.set(null);
    }
  }

  cancelComplete(): void {
    this.completingTask = null;
  }

  goToTask(taskId: string): void {
    this.expandedTaskId.set(null);
    this.selectedCalTask = null;
    this.router.navigate(['/board'], { queryParams: { taskId } });
  }

  // --- カレンダープレビュー ---
  selectedCalTask: Task | null = null;

  openCalTask(task: Task): void {
    this.selectedCalTask = task;
  }

  closeCalTask(): void {
    this.selectedCalTask = null;
  }

  // --- カレンダー ---
  isMobile = signal(typeof window !== 'undefined' && window.innerWidth <= 768);
  monthOffset = signal(0);

  @HostListener('window:resize')
  onResize(): void {
    this.isMobile.set(window.innerWidth <= 768);
  }

  calendarMonths = computed(() => {
    const now = new Date();
    const months: { label: string; days: (CalendarDay | null)[] }[] = [];
    const monthCount = this.isMobile() ? 1 : 2;
    const tasks = this.myTasks();

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
        const dayTasks = tasks.filter((t) => {
          if (t.status === '完了' || !t.dueDate?.toDate) return false;
          const due = t.dueDate.toDate();
          return due.getFullYear() === year && due.getMonth() === month && due.getDate() === d;
        });
        days.push({ date, day: d, isToday, tasks: dayTasks });
      }

      months.push({ label: `${year}年${month + 1}月`, days });
    }

    return months;
  });

  priorityColor(priority: string | null): string {
    switch (priority) {
      case 'high': return '#d64545';
      case 'medium': return '#c98a3a';
      case 'low': return '#3fa37a';
      default: return '#4c5fd5';
    }
  }
}

interface CalendarDay {
  date: Date;
  day: number;
  isToday: boolean;
  tasks: Task[];
}
