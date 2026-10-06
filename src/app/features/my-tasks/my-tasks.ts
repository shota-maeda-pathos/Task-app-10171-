import { calculateLoadPercent, formatWorkHours, UNKNOWN_LOAD } from '../../core/utils/load-display';
import { buildCalendarTimeOff, CalendarTimeOff } from '../../core/utils/calendar-time-off';
import {
  ElementRef,
  ViewChild,
  ChangeDetectorRef,
  Component,
  HostListener,
  inject,
  computed,
  effect,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { Router } from '@angular/router';
import { TasksService, RecurrenceGenerationError } from '../../core/services/tasks.service';
import { AuthService } from '../../core/services/auth.service';
import { NotificationService } from '../../core/services/notification.service';
import { Timestamp } from '@angular/fire/firestore';
import { Task, TaskStatus } from '../../core/models/task.model';
import { formatDateString, getForecastWeekLabels, getWeekMonday } from '../../core/utils/week-utils';

type MyTaskTab = 'active' | 'completed';
type SortKey = 'default' | 'priority' | 'dueDate' | 'status';

@Component({
  selector: 'app-my-tasks',
  standalone: true,
  imports: [CommonModule, DragDropModule],
  templateUrl: './my-tasks.html',
  styleUrl: './my-tasks.scss',
})
export class MyTasksComponent {
  tasksService = inject(TasksService);
  auth = inject(AuthService);
  private notificationService = inject(NotificationService);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);

  tab = signal<MyTaskTab>('active');
  sortKey = signal<SortKey>('default');
  searchQuery = signal('');
  filterFocus = signal(false);
  filterAssignee = signal<string>('');
  effectiveAssigneeFilter = computed(() => this.isManager() ? this.filterAssignee() : '');
  hasAssigneeMetrics = computed(() => this.effectiveAssigneeFilter() !== 'unassigned');
  selectedAssigneeLabel = computed(() => {
    const filter = this.effectiveAssigneeFilter();
    if (filter === 'unassigned') return '未割当';
    const memberId = filter || this.auth.currentUser()?.uid;
    if (!memberId) return '自分';
    return this.tasksService.members().find((member) => member.uid === memberId)?.name ?? '自分';
  });
  selectedAssigneeHeading = computed(() =>
    this.effectiveAssigneeFilter() === 'unassigned'
      ? '未割当タスク'
      : `${this.selectedAssigneeLabel()}さん`,
  );
  pageTitle = computed(() => {
    if (this.effectiveAssigneeFilter() === 'unassigned') return '未割当のタスク';
    if (this.effectiveAssigneeFilter()) return `${this.selectedAssigneeLabel()}さんのタスク`;
    return 'My Tasks';
  });
  pageDescription = computed(() => {
    if (this.effectiveAssigneeFilter() === 'unassigned') return '未割当タスクの進捗と一覧を確認できます。';
    if (this.effectiveAssigneeFilter()) return `${this.selectedAssigneeLabel()}さんの進捗とタスクを一覧で確認できます。`;
    return '自分の進捗とタスクを一覧で確認できます。';
  });
  private metricsUid = computed(() => {
    const filter = this.effectiveAssigneeFilter();
    if (filter === 'unassigned') return '';
    if (filter) return filter;
    return this.auth.currentUser()?.uid ?? '';
  });
  pendingFocusTaskId = signal<string | null>(null);
  focusHoursDraft = signal<number | null>(null);
  @ViewChild('focusPopover', { static: true }) private focusPopover!: ElementRef<HTMLFormElement>;
  focusPopoverLeft = signal(16);
  focusPopoverTop = signal(16);
  focusSaving = signal(false);
  focusSaveError = signal('');
  activeDisplayLimit = signal(10);
  completedDisplayLimit = signal(10);
  displayedCompletedTasks = computed(() => this.myCompletedTasks().slice(0, this.completedDisplayLimit()));
  pendingFocusTask = computed(
    () => this.tasksService.tasks().find((t) => t.id === this.pendingFocusTaskId()) ?? null,
  );

  closeFocusPopover(): void {
    this.focusPopover.nativeElement.hidePopover();
    this.pendingFocusTaskId.set(null);
  }

  onFocusPopoverToggle(event: Event): void {
    if ((event as ToggleEvent).newState === 'closed') this.pendingFocusTaskId.set(null);
  }

  async saveFocusHoursFromPopover(event: Event): Promise<void> {
    event.preventDefault();
    const task = this.pendingFocusTask();
    if (task) await this.saveFocusHours(task, event);
  }

  expandedTaskId = signal<string | null>(null);
  expandedSubtaskIds = signal<Set<string>>(new Set());
  private optimisticSubtaskOrders = signal<Record<string, string[]>>({});
  private subtaskOrderVersions = new Map<string, number>();

  showSortMenu = false;
  completingTask: Task | null = null;
  actualHoursInput = 0;
  reviewingTask: Task | null = null;
  reviewReasonInput = '';

  constructor() {
    effect(() => {
      const tasks = this.tasksService.tasks();
      const optimisticOrders = this.optimisticSubtaskOrders();
      const syncedParents = Object.entries(optimisticOrders)
        .filter(([parentId, orderedIds]) => {
          const orderedIdSet = new Set(orderedIds);
          const currentIds = tasks
            .filter((task) => task.parentId === parentId && orderedIdSet.has(task.id))
            .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
            .map((task) => task.id);
          return (
            currentIds.length === orderedIds.length &&
            currentIds.every((id, index) => id === orderedIds[index])
          );
        })
        .map(([parentId]) => parentId);

      if (syncedParents.length > 0) {
        this.optimisticSubtaskOrders.update((orders) => {
          const next = { ...orders };
          syncedParents.forEach((parentId) => delete next[parentId]);
          return next;
        });
      }
    });
  }

  myTasks = computed(() => {
    const uid = this.auth.currentUser()?.uid;
    if (!uid) return [];
    const assigneeFilter = this.effectiveAssigneeFilter();
    return this.tasksService
      .tasks()
      .filter((t) => {
        if (t.status === 'アーカイブ済み') return false;
        if (assigneeFilter === 'unassigned') return !t.assigneeId && !t.parentId;
        if (assigneeFilter) return t.assigneeId === assigneeFilter;
        return t.assigneeId === uid;
      });
  });

  rootTasks = computed(() => {
    const myTaskIds = new Set(this.myTasks().map((t) => t.id));
    const allTasks = this.tasksService.tasks();
    const parentsWithMyChildren = new Set<string>();
    for (const t of allTasks) {
      if (t.parentId && myTaskIds.has(t.id)) {
        parentsWithMyChildren.add(t.parentId);
      }
    }
    const myRoots = this.myTasks().filter((task) => !task.parentId);
    for (const parentId of parentsWithMyChildren) {
      if (!myRoots.some((t) => t.id === parentId)) {
        const parent = allTasks.find((t) => t.id === parentId);
        if (parent && parent.status !== 'アーカイブ済み') {
          myRoots.push(parent);
        }
      }
    }
    return myRoots;
  });

  private filteredTasks = computed(() => {
    let tasks = this.rootTasks();
    const q = this.searchQuery().trim().toLowerCase();
    if (q) tasks = tasks.filter((t) => t.title.toLowerCase().includes(q));
    if (this.filterFocus()) tasks = tasks.filter((t) => t.focusThisWeek);
    return tasks;
  });

  activeTasks = computed(() => this.filteredTasks().filter((t) => t.status !== '完了'));

  myCompletedTasks = computed(() => this.filteredTasks().filter((t) => t.status === '完了'));

  allCompletedTasks = computed(() => this.rootTasks().filter((task) => task.status === '完了'));

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

  summaryActiveTasks = computed(() =>
    this.rootTasks().filter((task) => task.status !== '完了'),
  );

  actionableTaskSummary = computed(() => {
    const tasks = this.summaryActiveTasks();
    const overdue = tasks.filter((task) => this.isOverdue(task)).length;
    const dueToday = tasks.filter((task) => this.isToday(task)).length;
    const total = tasks.filter((task) => this.isOverdue(task) || this.isToday(task)).length;

    return { total, overdue, dueToday };
  });

  remainingFocusHours = computed(() =>
    Math.max(0, this.weeklyCapacity() - this.focusHours()),
  );

  weeklyCompletedTasks = computed(() => {
    const weekStart = getWeekMonday(new Date());
    const nextWeekStart = new Date(weekStart);
    nextWeekStart.setDate(nextWeekStart.getDate() + 7);

    return this.rootTasks().filter((task) => {
      if (task.status !== '完了' || !task.statusUpdatedAt?.toDate) return false;
      const completedAt = task.statusUpdatedAt.toDate();
      return completedAt >= weekStart && completedAt < nextWeekStart;
    });
  });

  estimateAccuracyPct = computed(() => {
    const now = Date.now();
    const fourWeeksAgo = now - 28 * 24 * 60 * 60 * 1000;
    let totalEstimatedHours = 0;
    let totalAbsoluteError = 0;

    for (const task of this.rootTasks()) {
      if (
        (task.status !== '完了' && task.status !== 'アーカイブ済み') ||
        task.estimatedHours <= 0 ||
        task.actualHours === null ||
        !Number.isFinite(task.actualHours) ||
        !task.statusUpdatedAt?.toDate
      ) {
        continue;
      }

      const completedAt = task.statusUpdatedAt.toDate().getTime();
      if (completedAt < fourWeeksAgo || completedAt > now) continue;

      totalEstimatedHours += task.estimatedHours;
      totalAbsoluteError += Math.abs(task.actualHours - task.estimatedHours);
    }

    if (totalEstimatedHours === 0) return null;

    return Math.round(Math.max(0, 1 - totalAbsoluteError / totalEstimatedHours) * 100);
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
    const children = this.tasksService
      .tasks()
      .filter((t) => t.parentId === epicId)
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    const optimisticOrder = this.optimisticSubtaskOrders()[epicId];
    if (!optimisticOrder) return children;

    const orderById = new Map(optimisticOrder.map((id, index) => [id, index]));
    return [...children].sort((a, b) => {
      const aIndex = orderById.get(a.id);
      const bIndex = orderById.get(b.id);
      if (aIndex !== undefined && bIndex !== undefined) return aIndex - bIndex;
      if (aIndex !== undefined) return -1;
      if (bIndex !== undefined) return 1;
      return a.order - b.order || a.id.localeCompare(b.id);
    });
  }

  canReorderSubtask(task: Task): boolean {
    const parent = task.parentId
      ? this.tasksService.tasks().find((candidate) => candidate.id === task.parentId)
      : null;
    return this.canMoveTask(task) || (!!parent && this.canMoveTask(parent));
  }

  async reorderSubtasks(event: CdkDragDrop<Task[]>, parentId: string): Promise<void> {
    if (event.previousContainer !== event.container) return;
    const task = event.item.data;
    if (!task || task.parentId !== parentId) return;
    if (!this.canReorderSubtask(task)) {
      this.notificationService.show('権限エラー', '他人のタスクは移動できません');
      return;
    }

    const children = [...this.getChildren(parentId)];
    if (
      event.previousIndex < 0 ||
      event.currentIndex < 0 ||
      event.previousIndex >= children.length ||
      event.currentIndex >= children.length ||
      event.previousIndex === event.currentIndex
    ) {
      return;
    }
    moveItemInArray(children, event.previousIndex, event.currentIndex);
    const orderedIds = children.map((child) => child.id);
    const version = (this.subtaskOrderVersions.get(parentId) ?? 0) + 1;
    this.subtaskOrderVersions.set(parentId, version);
    this.optimisticSubtaskOrders.update((orders) => ({ ...orders, [parentId]: orderedIds }));
    this.cdr.detectChanges();
    try {
      await this.tasksService.reorderSubtasks(parentId, orderedIds);
    } catch (error) {
      if (this.subtaskOrderVersions.get(parentId) === version) {
        this.optimisticSubtaskOrders.update((orders) => {
          const next = { ...orders };
          delete next[parentId];
          return next;
        });
      }
      console.error('サブタスクの並び替えエラー:', error);
      this.notificationService.show('並び替えエラー', 'サブタスクの順序を保存できませんでした');
    }
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
      await this.startComplete(child);
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
    if (!task) return;
    if (!reason) {
      this.notificationService.show('入力エラー', '差し戻し理由を入力してください');
      return;
    }
    await this.tasksService.requestReview(task.id, reason);
    this.notificationService.show('差し戻し申請', `「${task.title}」の差し戻しを申請しました`);
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
      this.notificationService.show('ステータス変更', `「${task.title}」を${newStatus}にしました`);
    }
  }

  async startComplete(task: Task): Promise<void> {
    if (this.tasksService.isBlocked(task)) {
      this.notificationService.show('ブロック中', `「${task.title}」は依存タスクが完了するまで完了にできません`);
      return;
    }
    if (!task.estimatedHours) {
      try {
        await this.tasksService.completeTask(task.id, 0);
        this.notificationService.show('完了', `「${task.title}」を完了にしました`);
        if (!task.parentId) this.expandedTaskId.set(null);
      } catch (error) {
        if (error instanceof RecurrenceGenerationError) this.notificationService.showRetry(error.retry);
        else this.notificationService.show('完了エラー', error instanceof Error ? error.message : 'タスクの完了に失敗しました');
      }
      return;
    }
    this.completingTask = task;
    this.actualHoursInput = task.estimatedHours;
  }

  async confirmComplete(): Promise<void> {
    const task = this.completingTask;
    if (!task) return;
    const isSubtask = !!task.parentId;
    const hours = this.actualHoursInput;
    if (hours == null || hours < 0 || !Number.isFinite(hours)) {
      this.notificationService.show('入力エラー', '実績時間を正しく入力してください');
      return;
    }
    try {
      await this.tasksService.completeTask(task.id, hours);
      this.notificationService.show('完了', `「${task.title}」を完了にしました`);
      this.completingTask = null;
      if (!isSubtask) this.expandedTaskId.set(null);
    } catch (error) {
      if (error instanceof RecurrenceGenerationError) {
        this.completingTask = null;
        this.notificationService.showRetry(error.retry);
      } else this.notificationService.show('完了エラー', error instanceof Error ? error.message : 'タスクの完了に失敗しました');
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
  previewSubtasksOpen = false;

  openCalTask(task: Task): void {
    this.selectedCalTask = task;
    this.previewSubtasksOpen = false;
  }

  closeCalTask(): void {
    this.selectedCalTask = null;
  }

  getSubtasks(taskId: string): Task[] {
    return this.tasksService.tasks().filter((task) => task.parentId === taskId);
  }

  // --- カレンダー ---
  isMobile = signal(typeof window !== 'undefined' && window.innerWidth <= 768);
  monthOffset = signal(0);

  @HostListener('window:resize')
  onResize(): void {
    this.isMobile.set(window.innerWidth <= 768);
  }

  selectedTimeOffDay = signal<CalendarDay | null>(null);

  readonly isCalendarHoliday = (entry: CalendarTimeOff) => entry.kind === 'holiday';

  calendarMonths = computed(() => {
    const now = new Date();
    const filter = this.effectiveAssigneeFilter();
    const memberId = filter === 'unassigned' ? null : filter || this.auth.currentUser()?.uid || null;
    const calendarMembers = memberId
      ? this.tasksService.members()
      : [];
    const timeOff = buildCalendarTimeOff(
      this.tasksService.teamSettings()?.holidays ?? [],
      calendarMembers,
      memberId ?? undefined,
    );
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
        days.push({ date, day: d, isToday, tasks: dayTasks, timeOff: timeOff.get(formatDateString(date)) ?? [] });
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
      this.notificationService.show('エラー', '締切日の変更に失敗しました');
    }
  }

  focusTaskCount = computed(() => {
    const uid = this.metricsUid();
    if (!uid) return 0;
    return this.tasksService.getMemberFocusTaskCount(uid);
  });

  focusHours = computed(() => {
    const uid = this.metricsUid();
    if (!uid) return 0;
    return this.tasksService.getMemberFocusHours(uid);
  });

  focusLoadPct = computed(() => {
    const uid = this.metricsUid();
    if (!uid) return 0;
    return this.tasksService.getFocusLoadPercent(uid);
  });

  weeklyCapacity = computed(() => {
    const uid = this.metricsUid();
    if (!uid) return 0;
    return this.tasksService.getEffectiveCapacity(uid, 0);
  });

  Math = Math;
  formatHours = formatWorkHours;
  loadPercent = calculateLoadPercent;
  forecastLabels = getForecastWeekLabels();

  forecastWeekly = computed(() => {
    const uid = this.metricsUid();
    if (!uid) return [0, 0, 0, 0];
    return this.tasksService.getMemberWeeklyHours(uid);
  });

  loadLevel(pct: number): string {
    if (pct === UNKNOWN_LOAD || !Number.isFinite(pct)) return 'unknown';
    if (pct < 0) return 'danger';
    if (pct >= 100) return 'danger';
    if (pct >= 80) return 'warn';
    return 'ok';
  }

  loadLabel(pct: number): string {
    if (pct === UNKNOWN_LOAD || !Number.isFinite(pct)) return '計算できません';
    return pct < 0 ? '稼働予定なし' : pct + '%';
  }

  getWeekCapacity(weekIndex: number): number {
    const uid = this.metricsUid();
    if (!uid) return 0;
    return this.tasksService.getEffectiveCapacity(uid, weekIndex);
  }

  async onFocusToggle(task: Task, event: MouseEvent): Promise<void> {
    event.stopPropagation();
    if (this.focusSaving()) return;
    if (task.focusThisWeek) {
      this.closeFocusPopover();
      try {
        await this.tasksService.toggleFocus(task.id, false);
      } catch {
        this.notificationService.show(
          '保存できませんでした',
          '通信状態を確認して、もう一度お試しください。',
        );
      }
      return;
    }
    if (this.pendingFocusTaskId() === task.id) {
      this.closeFocusPopover();
      return;
    }
    this.focusSaveError.set('');
    this.focusHoursDraft.set(
      task.focusHours ?? (task.estimatedHours > 0 ? task.estimatedHours : 1),
    );
    this.pendingFocusTaskId.set(task.id);
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.focusPopoverLeft.set(Math.max(8, Math.min(rect.left, window.innerWidth - 252)));
    this.focusPopoverTop.set(Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 220)));
    this.cdr.detectChanges();
    const popover = this.focusPopover.nativeElement;
    popover.showPopover();
    const input = popover.querySelector('input');
    input?.focus();
  }

  onFocusHoursInput(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    this.focusHoursDraft.set(input.value === '' ? null : input.valueAsNumber);
  }

  async saveFocusHours(task: Task, event: Event): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    const hours = this.focusHoursDraft();
    if (
      this.pendingFocusTaskId() !== task.id ||
      hours === null ||
      !Number.isFinite(hours) ||
      hours <= 0
    ) {
      return;
    }

    if (this.focusSaving()) return;
    this.focusSaving.set(true);
    this.focusSaveError.set('');
    try {
      await this.tasksService.toggleFocus(task.id, true, hours);
      this.closeFocusPopover();
    } catch {
      this.focusSaveError.set('保存できませんでした。もう一度お試しください。');
    } finally {
      this.focusSaving.set(false);
    }
  }

  getTargetWeekLabel(task: Task): string | null {
    if (!task.targetWeekStart?.toDate) return null;
    const raw = task.targetWeekStart.toDate();
    const targetWeek = new Date(raw);
    if (
      targetWeek.getUTCDay() === 0 &&
      targetWeek.getUTCHours() === 0 &&
      targetWeek.getUTCMinutes() === 0 &&
      targetWeek.getUTCSeconds() === 0
    ) {
      targetWeek.setDate(targetWeek.getDate() + 1);
    }
    if (getWeekMonday(targetWeek).getTime() === getWeekMonday(new Date()).getTime()) {
      return null;
    }
    return `予定：${targetWeek.getMonth() + 1}/${targetWeek.getDate()}週`;
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
}

interface CalendarDay {
  date: Date;
  day: number;
  isToday: boolean;
  tasks: Task[];
  timeOff: CalendarTimeOff[];
}
