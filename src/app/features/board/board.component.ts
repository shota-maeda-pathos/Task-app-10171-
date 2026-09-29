import { Component, DestroyRef, HostListener, inject, computed, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { ActivatedRoute, Router } from '@angular/router';
import { TasksService } from '../../core/services/tasks.service';
import { AuthService } from '../../core/services/auth.service';
import { NotificationService } from '../../core/services/notification.service';
import { CommentPanelComponent } from './comment-panel/comment-panel';
import { Task, TaskStatus, Member, Priority } from '../../core/models/task.model';
import { Timestamp } from '@angular/fire/firestore';
import { saveMemberOrder, sortMembersBySavedOrder } from '../../core/utils/member-order';

type LoadLevel = 'ok' | 'warn' | 'danger';

interface PendingAdd {
  kind: 'root' | 'sub';
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
  private destroyRef = inject(DestroyRef);

  columns: TaskStatus[] = ['未着手', '進行中', '完了'];
  connectedLists = this.columns.map((s) => 'col-' + s);

  openEpicId: string | null = null;
  newSubtaskTitle = '';
  newSubtaskAssignee: string | null = null;
  newSubtaskHours: number | null = null;

  showFilters = false;
  showSortMenu = false;
  showSwimlaneMenu = false;

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
  }

  clearFilters(): void {
    this.filterAssignee.set(null);
    this.filterPriority.set(null);
    this.searchQuery.set('');
    this.sortBy.set('none');
    this.showSortMenu = false;
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
  newSubtaskPriority: Priority | null = null;
  editTaskPriority: Priority | null = null;
  editTaskBlockedBy: string[] = [];
  editTaskDescription = '';

  newRootDescription = '';
  newSubtaskDescription = '';

  filterAssignee = signal<string | null>(null);
  filterPriority = signal<Priority | null>(null);

  searchQuery = signal('');

  selectedTask = signal<Task | null>(null);
  expandedCompactTaskId = signal<string | null>(null);
  expandedSubtaskIds = signal<Set<string>>(new Set());
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
      (a, b) => this.tasksService.getLoadPercent(b.uid) - this.tasksService.getLoadPercent(a.uid),
    );
  });

  draggableSidebarMembers = computed(() => this.sortedMembers().slice(1));

  route = inject(ActivatedRoute);
  router = inject(Router);
  private lastAssigneeQueryParam: string | null | undefined;

  constructor() {
    effect(() => {
      const uid = this.auth.currentUser()?.uid;
      this.viewMode.set(
        this.readUserPreference(uid, 'boardViewMode', ['detail', 'compact'], 'detail'),
      );
      this.swimlaneMode.set(
        this.readUserPreference(
          uid,
          'boardSwimlane',
          ['none', 'assignee', 'priority'],
          'none',
        ),
      );
      this.sidebarCollapsed.set(
        this.readUserPreference(uid, 'sidebarCollapsed', ['true', 'false'], 'false') === 'true',
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
    preference: 'boardViewMode' | 'boardSwimlane' | 'sidebarCollapsed',
    allowedValues: readonly T[],
    fallback: T,
  ): T {
    if (!uid) return fallback;

    const value = localStorage.getItem(`${preference}:${uid}`);
    return allowedValues.find((candidate) => candidate === value) ?? fallback;
  }

  private saveUserPreference(
    preference: 'boardViewMode' | 'boardSwimlane' | 'sidebarCollapsed',
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
    }
    return grouped;
  });

  getChildren(epicId: string): Task[] {
    return this.tasksService.tasks().filter((t) => t.parentId === epicId);
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

    let totalHours = this.tasksService.getMemberActiveHours(memberId);

    // ① 新規タスク（親）を追加しようとしている場合
    if (this.newRootColumn && this.newRootAssignee === memberId) {
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
      .map((m) => ({ uid: m.uid, name: m.name, pct: this.tasksService.getLoadPercent(m.uid) }))
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
      const list = [...event.container.data];
      moveItemInArray(list, event.previousIndex, event.currentIndex);
      // order を更新して並び順を保存
      const now = Date.now();
      for (let i = 0; i < list.length; i++) {
        const newOrder = now + i;
        if (list[i].order !== newOrder) {
          await this.tasksService.updateTask(list[i].id, { order: newOrder });
        }
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

  // --- ルートタスク追加 ---

  toggleAddRoot(status: TaskStatus): void {
    if (this.newRootColumn === status) {
      this.newRootColumn = null;
    } else {
      this.newRootColumn = status;
      this.newRootTitle = '';
      this.newRootDescription = '';
      this.newRootAssignee = null;
      this.newRootHours = 1;
      this.addRootError = '';
    }
  }

  async confirmAddRoot(status: TaskStatus): Promise<void> {
    const title = this.newRootTitle.trim();
    if (!title) {
      this.addRootError = 'タスク名を入力してください';
      return;
    }
    this.addRootError = '';

    if (this.newRootAssignee) {
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
    await this.tasksService.createTask({
      title,
      description,
      parentId: null,
      assigneeId: assignee,
      createdBy: this.auth.currentUser()?.uid ?? null,
      estimatedHours: hours,
      dueDate: dueDate ? Timestamp.fromDate(dueDate) : null,
      status,
      priority: this.newRootPriority,
    });
    this.newRootPriority = null;
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
      this.addSubtaskError = '';
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
    await this.tasksService.createTask({
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
  }

  // --- 負荷警告モーダル ---

  async proceedPendingAdd(): Promise<void> {
    const p = this.pendingAdd;
    if (!p) return;
    if (p.kind === 'root' && p.status) {
      await this.doAddRoot(p.status);
    } else if (p.kind === 'sub' && p.epicId) {
      await this.doAddSubtask(p.epicId);
    }
  }

  switchToAlternative(uid?: string): void {
    const p = this.pendingAdd;
    if (!p) return;
    const targetUid = uid ?? p.altUid;
    if (!targetUid) return;
    if (p.kind === 'root') {
      this.newRootAssignee = targetUid;
    } else {
      this.newSubtaskAssignee = targetUid;
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
    // 見積もりが0または未設定のタスクはモーダルをスキップして即完了
    if (!task.estimatedHours) {
      this.tasksService.completeTask(task.id, 0);
      return;
    }
    this.completingTask = task;
    this.actualHoursInput = task.estimatedHours;
  }

  async confirmComplete(): Promise<void> {
    const task = this.completingTask;
    if (!task) return;
    const hours = this.actualHoursInput;
    this.completingTask = null;
    await this.tasksService.completeTask(task.id, hours);
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
    if (!task || !reason) return;
    this.reviewingTask = null;
    await this.tasksService.requestReview(task.id, reason);
  }

  cancelReview(): void {
    this.reviewingTask = null;
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
    await this.tasksService.deleteTask(task.id);
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
      this.editTaskDueDate = d.toISOString().split('T')[0];
    } else {
      this.editTaskDueDate = '';
    }
    this.editTaskPriority = task.priority ?? null;
    this.editTaskBlockedBy = [...(task.blockedBy ?? [])];
    this.editTaskDescription = task.description ?? '';
  }

  // 依存関係の選択肢（編集中のタスク自身と、その子タスクは除外）
  availableBlockTargets(): Task[] {
    const editing = this.editingTask;
    if (!editing) return [];
    return this.tasksService
      .tasks()
      .filter((t) => t.id !== editing.id && t.parentId !== editing.id && t.status !== '完了');
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
    if (!this.editingTask || !this.editTaskTitle.trim()) return;
    if (this.subtaskDueDateError()) return;
    const dueDate = this.editTaskDueDate
      ? Timestamp.fromDate(new Date(this.editTaskDueDate))
      : null;
    await this.tasksService.updateTask(this.editingTask.id, {
      title: this.editTaskTitle.trim(),
      description: this.editTaskDescription.trim(),
      assigneeId: this.editTaskAssignee,
      estimatedHours: this.editTaskHours,
      dueDate,
      priority: this.editTaskPriority,
      blockedBy: this.editTaskBlockedBy,
    });
    this.editingTask = null;
  }

  cancelEditTask(): void {
    this.editingTask = null;
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

  openCommentPanel(task: Task, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    if (this.selectedTask()?.id === task.id) {
      this.closeCommentPanel();
      return;
    }
    this.selectedTask.set(task);
    this.router.navigate([], { queryParams: { taskId: task.id }, queryParamsHandling: 'merge' });
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
}
