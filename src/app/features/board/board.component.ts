import {
  ElementRef,
  ViewChild,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  HostListener,
  inject,
  computed,
  signal,
  effect,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CdkDrag, CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { ActivatedRoute, Router } from '@angular/router';
import { TasksService } from '../../core/services/tasks.service';
import { AuthService } from '../../core/services/auth.service';
import { NotificationService } from '../../core/services/notification.service';
import { CommentPanelComponent } from './comment-panel/comment-panel';
import { Task, TaskStatus, Member, Priority, RecurrenceType, TaskTemplate } from '../../core/models/task.model';
import { Timestamp } from '@angular/fire/firestore';
import { saveMemberOrder, sortMembersBySavedOrder } from '../../core/utils/member-order';
import { getWeekMonday, getWeekIndex, getForecastWeekLabels } from '../../core/utils/week-utils';

type LoadLevel = 'ok' | 'warn' | 'danger';

interface PendingAdd {
  kind: 'root' | 'sub' | 'edit';
  status?: TaskStatus;
  epicId?: string;
  name: string;
  pct: number;
  altName: string | null;
  altUid: string | null;
  altPct: number;
  candidates: { uid: string; name: string; pct: number }[];
}

@Component({
  selector: 'app-board',
  standalone: true,
  imports: [CommonModule, FormsModule, DragDropModule, CommentPanelComponent],
  templateUrl: './board.component.html',
  styleUrl: './board.component.scss',
})
export class BoardComponent {
  tasksService = inject(TasksService);
  auth = inject(AuthService);
  notificationService = inject(NotificationService);
  Math = Math;
  forecastLabels = getForecastWeekLabels();
  private destroyRef = inject(DestroyRef);
  private cdr = inject(ChangeDetectorRef);

  columns: TaskStatus[] = ['未着手', '進行中', '完了'];
  connectedLists = this.columns.map((s) => 'col-' + s);
  canDropRootTask = (drag: CdkDrag<Task>): boolean => !drag.data.parentId;
  canDropSubtask = (drag: CdkDrag<Task>): boolean => !!drag.data.parentId;

  openEpicId: string | null = null;
  newSubtaskTitle = '';
  newSubtaskAssignee: string | null = null;
  newSubtaskHours: number | null = null;

  showFilters = false;
  showSortMenu = false;
  showSwimlaneMenu = false;
  pendingFocusTaskId = signal<string | null>(null);
  focusHoursDraft = signal<number | null>(null);
  @ViewChild('focusPopover', { static: true }) private focusPopover!: ElementRef<HTMLFormElement>;
  focusPopoverLeft = signal(16);
  focusPopoverTop = signal(16);
  focusSaving = signal(false);
  focusSaveError = signal('');
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

  isFilterExpanded = signal(false);

  // コンパクト / 詳細モード
  viewMode = signal<'detail' | 'compact'>('detail');

  toggleViewMode(): void {
    const next = this.viewMode() === 'detail' ? 'compact' : 'detail';
    this.viewMode.set(next);
    this.saveUserPreference('boardViewMode', next);
  }

  // グループ表示
  expandedLanes = signal<Set<string>>(new Set());

  toggleLane(key: string): void {
    this.expandedLanes.update((set) => {
      const next = new Set(set);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  getLaneTaskCount(laneKey: string): number {
    let count = 0;
    for (const status of this.columns) {
      count += this.getSwimlaneTasks(laneKey, this.rootTasksByColumn()[status]).length;
    }
    return count;
  }

  swimlaneMode = signal<'none' | 'assignee' | 'priority'>('none');

  setSwimlane(mode: 'none' | 'assignee' | 'priority'): void {
    this.swimlaneMode.set(mode);
    this.saveUserPreference('boardSwimlane', mode);
  }

  swimlaneKeys = computed<{ key: string; label: string; color?: string }[]>(() => {
    const mode = this.swimlaneMode();
    if (mode === 'none') return [];
    const tasks = this.tasksService.tasks().filter((t) => t.parentId === null);
    if (mode === 'assignee') {
      const assignedIds = new Set(
        tasks
          .map((task) => task.assigneeId)
          .filter((assigneeId): assigneeId is string => assigneeId !== null),
      );
      const keys: { key: string; label: string; color?: string }[] = this.sortedMembers()
        .filter((member) => assignedIds.has(member.uid))
        .map((member) => ({
          key: member.uid,
          label: member.name,
          color: member.avatarColor,
        }));
      if (tasks.some((task) => !task.assigneeId)) {
        keys.push({ key: '__none__', label: '未割当' });
      }
      return keys;
    }
    // priority
    const pKeys: { key: string; label: string }[] = [];
    const hasPriority = new Set<string>();
    tasks.forEach((t) => hasPriority.add(t.priority ?? '__none__'));
    if (hasPriority.has('high')) pKeys.push({ key: 'high', label: '🔴 高' });
    if (hasPriority.has('medium')) pKeys.push({ key: 'medium', label: '🟡 中' });
    if (hasPriority.has('low')) pKeys.push({ key: 'low', label: '🟢 低' });
    if (hasPriority.has('__none__')) pKeys.push({ key: '__none__', label: '優先度なし' });
    return pKeys;
  });

  swimlaneConnectedLists = computed(() => {
    const keys = this.swimlaneKeys();
    const ids: string[] = [];
    for (const lane of keys) {
      for (const status of this.columns) {
        ids.push(`swim-${lane.key}-${status}`);
      }
    }
    return ids;
  });

  getSwimlaneTasks(laneKey: string, statusTasks: Task[]): Task[] {
    const mode = this.swimlaneMode();
    if (mode === 'assignee') {
      return statusTasks.filter((t) =>
        laneKey === '__none__' ? !t.assigneeId : t.assigneeId === laneKey,
      );
    }
    // priority
    return statusTasks.filter((t) =>
      laneKey === '__none__' ? !t.priority : t.priority === laneKey,
    );
  }

  toggleFilters(): void {
    this.showFilters = !this.showFilters;
    this.showSortMenu = false;
  }

  toggleSortMenu(): void {
    this.showSortMenu = !this.showSortMenu;
    this.showFilters = false;
  }

  setSortBy(sort: 'none' | 'priority' | 'dueDate'): void {
    this.sortBy.set(sort);
    this.showSortMenu = false;
    this.saveUserPreference('sortBy', sort);
  }

  getSortLabel(): string {
    const labels = { none: '並び替え', priority: '優先度順', dueDate: '締切順' };
    return labels[this.sortBy()];
  }

  @HostListener('document:click', ['$event'])
  closeFilterPopoverOnOutsideClick(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof Element)) {
      this.showFilters = false;
      this.showSortMenu = false;
      return;
    }
    if (!target.closest('.filter-menu')) {
      this.showFilters = false;
    }
    if (!target.closest('.sort-menu')) {
      this.showSortMenu = false;
    }
    if (!target.closest('.swimlane-menu')) {
      this.showSwimlaneMenu = false;
    }
    if (!target.closest('.template-trigger-wrap')) {
      this.templatePickerColumn = null;
    }
  }

  clearFilters(): void {
    this.filterAssignee.set(null);
    this.filterPriority.set(null);
    this.filterFocus.set(false);
    this.filterWeek.set(null);
    this.searchQuery.set('');
    this.sortBy.set('none');
    this.showSortMenu = false;
    this.saveUserPreference('sortBy', 'none');
  }

  toggleFilterFocus(): void {
    const next = !this.filterFocus();
    this.filterFocus.set(next);
    if (next) {
      this.filterWeek.set(0);
    } else {
      this.filterWeek.set(null);
    }
  }

  setFilterWeek(value: number | null): void {
    this.filterWeek.set(value);
    if (value === 0) {
      this.filterFocus.set(true);
    } else {
      this.filterFocus.set(false);
    }
  }

  getTaskWeekIndex(task: Task): number | null {
    if (task.focusThisWeek) return 0;
    if (task.targetWeekStart) {
      const d = task.targetWeekStart instanceof Timestamp ? task.targetWeekStart.toDate() : new Date(task.targetWeekStart);
      return getWeekIndex(d);
    }
    if (task.dueDate) {
      const d = task.dueDate instanceof Timestamp ? task.dueDate.toDate() : new Date(task.dueDate);
      return getWeekIndex(d);
    }
    return null;
  }

  getPriorityLabel(priority: Priority): string {
    return { high: '高', medium: '中', low: '低' }[priority];
  }

  newRootColumn: TaskStatus | null = null;
  newRootTitle = '';
  newRootAssignee: string | null = null;
  newRootHours = 1;

  completingTask: Task | null = null;
  actualHoursInput = 0;

  pendingAdd: PendingAdd | null = null;
  deletingTask: Task | null = null;
  deletingChildCount = 0;
  withdrawingTask: Task | null = null;
  reviewActionTask: Task | null = null;
  reviewActionType: 'approve' | 'reject' | null = null;

  editingTask: Task | null = null;
  editTaskTitle = '';
  editTaskAssignee: string | null = null;
  editTaskHours = 1;
  editTaskDueDate = '';

  reviewingTask: Task | null = null;
  reviewReasonInput = '';

  editingCapacityMember: Member | null = null;
  capacityInput = 40;

  newRootDueDate = '';
  newSubtaskDueDate = '';

  newRootPriority: Priority | null = null;
  newRootRecurrence: RecurrenceType | null = null;
  private newRootTemplateSubtasks: { title: string; estimatedHours: number }[] = [];
  newSubtaskPriority: Priority | null = null;
  editTaskPriority: Priority | null = null;
  editTaskBlockedBy: string[] = [];
  editTaskDescription = '';
  editTaskRecurrence: RecurrenceType | null = null;
  editTaskFocus = false;
  editTaskFocusHours = 0;
  editTaskTargetWeek: string | null = null;

  newRootDescription = '';
  newRootFocus = false;
  newSubtaskDescription = '';
  newSubtaskFocus = false;

  filterAssignee = signal<string | null>(null);
  filterPriority = signal<Priority | null>(null);
  filterFocus = signal(false);
  filterWeek = signal<number | null>(null);
  weekLabels = getForecastWeekLabels();

  searchQuery = signal('');

  // 一括操作
  bulkMode = signal(false);
  bulkSelected = signal<Set<string>>(new Set());

  toggleBulkMode(): void {
    this.bulkMode.update((v) => !v);
    if (!this.bulkMode()) this.bulkSelected.set(new Set());
  }

  toggleBulkSelect(taskId: string, event: Event): void {
    event.stopPropagation();
    this.bulkSelected.update((set) => {
      const next = new Set(set);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }

  bulkSelectAll(): void {
    const allIds = new Set(
      Object.values(this.rootTasksByColumn())
        .flat()
        .map((t) => t.id),
    );
    this.bulkSelected.set(allIds);
  }

  bulkDeselectAll(): void {
    this.bulkSelected.set(new Set());
  }

  // 一括変更: 選択してから適用
  bulkStatus = '';
  bulkAssignee = '';
  bulkPriority = '';
  bulkDueDateInput = '';
  bulkFocus = '';
  bulkDeleting = false;

  bulkHasChanges(): boolean {
    return !!(this.bulkStatus || this.bulkAssignee || this.bulkPriority || this.bulkDueDateInput || this.bulkFocus);
  }

  bulkResetSelections(): void {
    this.bulkStatus = '';
    this.bulkAssignee = '';
    this.bulkPriority = '';
    this.bulkDueDateInput = '';
    this.bulkFocus = '';
  }

  async bulkApply(): Promise<void> {
    const ids = [...this.bulkSelected()];
    if (ids.length === 0) return;
    let changed = 0;

    if (this.bulkStatus) {
      for (const id of ids) {
        const task = this.tasksService.tasks().find((t) => t.id === id);
        if (!task || !this.canMoveTask(task)) continue;
        if (this.bulkStatus === '完了') {
          if (this.tasksService.isBlocked(task)) continue;
          await this.tasksService.completeTask(id, task.estimatedHours ?? 0);
          await this.tasksService.spawnRecurrence(task);
        } else {
          await this.tasksService.updateStatus(id, this.bulkStatus as TaskStatus);
        }
      }
      changed++;
    }

    if (this.bulkAssignee) {
      const uid = this.bulkAssignee === '__none__' ? null : this.bulkAssignee;
      for (const id of ids) {
        await this.tasksService.updateTask(id, { assigneeId: uid });
      }
      changed++;
    }

    if (this.bulkPriority) {
      const priority = this.bulkPriority === '__none__' ? null : this.bulkPriority as Priority;
      for (const id of ids) {
        await this.tasksService.updateTask(id, { priority });
      }
      changed++;
    }

    if (this.bulkDueDateInput) {
      const dueDate = Timestamp.fromDate(new Date(this.bulkDueDateInput));
      for (const id of ids) {
        await this.tasksService.updateTask(id, { dueDate });
      }
      changed++;
    }

    if (this.bulkFocus) {
      const on = this.bulkFocus === 'on';
      for (const id of ids) {
        const task = this.tasksService.tasks().find((t) => t.id === id);
        await this.tasksService.updateTask(id, {
          focusThisWeek: on,
          focusHours: on ? (task?.focusHours ?? task?.estimatedHours ?? 0) : null,
        });
      }
      changed++;
    }

    if (changed > 0) {
      this.notificationService.show('一括変更', `${ids.length}件のタスクを変更しました`);
    }
    this.bulkResetSelections();
  }

  async bulkDelete(): Promise<void> {
    const ids = [...this.bulkSelected()];
    let deleted = 0;
    for (const id of ids) {
      const task = this.tasksService.tasks().find((t) => t.id === id);
      if (!task || !this.canMoveTask(task)) continue;
      const shouldCloseCommentPanel = this.isTaskInDeleteTree(this.selectedTask()?.id, id);
      await this.tasksService.deleteTask(id);
      if (shouldCloseCommentPanel) this.closeCommentPanel();
      deleted++;
    }
    this.notificationService.show('一括削除', `${deleted}件のタスクを削除しました`);
    this.bulkSelected.set(new Set());
    this.bulkDeleting = false;
  }

  selectedTask = signal<Task | null>(null);
  expandedCompactTaskId = signal<string | null>(null);
  expandedSubtaskIds = signal<Set<string>>(new Set());
  private optimisticTaskOrders = signal<Record<string, string[]>>({});
  private taskOrderVersions = new Map<string, number>();
  sidebarCollapsed = signal(false);
  sidebarWidth = signal(260);
  commentPanelWidth = signal(320);
  private resizingPanel: 'sidebar' | 'comment' | null = null;
  private resizeStartX = 0;
  private resizeStartWidth = 0;

  // モバイル判定
  isMobile = signal(typeof window !== 'undefined' && window.innerWidth <= 768);

  @HostListener('window:resize')
  onResize() {
    const isMobile = window.innerWidth <= 768;
    this.isMobile.set(isMobile);
    if (isMobile) return;

    this.sidebarWidth.update((width) => this.clampSidebarWidth(width));
    this.commentPanelWidth.update((width) => this.clampCommentPanelWidth(width));
  }

  private clampSidebarWidth(width: number): number {
    return Math.max(180, Math.min(420, window.innerWidth - 400, width));
  }

  private clampCommentPanelWidth(width: number): number {
    const available = window.innerWidth - (this.sidebarCollapsed() ? 48 : this.sidebarWidth()) - 60;
    return Math.max(260, Math.min(520, available, width));
  }

  startPanelResize(panel: 'sidebar' | 'comment', event: PointerEvent): void {
    if (this.isMobile() || event.button !== 0) return;
    event.preventDefault();
    this.resizingPanel = panel;
    this.resizeStartX = event.clientX;
    this.resizeStartWidth = panel === 'sidebar' ? this.sidebarWidth() : this.commentPanelWidth();
  }

  @HostListener('window:pointermove', ['$event'])
  resizePanel(event: PointerEvent): void {
    if (!this.resizingPanel) return;
    if (this.resizingPanel === 'sidebar') {
      this.sidebarWidth.set(this.clampSidebarWidth(event.clientX));
    } else {
      this.commentPanelWidth.set(
        this.clampCommentPanelWidth(this.resizeStartWidth + this.resizeStartX - event.clientX),
      );
    }
  }

  @HostListener('window:pointerup')
  finishPanelResize(): void {
    if (!this.resizingPanel) return;
    this.resizingPanel = null;
  }

  adjustPanelWidth(panel: 'sidebar' | 'comment', event: KeyboardEvent): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const delta = event.key === 'ArrowRight' ? 16 : -16;
    if (panel === 'sidebar') {
      this.sidebarWidth.update((width) => this.clampSidebarWidth(width + delta));
    } else {
      this.commentPanelWidth.update((width) => this.clampCommentPanelWidth(width + delta));
    }
  }
  private sidebarOrderVersion = signal(0);

  // 自分を先頭に固定したメンバーリスト
  sortedMembers = computed(() => {
    const uid = this.auth.currentUser()?.uid;
    const members = this.tasksService.members();
    this.sidebarOrderVersion();
    return sortMembersBySavedOrder(
      members,
      uid ?? null,
      (member) => member.uid,
      (a, b) =>
        this.tasksService.getFocusLoadPercent(b.uid) - this.tasksService.getFocusLoadPercent(a.uid),
    );
  });

  draggableSidebarMembers = computed(() => this.sortedMembers().slice(1));

  route = inject(ActivatedRoute);
  router = inject(Router);
  private lastAssigneeQueryParam: string | null | undefined;

  constructor() {
    effect(() => {
      const tasks = this.tasksService.tasks();
      const optimisticOrders = this.optimisticTaskOrders();
      const syncedKeys = Object.entries(optimisticOrders)
        .filter(([key, orderedIds]) => {
          const orderedIdSet = new Set(orderedIds);
          const currentIds = tasks
            .filter((task) =>
              key === 'root'
                ? task.parentId === null && orderedIdSet.has(task.id)
                : task.parentId === key && orderedIdSet.has(task.id),
            )
            .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
            .map((task) => task.id);
          return (
            currentIds.length === orderedIds.length &&
            currentIds.every((id, index) => id === orderedIds[index])
          );
        })
        .map(([key]) => key);

      if (syncedKeys.length > 0) {
        this.optimisticTaskOrders.update((orders) => {
          const next = { ...orders };
          syncedKeys.forEach((key) => delete next[key]);
          return next;
        });
      }
    });

    effect(() => {
      const uid = this.auth.currentUser()?.uid;
      this.viewMode.set(
        this.readUserPreference(uid, 'boardViewMode', ['detail', 'compact'], 'detail'),
      );
      this.swimlaneMode.set(
        this.readUserPreference(uid, 'boardSwimlane', ['none', 'assignee', 'priority'], 'none'),
      );
      this.sidebarCollapsed.set(
        this.readUserPreference(uid, 'sidebarCollapsed', ['true', 'false'], 'false') === 'true',
      );
      this.sortBy.set(
        this.readUserPreference(uid, 'sortBy', ['none', 'priority', 'dueDate'] as const, 'none'),
      );
    });

    effect(() => {
      if (this.selectedTask() && !this.isMobile()) {
        document.documentElement.style.setProperty(
          '--comment-panel-width',
          `${this.commentPanelWidth()}px`,
        );
      } else {
        document.documentElement.style.removeProperty('--comment-panel-width');
      }
    });

    this.destroyRef.onDestroy(() => {
      document.documentElement.style.removeProperty('--comment-panel-width');
    });

    this.route.queryParams.subscribe((params) => {
      const taskId = params['taskId'];
      const assigneeId = params['assigneeId'] ?? null;

      // taskId の更新でもクエリ全体が再通知されるため、担当者クエリが
      // 変わったときだけフィルターへ反映する。
      if (assigneeId !== this.lastAssigneeQueryParam) {
        this.lastAssigneeQueryParam = assigneeId;
        if (assigneeId) {
          this.filterAssignee.set(assigneeId);
          this.showFilters = true;
        }
      }

      if (!taskId) return;

      // tasksが読み込まれていない場合はsignal経由でリアクティブに検索
      const tryFind = (attempts = 0) => {
        const task = this.tasksService.tasks().find((t) => t.id === taskId);
        if (task) {
          this.selectedTask.set(task);
          this.scrollToTask(task.id);
        } else if (attempts < 20) {
          // 最大20回（6秒）リトライ
          setTimeout(() => tryFind(attempts + 1), 300);
        }
      };
      tryFind();
    });
  }

  toggleSidebarCollapsed(): void {
    const next = !this.sidebarCollapsed();
    this.sidebarCollapsed.set(next);
    this.saveUserPreference('sidebarCollapsed', String(next));
  }

  private readUserPreference<T extends string>(
    uid: string | undefined,
    preference: 'boardViewMode' | 'boardSwimlane' | 'sidebarCollapsed' | 'sortBy',
    allowedValues: readonly T[],
    fallback: T,
  ): T {
    if (!uid) return fallback;

    const value = localStorage.getItem(`${preference}:${uid}`);
    return allowedValues.find((candidate) => candidate === value) ?? fallback;
  }

  private saveUserPreference(
    preference: 'boardViewMode' | 'boardSwimlane' | 'sidebarCollapsed' | 'sortBy',
    value: string,
  ): void {
    const uid = this.auth.currentUser()?.uid;
    if (uid) localStorage.setItem(`${preference}:${uid}`, value);
  }

  reorderSidebar(event: CdkDragDrop<Member[]>): void {
    const uid = this.auth.currentUser()?.uid;
    if (!uid) {
      return;
    }

    const otherMembers = [...this.draggableSidebarMembers()];
    if (
      event.previousIndex < 0 ||
      event.currentIndex < 0 ||
      event.previousIndex >= otherMembers.length ||
      event.currentIndex >= otherMembers.length
    ) {
      return;
    }

    moveItemInArray(otherMembers, event.previousIndex, event.currentIndex);
    saveMemberOrder(uid, otherMembers);
    this.sidebarOrderVersion.update((version) => version + 1);
  }

  // サイドバーからメンバーフィルタ
  filterByMember(uid: string): void {
    if (this.filterAssignee() === uid) {
      this.filterAssignee.set(null);
      this.showFilters = false;
    } else {
      this.filterAssignee.set(uid);
      this.showFilters = true;
    }
  }

  addRootError = '';
  addSubtaskError = '';

  sortBy = signal<'none' | 'priority' | 'dueDate'>('none');

  openCapacityEdit(member: Member): void {
    this.editingCapacityMember = member;
    this.capacityInput = member.weeklyCapacityHours;
  }

  async confirmCapacityEdit(): Promise<void> {
    if (this.editingCapacityMember && this.capacityInput > 0) {
      await this.tasksService.updateMemberCapacity(
        this.editingCapacityMember.uid,
        this.capacityInput,
      );
      this.notificationService.show('更新完了', `${this.editingCapacityMember.name}さんの稼働時間を変更しました`);
    }
    this.editingCapacityMember = null;
  }

  cancelCapacityEdit(): void {
    this.editingCapacityMember = null;
  }

  rootTasksByColumn = computed(() => {
    let all = this.tasksService.tasks().filter((t) => t.parentId === null);

    // 検索フィルター
    const query = this.searchQuery().trim().toLowerCase();
    if (query) {
      all = all.filter((t) => t.title.toLowerCase().includes(query));
    }

    // 担当者フィルター
    if (this.filterAssignee()) {
      all = all.filter((t) => t.assigneeId === this.filterAssignee());
    }

    // 優先度フィルター
    if (this.filterPriority()) {
      all = all.filter((t) => t.priority === this.filterPriority());
    }

    // フォーカスフィルター
    if (this.filterFocus()) {
      all = all.filter((t) => t.focusThisWeek);
    }

    // 週フィルター（フォーカス以外の週）
    const weekFilter = this.filterWeek();
    if (weekFilter !== null && !this.filterFocus()) {
      all = all.filter((t) => this.getTaskWeekIndex(t) === weekFilter);
    }

    // 優先度・締切でソート
    const sort = this.sortBy();
    if (sort === 'priority') {
      const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
      all = [...all].sort((a, b) => {
        const pa = a.priority ? (priorityOrder[a.priority] ?? 3) : 3;
        const pb = b.priority ? (priorityOrder[b.priority] ?? 3) : 3;
        return pa - pb;
      });
    } else if (sort === 'dueDate') {
      all = [...all].sort((a, b) => {
        if (!a.dueDate && !b.dueDate) return 0;
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return a.dueDate.toDate().getTime() - b.dueDate.toDate().getTime();
      });
    }

    const grouped: Record<string, Task[]> = {};
    for (const status of this.columns) {
      if (status === '進行中') {
        grouped[status] = all.filter((t) => t.status === '進行中' || t.status === '差し戻し中');
      } else {
        grouped[status] = all.filter((t) => t.status === status);
      }
      const optimisticOrder = this.optimisticTaskOrders()['root'];
      if (optimisticOrder) {
        const orderById = new Map(optimisticOrder.map((id, index) => [id, index]));
        grouped[status] = [...grouped[status]].sort((a, b) => {
          const aIndex = orderById.get(a.id);
          const bIndex = orderById.get(b.id);
          if (aIndex !== undefined && bIndex !== undefined) return aIndex - bIndex;
          if (aIndex !== undefined) return -1;
          if (bIndex !== undefined) return 1;
          return a.order - b.order || a.id.localeCompare(b.id);
        });
      }
    }
    return grouped;
  });

  getChildren(epicId: string): Task[] {
    const children = this.tasksService
      .tasks()
      .filter((t) => t.parentId === epicId)
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    const optimisticOrder = this.optimisticTaskOrders()[epicId];
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

  private clearOptimisticTaskOrder(key: string): void {
    this.optimisticTaskOrders.update((orders) => {
      if (!(key in orders)) return orders;
      const next = { ...orders };
      delete next[key];
      return next;
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
    const version = (this.taskOrderVersions.get(parentId) ?? 0) + 1;
    this.taskOrderVersions.set(parentId, version);
    this.optimisticTaskOrders.update((orders) => ({ ...orders, [parentId]: orderedIds }));
    this.cdr.detectChanges();
    try {
      await this.tasksService.reorderSubtasks(parentId, orderedIds);
    } catch (error) {
      if (this.taskOrderVersions.get(parentId) === version) {
        this.clearOptimisticTaskOrder(parentId);
      }
      console.error('サブタスクの並び替えエラー:', error);
      this.notificationService.show('並び替えエラー', 'サブタスクの順序を保存できませんでした');
    }
  }

  getMemberName(memberId: string | null): string {
    if (!memberId) return '未割当';
    return this.tasksService.members().find((m) => m.uid === memberId)?.name ?? '不明';
  }

  getMemberColor(memberId: string | null): string {
    return this.tasksService.members().find((m) => m.uid === memberId)?.avatarColor ?? '#9AA3B2';
  }

  getMemberTaskCount(memberId: string): number {
    return this.tasksService.tasks().filter((t) => t.assigneeId === memberId && t.status !== '完了')
      .length;
  }

  getMemberTotalHours(memberId: string): number {
    return this.tasksService.getMemberActiveHours(memberId);
  }

  getLoadPct(memberId: string): number {
    const member = this.tasksService.members().find((m) => m.uid === memberId);
    if (!member) return 0;

    let totalHours = this.tasksService.getMemberFocusHours(memberId);

    // ① 新規タスク（親）を追加しようとしている場合（フォーカスONのみ）
    if (this.newRootColumn && this.newRootFocus && this.newRootAssignee === memberId) {
      totalHours += this.newRootHours || 0;
    }

    // ② サブタスクを追加しようとしている場合
    if (this.openEpicId) {
      const addHours = this.newSubtaskHours || 0;
      const parentTask = this.tasksService.tasks().find((t) => t.id === this.openEpicId);

      if (parentTask) {
        // 親タスクのバッファが今回の追加で「どれくらい消費されるか」を計算
        const children = this.tasksService.tasks().filter((t) => t.parentId === this.openEpicId);
        const currentChildrenHours = children.reduce((sum, c) => sum + (c.estimatedHours || 0), 0);
        const parentEstimate = parentTask.estimatedHours || 0;

        const oldBuffer = Math.max(0, parentEstimate - currentChildrenHours);
        const newBuffer = Math.max(0, parentEstimate - (currentChildrenHours + addHours));
        const bufferDiff = oldBuffer - newBuffer; // 消費されるバッファ量（相殺される分）

        if (parentTask.assigneeId === memberId) {
          // 【親と子が同じ担当者の場合】追加分からバッファ消費分を相殺する
          if (this.newSubtaskAssignee === memberId) {
            totalHours += addHours - bufferDiff;
          } else {
            // 【子が別の人に割り当てられた場合】親の人はバッファが消費された分だけ負荷が軽くなる
            totalHours -= bufferDiff;
          }
        } else if (this.newSubtaskAssignee === memberId) {
          // 【子が親と違う担当者の場合】その人には純粋に追加分だけ負荷が乗る
          totalHours += addHours;
        }
      }
    }

    return Math.round((totalHours / member.weeklyCapacityHours) * 100);
  }

  private getEditLoadPct(memberId: string, addHours: number): number {
    const member = this.tasksService.members().find((m) => m.uid === memberId);
    if (!member) return 0;
    const editingId = this.editingTask?.id;
    const tasks = this.tasksService.tasks().filter(
      (t) =>
        t.assigneeId === memberId &&
        t.focusThisWeek &&
        t.status !== '完了' &&
        t.status !== 'アーカイブ済み' &&
        t.id !== editingId,
    );
    let totalHours = tasks.reduce((sum, t) => sum + (t.focusHours ?? t.estimatedHours ?? 0), 0);
    totalHours += addHours;
    return Math.round((totalHours / member.weeklyCapacityHours) * 100);
  }

  getBlockedLabel(task: Task): string | null {
    if (!this.tasksService.isBlocked(task)) return null;
    const blockerId = task.blockedBy.find((id) => {
      const b = this.tasksService.tasks().find((t) => t.id === id);
      return b && b.status !== '完了';
    });
    const blockerTitle =
      this.tasksService.tasks().find((t) => t.id === blockerId)?.title ?? '別のタスク';
    return `${blockerTitle} 待ち`;
  }

  getStatusColor(status: TaskStatus): string {
    switch (status) {
      case '未着手':
        return 'todo';
      case '進行中':
        return 'active';
      case '差し戻し中':
        return 'review';
      case '完了':
        return 'done';
      case 'アーカイブ済み':
        return 'archived';
      default:
        return '';
    }
  }

  canMoveTask(task: Task): boolean {
    const uid = this.auth.currentUser()?.uid;
    if (!uid) return false;
    if (this.isManager()) return true;
    return task.assigneeId === uid || task.createdBy === uid;
  }

  getStatusClass(status: TaskStatus): string {
    return this.getStatusColor(status);
  }

  formatDate(timestamp: any): string {
    if (!timestamp?.toDate) return '';
    const d = timestamp.toDate();
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  loadLevel(pct: number): LoadLevel {
    if (pct >= 100) return 'danger';
    if (pct >= 80) return 'warn';
    return 'ok';
  }

  suggestAlternative(excludeId: string | null): { uid: string; name: string; pct: number } | null {
    const candidates = this.getAlternativeCandidates(excludeId);
    return candidates[0] ?? null;
  }

  getAlternativeCandidates(excludeId: string | null): { uid: string; name: string; pct: number }[] {
    return this.tasksService
      .members()
      .filter((m) => m.uid !== excludeId)
      .map((m) => ({ uid: m.uid, name: m.name, pct: this.tasksService.getFocusLoadPercent(m.uid) }))
      .sort((a, b) => a.pct - b.pct);
  }

  isManager(): boolean {
    const uid = this.auth.currentUser()?.uid;
    if (!uid) return false;
    const member = this.tasksService.members().find((m) => m.uid === uid);
    return member?.role === 'manager';
  }

  // --- ドラッグ&ドロップ ---

  async onDrop(event: CdkDragDrop<Task[]>, targetStatus: TaskStatus): Promise<void> {
    const task = event.item.data as Task;
    if (!task) return;

    if (!this.canMoveTask(task)) {
      this.notificationService.show('権限エラー', '他人のタスクは移動できません');
      return;
    }

    // 同じカラム内での並び替え
    if (event.previousContainer === event.container) {
      const list = [...(this.rootTasksByColumn()[targetStatus] ?? [])];
      const sourceIndex = list.findIndex((item) => item.id === task.id);
      if (
        sourceIndex < 0 ||
        event.currentIndex < 0 ||
        event.currentIndex >= list.length ||
        sourceIndex === event.currentIndex
      ) {
        return;
      }
      moveItemInArray(list, sourceIndex, event.currentIndex);
      const orderedIds = list.map((item) => item.id);
      const version = (this.taskOrderVersions.get('root') ?? 0) + 1;
      this.taskOrderVersions.set('root', version);
      this.optimisticTaskOrders.update((orders) => ({ ...orders, root: orderedIds }));
      this.cdr.detectChanges();
      try {
        await this.tasksService.reorderRootTasks(orderedIds);
      } catch (error) {
        if (this.taskOrderVersions.get('root') === version) {
          this.clearOptimisticTaskOrder('root');
        }
        console.error('タスクの並び替えエラー:', error);
        this.notificationService.show('並び替えエラー', 'タスクの順序を保存できませんでした');
      }
      return;
    }

    if (task.status === targetStatus) return;
    if (targetStatus === '完了' && this.tasksService.isBlocked(task)) {
      this.notificationService.show(
        'ブロック中',
        `「${task.title}」は依存タスクが完了するまで完了にできません`,
      );
      return;
    }
    if (targetStatus === '完了') {
      this.startComplete(task);
    } else {
      // 完了から戻す場合は実績時間をリセット
      if (task.status === '完了') {
        await this.tasksService.updateTask(task.id, { actualHours: null });
      }
      await this.tasksService.updateStatus(task.id, targetStatus);
    }
  }

  async onSwimlaneDrop(event: CdkDragDrop<Task[]>, targetStatus: TaskStatus): Promise<void> {
    const task = event.item.data as Task;
    if (!task) return;

    if (!this.canMoveTask(task)) {
      this.notificationService.show('権限エラー', '他人のタスクは移動できません');
      return;
    }

    if (event.previousContainer === event.container) {
      const filteredList = [...(event.container.data as Task[])];
      const sourceIdx = filteredList.findIndex((item) => item.id === task.id);
      if (
        sourceIdx < 0 ||
        event.currentIndex < 0 ||
        event.currentIndex >= filteredList.length ||
        sourceIdx === event.currentIndex
      ) {
        return;
      }
      moveItemInArray(filteredList, sourceIdx, event.currentIndex);
      const fullList = [...(this.rootTasksByColumn()[targetStatus] ?? [])];
      const laneIds = new Set(filteredList.map((t) => t.id));
      const result: Task[] = [];
      let fi = 0;
      for (const t of fullList) {
        if (laneIds.has(t.id)) {
          result.push(filteredList[fi++]);
        } else {
          result.push(t);
        }
      }
      const orderedIds = result.map((item) => item.id);
      const version = (this.taskOrderVersions.get('root') ?? 0) + 1;
      this.taskOrderVersions.set('root', version);
      this.optimisticTaskOrders.update((orders) => ({ ...orders, root: orderedIds }));
      this.cdr.detectChanges();
      try {
        await this.tasksService.reorderRootTasks(orderedIds);
      } catch (error) {
        if (this.taskOrderVersions.get('root') === version) {
          this.clearOptimisticTaskOrder('root');
        }
        console.error('タスクの並び替えエラー:', error);
        this.notificationService.show('並び替えエラー', 'タスクの順序を保存できませんでした');
      }
      return;
    }

    if (task.status === targetStatus) return;
    if (targetStatus === '完了' && this.tasksService.isBlocked(task)) {
      this.notificationService.show(
        'ブロック中',
        `「${task.title}」は依存タスクが完了するまで完了にできません`,
      );
      return;
    }
    if (targetStatus === '完了') {
      this.startComplete(task);
    } else {
      if (task.status === '完了') {
        await this.tasksService.updateTask(task.id, { actualHours: null });
      }
      await this.tasksService.updateStatus(task.id, targetStatus);
    }
  }

  // --- ルートタスク追加 ---

  // --- テンプレートから作成 ---
  templatePickerColumn: TaskStatus | null = null;

  toggleTemplatePicker(status: TaskStatus): void {
    this.templatePickerColumn = this.templatePickerColumn === status ? null : status;
  }

  createFromTemplate(tpl: TaskTemplate, status: TaskStatus): void {
    this.templatePickerColumn = null;
    this.newRootColumn = status;
    this.newRootTitle = tpl.title;
    this.newRootDescription = tpl.description || '';
    this.newRootAssignee = null;
    this.newRootHours = tpl.estimatedHours || 1;
    this.newRootDueDate = '';
    this.newRootPriority = tpl.priority;
    this.newRootFocus = false;
    this.addRootError = '';
    this.newRootTemplateSubtasks = tpl.subtasks?.filter((s) => s.title.trim()) ?? [];
  }

  toggleAddRoot(status: TaskStatus): void {
    if (this.newRootColumn === status) {
      this.newRootColumn = null;
    } else {
      this.newRootColumn = status;
      this.newRootTitle = '';
      this.newRootDescription = '';
      this.newRootAssignee = null;
      this.newRootHours = 1;
      this.newRootDueDate = '';
      this.newRootPriority = null;
      this.newRootFocus = false;
      this.newRootRecurrence = null;
      this.addRootError = '';
      this.newRootTemplateSubtasks = [];
    }
  }

  async confirmAddRoot(status: TaskStatus): Promise<void> {
    const title = this.newRootTitle.trim();
    if (!title) {
      this.addRootError = 'タスク名を入力してください';
      return;
    }
    this.addRootError = '';

    if (this.newRootFocus && this.newRootAssignee) {
      const pct = this.getLoadPct(this.newRootAssignee as string);
      if (pct >= 100) {
        const alt = this.suggestAlternative(this.newRootAssignee);
        const candidates = this.getAlternativeCandidates(this.newRootAssignee);
        this.pendingAdd = {
          kind: 'root',
          status,
          name: this.getMemberName(this.newRootAssignee),
          pct,
          altName: alt?.name ?? null,
          altUid: alt?.uid ?? null,
          altPct: alt?.pct ?? 0,
          candidates,
        };
        return;
      }
    }
    await this.doAddRoot(status);
  }

  private async doAddRoot(status: TaskStatus): Promise<void> {
    const title = this.newRootTitle.trim();
    const description = this.newRootDescription.trim();
    const assignee = this.newRootAssignee;
    const hours = this.newRootHours;
    const dueDate = this.newRootDueDate ? new Date(this.newRootDueDate) : null;
    this.newRootColumn = null;
    this.pendingAdd = null;
    const focus = this.newRootFocus;
    const recurrence = this.newRootRecurrence;
    const taskId = await this.tasksService.createTask({
      title,
      description,
      parentId: null,
      assigneeId: assignee,
      createdBy: this.auth.currentUser()?.uid ?? null,
      estimatedHours: hours,
      dueDate: dueDate ? Timestamp.fromDate(dueDate) : null,
      status,
      priority: this.newRootPriority,
      focusThisWeek: focus,
      focusHours: focus ? hours : null,
      recurrence: recurrence ?? null,
    });
    for (const sub of this.newRootTemplateSubtasks) {
      await this.tasksService.createTask({
        title: sub.title,
        description: '',
        parentId: taskId,
        assigneeId: assignee,
        createdBy: this.auth.currentUser()?.uid ?? null,
        estimatedHours: sub.estimatedHours,
        dueDate: dueDate ? Timestamp.fromDate(dueDate) : null,
        status: '未着手',
        priority: this.newRootPriority,
      });
    }
    this.newRootPriority = null;
    this.newRootRecurrence = null;
    this.newRootTemplateSubtasks = [];
    this.notificationService.show('タスク作成', `「${title}」を作成しました`);
    setTimeout(() => this.scrollToTask(taskId), 150);
  }

  // --- 子タスク追加 ---

  toggleAddForm(epicId: string): void {
    if (this.openEpicId === epicId) {
      this.openEpicId = null;
    } else {
      this.expandedSubtaskIds.update((ids) => {
        const next = new Set(ids);
        next.add(epicId);
        return next;
      });
      this.openEpicId = epicId;
      this.newSubtaskTitle = '';
      this.newSubtaskDescription = '';
      this.newSubtaskAssignee = null;
      this.newSubtaskHours = null;
      this.newSubtaskDueDate = '';
      this.newSubtaskPriority = null;
      this.newSubtaskFocus = false;
      this.addSubtaskError = '';
      requestAnimationFrame(() => this.scrollSubtaskAddFormIntoView(epicId));
    }
  }

  private scrollSubtaskAddFormIntoView(epicId: string): void {
    const form = document.getElementById(`subtask-add-form-${epicId}`);
    const scrollContainer = form?.closest<HTMLElement>('.board-outer');
    if (!form || !scrollContainer) return;

    const formRect = form.getBoundingClientRect();
    const containerRect = scrollContainer.getBoundingClientRect();
    const bottomOverflow = formRect.bottom - containerRect.bottom;
    const topOverflow = containerRect.top - formRect.top;
    if (bottomOverflow > 0) {
      scrollContainer.scrollBy({ top: bottomOverflow + 16, behavior: 'smooth' });
    } else if (topOverflow > 0) {
      scrollContainer.scrollBy({ top: -(topOverflow + 16), behavior: 'smooth' });
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

  async confirmAddSubtask(epicId: string): Promise<void> {
    const title = this.newSubtaskTitle.trim();
    if (!title) {
      this.addSubtaskError = 'サブタスク名を入力してください';
      return;
    }
    this.addSubtaskError = '';

    if (this.newSubtaskAssignee) {
      const pct = this.getLoadPct(this.newSubtaskAssignee as string);
      if (pct >= 100) {
        const alt = this.suggestAlternative(this.newSubtaskAssignee);
        const candidates = this.getAlternativeCandidates(this.newSubtaskAssignee);
        this.pendingAdd = {
          kind: 'sub',
          epicId,
          name: this.getMemberName(this.newSubtaskAssignee),
          pct,
          altName: alt?.name ?? null,
          altUid: alt?.uid ?? null,
          altPct: alt?.pct ?? 0,
          candidates,
        };
        return;
      }
    }
    await this.doAddSubtask(epicId);
  }

  async toggleSubtaskStatus(child: Task): Promise<void> {
    if (!this.canMoveTask(child)) {
      this.notificationService.show('権限エラー', '他人のタスクは更新できません');
      return;
    }
    const isDone = this.getStatusColor(child.status) === 'done';
    if (isDone) {
      // 完了 → 未着手に戻す（実績時間もリセット）
      await this.tasksService.updateTask(child.id, { actualHours: null });
      await this.tasksService.updateStatus(child.id, this.columns[0]);
    } else {
      // 未完了 → 完了モーダルを表示して実績時間を入力させる
      this.startComplete(child);
    }
  }

  private async doAddSubtask(epicId: string): Promise<void> {
    const title = this.newSubtaskTitle.trim();
    const description = this.newSubtaskDescription.trim();
    const assignee = this.newSubtaskAssignee;
    const hours = this.newSubtaskHours;
    const dueDate = this.newSubtaskDueDate ? new Date(this.newSubtaskDueDate) : null;
    this.openEpicId = null;
    this.pendingAdd = null;
    const taskId = await this.tasksService.createTask({
      title,
      description,
      parentId: epicId,
      assigneeId: assignee,
      createdBy: this.auth.currentUser()?.uid ?? null,
      estimatedHours: hours || 0,
      dueDate: dueDate ? Timestamp.fromDate(dueDate) : null,
      status: '未着手',
      priority: this.newSubtaskPriority,
    });
    this.newSubtaskPriority = null;
    this.notificationService.show('サブタスク作成', `「${title}」を追加しました`);
    setTimeout(() => this.scrollToTask(taskId), 150);
  }

  // --- 負荷警告モーダル ---

  async proceedPendingAdd(): Promise<void> {
    const p = this.pendingAdd;
    if (!p) return;
    if (p.kind === 'root' && p.status) {
      await this.doAddRoot(p.status);
    } else if (p.kind === 'sub' && p.epicId) {
      await this.doAddSubtask(p.epicId);
    } else if (p.kind === 'edit') {
      this.pendingAdd = null;
      await this.doEditTask();
    }
  }

  switchToAlternative(uid?: string): void {
    const p = this.pendingAdd;
    if (!p) return;
    const targetUid = uid ?? p.altUid;
    if (!targetUid) return;
    if (p.kind === 'root') {
      this.newRootAssignee = targetUid;
    } else if (p.kind === 'sub') {
      this.newSubtaskAssignee = targetUid;
    } else if (p.kind === 'edit') {
      this.editTaskAssignee = targetUid;
    }
    this.pendingAdd = null;
  }

  cancelPendingAdd(): void {
    this.pendingAdd = null;
  }

  // --- ステータス操作 ---

  async moveTask(task: Task, newStatus: TaskStatus): Promise<void> {
    if (!this.canMoveTask(task)) {
      this.notificationService.show('権限エラー', '他人のタスクは移動できません');
      return;
    }
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
      // 完了から戻す場合は実績時間をリセット
      if (task.status === '完了') {
        await this.tasksService.updateTask(task.id, { actualHours: null });
      }
      await this.tasksService.updateStatus(task.id, newStatus);
    }
  }

  startComplete(task: Task): void {
    if (!task.estimatedHours) {
      this.tasksService.completeTask(task.id, 0);
      this.tasksService.spawnRecurrence(task);
      this.notificationService.show('完了', `「${task.title}」を完了にしました`);
      return;
    }
    this.completingTask = task;
    this.actualHoursInput = task.estimatedHours;
  }

  async confirmComplete(): Promise<void> {
    const task = this.completingTask;
    if (!task) return;
    const hours = this.actualHoursInput;
    if (hours == null || hours < 0 || !Number.isFinite(hours)) {
      this.notificationService.show('入力エラー', '実績時間を正しく入力してください');
      return;
    }
    this.completingTask = null;
    await this.tasksService.completeTask(task.id, hours);
    await this.tasksService.spawnRecurrence(task);
    this.notificationService.show('完了', `「${task.title}」を完了にしました`);
  }

  cancelComplete(): void {
    this.completingTask = null;
  }

  // --- 差し戻し ---

  requestReview(task: Task): void {
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
    this.reviewingTask = null;
    await this.tasksService.requestReview(task.id, reason);
    this.notificationService.show('差し戻し申請', `「${task.title}」の差し戻しを申請しました`);
  }

  cancelReview(): void {
    this.reviewingTask = null;
  }

  startWithdrawReview(task: Task, event?: Event): void {
    event?.stopPropagation();
    this.withdrawingTask = task;
  }

  cancelWithdrawReview(): void {
    this.withdrawingTask = null;
  }

  async confirmWithdrawReview(): Promise<void> {
    const task = this.withdrawingTask;
    if (!task) return;
    this.withdrawingTask = null;
    await this.tasksService.withdrawReview(task.id);
    this.notificationService.show('取り消し完了', `「${task.title}」の差し戻しを取り消しました`);
  }

  startReviewAction(task: Task, type: 'approve' | 'reject', event?: Event): void {
    event?.stopPropagation();
    this.reviewActionTask = task;
    this.reviewActionType = type;
  }

  cancelReviewAction(): void {
    this.reviewActionTask = null;
    this.reviewActionType = null;
  }

  async confirmReviewAction(): Promise<void> {
    const task = this.reviewActionTask;
    const type = this.reviewActionType;
    if (!task || !type) return;
    this.reviewActionTask = null;
    this.reviewActionType = null;
    if (type === 'approve') {
      await this.tasksService.approveReview(task.id);
      this.notificationService.show('承認完了', `「${task.title}」を未着手に戻しました`);
    } else {
      await this.tasksService.rejectReview(task.id);
      this.notificationService.show('却下完了', `「${task.title}」を進行中に戻しました`);
    }
  }

  // --- アーカイブ ---

  async archiveTask(task: Task, event?: Event): Promise<void> {
    if (event) event.stopPropagation();
    await this.tasksService.updateStatus(task.id, 'アーカイブ済み');
    this.notificationService.show('アーカイブ完了', `「${task.title}」をアーカイブしました`);
  }

  // --- 削除 ---

  deleteTask(task: Task): void {
    if (!this.canMoveTask(task)) {
      this.notificationService.show('権限エラー', '他人のタスクは削除できません');
      return;
    }
    this.deletingTask = task;
    this.deletingChildCount = this.getChildren(task.id).length;
  }

  async confirmDelete(): Promise<void> {
    const task = this.deletingTask;
    if (!task) return;
    this.deletingTask = null;
    const shouldCloseCommentPanel = this.isTaskInDeleteTree(this.selectedTask()?.id, task.id);
    await this.tasksService.deleteTask(task.id);
    if (shouldCloseCommentPanel) this.closeCommentPanel();
    this.notificationService.show('削除完了', `「${task.title}」を削除しました`);
  }

  cancelDelete(): void {
    this.deletingTask = null;
  }

  openEditTask(task: Task, event?: Event): void {
    if (event) event.stopPropagation();
    this.editingTask = task;
    this.editTaskTitle = task.title;
    this.editTaskAssignee = task.assigneeId;
    this.editTaskHours = task.estimatedHours ?? 1;
    // 期限をdate input用の文字列に変換
    if (task.dueDate?.toDate) {
      const d = task.dueDate.toDate();
      this.editTaskDueDate = this.formatLocalDate(d);
    } else {
      this.editTaskDueDate = '';
    }
    this.editTaskPriority = task.priority ?? null;
    this.editTaskBlockedBy = [...(task.blockedBy ?? [])];
    this.editTaskDescription = task.description ?? '';
    this.editTaskRecurrence = task.recurrence ?? null;
    this.editTaskFocus = task.focusThisWeek ?? false;
    this.editTaskFocusHours = task.focusHours ?? task.estimatedHours ?? 0;
    if (task.targetWeekStart?.toDate) {
      this.editTaskTargetWeek = this.getTaskTargetWeekDate(task.targetWeekStart.toDate());
    } else {
      this.editTaskTargetWeek = null;
    }
  }

  // 依存関係の選択肢は、編集中のタスク自身を除く未完了の親タスクのみ
  availableBlockTargets(): Task[] {
    const editing = this.editingTask;
    if (!editing) return [];
    return this.tasksService
      .tasks()
      .filter((t) => t.parentId === null && t.id !== editing.id && t.status !== '完了');
  }

  toggleBlockedBy(taskId: string): void {
    const idx = this.editTaskBlockedBy.indexOf(taskId);
    if (idx >= 0) {
      this.editTaskBlockedBy.splice(idx, 1);
    } else {
      this.editTaskBlockedBy.push(taskId);
    }
  }

  isBlockedBySelected(taskId: string): boolean {
    return this.editTaskBlockedBy.includes(taskId);
  }

  getTargetWeekOptions(): { value: string; label: string; disabled: boolean }[] {
    const monday = getWeekMonday(new Date());
    const labels = this.forecastLabels;
    const dueDate = this.editTaskDueDate ? new Date(this.editTaskDueDate) : null;
    const options: { value: string; label: string; disabled: boolean }[] = [];
    for (let i = 0; i < 4; i++) {
      const weekStart = new Date(monday);
      weekStart.setDate(weekStart.getDate() + i * 7);
      const dateStr = this.formatLocalDate(weekStart);
      const disabled = dueDate !== null && weekStart > dueDate;
      options.push({ value: dateStr, label: labels[i], disabled });
    }
    return options;
  }

  private formatLocalDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private getTaskTargetWeekDate(targetWeek: Date): string {
    // Older selections stored local Monday as midnight UTC on the preceding Sunday.
    if (
      targetWeek.getUTCDay() === 0 &&
      targetWeek.getUTCHours() === 0 &&
      targetWeek.getUTCMinutes() === 0 &&
      targetWeek.getUTCSeconds() === 0
    ) {
      targetWeek.setDate(targetWeek.getDate() + 1);
    }
    return this.formatLocalDate(targetWeek);
  }

  getTargetWeekLabel(task: Task): string | null {
    if (!task.targetWeekStart?.toDate) return null;
    const targetWeek = new Date(this.getTaskTargetWeekDate(task.targetWeekStart.toDate()));
    if (getWeekMonday(targetWeek).getTime() === getWeekMonday(new Date()).getTime()) {
      return null;
    }
    return `予定：${targetWeek.getMonth() + 1}/${targetWeek.getDate()}週`;
  }

  get thisWeekValue(): string {
    return this.formatLocalDate(getWeekMonday(new Date()));
  }

  onEditTargetWeekChange(value: string | null): void {
    this.editTaskTargetWeek = value;
    if (value === this.thisWeekValue) {
      this.editTaskFocus = true;
    } else {
      this.editTaskFocus = false;
    }
  }

  onEditFocusChange(): void {
    this.editTaskFocus = !this.editTaskFocus;
    if (this.editTaskFocus) {
      this.editTaskTargetWeek = this.thisWeekValue;
    } else if (this.editTaskTargetWeek === this.thisWeekValue) {
      this.editTaskTargetWeek = null;
    }
  }

  onEditEstimatedHoursChange(hours: number): void {
    if (!Number.isFinite(hours)) return;
    this.editTaskHours = hours;
    this.editTaskFocusHours = Math.min(
      Math.max(0, this.editTaskFocusHours),
      Math.max(0, hours),
    );
  }

  onEditFocusHoursChange(hours: number): void {
    if (!Number.isFinite(hours)) return;
    this.editTaskFocusHours = Math.min(
      Math.max(0, hours),
      Math.max(0, this.editTaskHours),
    );
  }

  /** 子タスクの締切が親タスクの締切を超えていないかチェック */
  subtaskDueDateError(): string | null {
    if (!this.editingTask?.parentId || !this.editTaskDueDate) return null;
    const parent = this.tasksService.tasks().find((t) => t.id === this.editingTask!.parentId);
    if (!parent?.dueDate?.toDate) return null;
    const parentDate = parent.dueDate.toDate();
    const childDate = new Date(this.editTaskDueDate);
    if (childDate > parentDate) {
      return `親タスクの締切（${parentDate.getMonth() + 1}/${parentDate.getDate()}）を超えています`;
    }
    return null;
  }

  async confirmEditTask(): Promise<void> {
    if (!this.editingTask) return;
    if (!this.editTaskTitle.trim()) {
      this.notificationService.show('入力エラー', 'タスク名を入力してください');
      return;
    }
    const dueDateErr = this.subtaskDueDateError();
    if (dueDateErr) {
      this.notificationService.show('入力エラー', dueDateErr);
      return;
    }

    if (this.editTaskAssignee && this.editTaskFocus) {
      const assigneeChanged = this.editTaskAssignee !== this.editingTask.assigneeId;
      const hoursChanged = this.editTaskHours !== this.editingTask.estimatedHours;
      const focusHoursChanged = this.editTaskFocusHours !== this.editingTask.focusHours;
      const focusJustEnabled = !this.editingTask.focusThisWeek;
      if (assigneeChanged || hoursChanged || focusHoursChanged || focusJustEnabled) {
        const editHours = Math.min(
          this.editTaskFocusHours ?? this.editTaskHours ?? 0,
          this.editTaskHours,
        );
        const pct = this.getEditLoadPct(this.editTaskAssignee, editHours);
        if (pct >= 100) {
          const alt = this.suggestAlternative(this.editTaskAssignee);
          const candidates = this.getAlternativeCandidates(this.editTaskAssignee);
          this.pendingAdd = {
            kind: 'edit',
            name: this.getMemberName(this.editTaskAssignee),
            pct,
            altName: alt?.name ?? null,
            altUid: alt?.uid ?? null,
            altPct: alt?.pct ?? 0,
            candidates,
          };
          return;
        }
      }
    }

    await this.doEditTask();
  }

  private async doEditTask(): Promise<void> {
    if (!this.editingTask) return;
    const dueDate = this.editTaskDueDate
      ? Timestamp.fromDate(new Date(this.editTaskDueDate))
      : null;
    const taskTitle = this.editTaskTitle.trim();
    await this.tasksService.updateTask(this.editingTask.id, {
      title: taskTitle,
      description: this.editTaskDescription.trim(),
      assigneeId: this.editTaskAssignee,
      estimatedHours: this.editTaskHours,
      dueDate,
      priority: this.editTaskPriority,
      blockedBy: this.editTaskBlockedBy,
      focusThisWeek: this.editTaskFocus,
      focusHours: this.editTaskFocus ? this.editTaskFocusHours : null,
      targetWeekStart: this.editTaskTargetWeek
        ? Timestamp.fromDate(new Date(this.editTaskTargetWeek))
        : null,
      recurrence: this.editTaskRecurrence ?? null,
    });
    this.notificationService.show('更新完了', `「${taskTitle}」を更新しました`);
    this.editingTask = null;
  }

  cancelEditTask(): void {
    this.editingTask = null;
  }

  async saveEditingTaskAsTemplate(): Promise<void> {
    const task = this.editingTask;
    if (!task || task.parentId) return;
    const uid = this.auth.currentUser()?.uid;
    if (!uid) return;

    const subtasks = this.getChildren(task.id).map((sub) => ({
      title: sub.title,
      estimatedHours: sub.estimatedHours,
    }));

    await this.tasksService.createTemplate({
      title: task.title,
      description: task.description ?? '',
      priority: task.priority,
      estimatedHours: task.estimatedHours,
      subtasks,
      createdBy: uid,
    });

    this.notificationService.show('テンプレート保存', `「${task.title}」をテンプレートに追加しました`);
  }

  formatDueDate(timestamp: any): string {
    if (!timestamp?.toDate) return '';
    const d = timestamp.toDate();
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  dueDateStatus(task: Task): 'overdue' | 'today' | 'soon' | null {
    if (!task.dueDate?.toDate) return null;
    const due = task.dueDate.toDate();
    const now = new Date();

    // 日付だけで比較(時間は無視)
    const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

    if (dueDay < today) return 'overdue'; // 昨日以前 → 期限切れ
    if (dueDay.getTime() === today.getTime()) return 'today'; // 今日 → 今日が締切
    if (dueDay < new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000)) return 'soon'; // 3日以内
    return null;
  }

  priorityLabel(priority: Priority | null): string {
    switch (priority) {
      case 'high':
        return '🔴 高';
      case 'medium':
        return '🟡 中';
      case 'low':
        return '🟢 低';
      default:
        return '';
    }
  }

  recurrenceLabel(type: RecurrenceType | null): string {
    switch (type) {
      case 'daily': return '毎日';
      case 'weekly': return '毎週';
      case 'biweekly': return '隔週';
      case 'monthly': return '毎月';
      default: return '';
    }
  }

  openCommentPanel(task: Task, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    if (this.selectedTask()?.id === task.id) {
      this.closeCommentPanel();
      return;
    }
    this.selectedTask.set(task);
    this.router.navigate([], { queryParams: { taskId: task.id }, queryParamsHandling: 'merge' });
    this.scrollToTask(task.id);
  }

  private scrollToTask(taskId: string): void {
    requestAnimationFrame(() => {
      const el = document.getElementById(`task-${taskId}`);
      if (!el) return;
      const container = el.closest<HTMLElement>('.board-outer');
      if (!container) return;
      const elRect = el.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const bottomOverflow = elRect.bottom - containerRect.bottom;
      const topOverflow = containerRect.top - elRect.top;
      if (bottomOverflow > 0) {
        container.scrollBy({ top: bottomOverflow + 16, behavior: 'smooth' });
      } else if (topOverflow > 0) {
        container.scrollBy({ top: -(topOverflow + 16), behavior: 'smooth' });
      }
    });
  }

  toggleCompactTaskDetails(task: Task, event: MouseEvent): void {
    if (this.viewMode() !== 'compact') return;
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest('button, input, textarea, select, a, [cdkDragHandle]')
    ) {
      return;
    }

    event.stopPropagation();
    this.expandedCompactTaskId.update((id) => (id === task.id ? null : task.id));
  }

  closeCommentPanel(): void {
    if (!this.selectedTask()) return;
    this.selectedTask.set(null);
    this.router.navigate([], { queryParams: { taskId: null }, queryParamsHandling: 'merge' });
  }

  private isTaskInDeleteTree(taskId: string | undefined, deletedTaskId: string): boolean {
    if (!taskId) return false;
    const tasksById = new Map(this.tasksService.tasks().map((task) => [task.id, task]));
    const visited = new Set<string>();
    let currentId: string | null = taskId;

    while (currentId && !visited.has(currentId)) {
      if (currentId === deletedTaskId) return true;
      visited.add(currentId);
      currentId = tasksById.get(currentId)?.parentId ?? null;
    }
    return false;
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

  exportCsv(): void {
    const tasks = this.tasksService.tasks();
    const members = this.tasksService.members();
    const memberMap = new Map(members.map((m) => [m.uid, m.name]));
    const priorityMap: Record<string, string> = { high: '高', medium: '中', low: '低' };

    let filtered = tasks.filter((t) => t.parentId === null);
    if (this.filterAssignee()) filtered = filtered.filter((t) => t.assigneeId === this.filterAssignee());
    if (this.filterPriority()) filtered = filtered.filter((t) => t.priority === this.filterPriority());
    if (this.filterFocus()) filtered = filtered.filter((t) => t.focusThisWeek);
    const weekFilter = this.filterWeek();
    if (weekFilter !== null && !this.filterFocus()) {
      filtered = filtered.filter((t) => this.getTaskWeekIndex(t) === weekFilter);
    }
    const query = this.searchQuery().trim().toLowerCase();
    if (query) filtered = filtered.filter((t) => t.title.toLowerCase().includes(query));

    const allExport: Task[] = [];
    for (const root of filtered) {
      allExport.push(root);
      const children = tasks.filter((t) => t.parentId === root.id).sort((a, b) => a.order - b.order);
      allExport.push(...children);
    }

    const header = ['タスク名', 'ステータス', '担当者', '優先度', '見積もり(h)', '実績(h)', '締切日', '作成日', '親タスク'];
    const rows = allExport.map((t) => {
      const assignee = t.assigneeId ? (memberMap.get(t.assigneeId) ?? '') : '';
      const priority = t.priority ? (priorityMap[t.priority] ?? '') : '';
      const dueDate = t.dueDate?.toDate ? this.formatCsvDate(t.dueDate.toDate()) : '';
      const createdAt = t.createdAt?.toDate ? this.formatCsvDate(t.createdAt.toDate()) : '';
      const parentTitle = t.parentId ? (tasks.find((p) => p.id === t.parentId)?.title ?? '') : '';
      return [
        t.parentId ? `  ${t.title}` : t.title,
        t.status,
        assignee,
        priority,
        String(t.estimatedHours ?? ''),
        t.actualHours != null ? String(t.actualHours) : '',
        dueDate,
        createdAt,
        parentTitle,
      ];
    });

    const sanitize = (v: string) => /^[=+\-@\t\r]/.test(v) ? `\t${v}` : v;
    const escape = (v: string) => {
      const s = sanitize(v);
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = '﻿' + [header, ...rows].map((r) => r.map(escape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tasks_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private formatCsvDate(d: Date): string {
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
  }

  closeCommentPanelOnEmptyBoard(event: MouseEvent): void {
    if (!this.selectedTask() || !(event.target instanceof Element)) return;
    if (event.target.closest('.card, .col-head, .filter-bar, button, input, textarea, select, a')) {
      return;
    }
    this.closeCommentPanel();
  }
}
