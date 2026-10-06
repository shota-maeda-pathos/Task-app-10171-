import { calculateLoadPercent, formatWorkHours, UNKNOWN_LOAD } from '../../core/utils/load-display';
import { buildCalendarTimeOff, CalendarTimeOff } from '../../core/utils/calendar-time-off';
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
import { formatDateString, getForecastWeekLabels, getWeekMonday } from '../../core/utils/week-utils';

interface MemberStat {
  member: Member;
  completedCount: number;
  totalEstimated: number;
  totalActual: number;
  diff: number;
  accuracy: number | null;
  loadPct: number;
  focusHours: number;
  focusTaskCount: number;
  forecast: number[];
  forecastCounts: number[];
}

interface CalendarDay {
  date: Date;
  day: number;
  isToday: boolean;
  tasks: Task[];
  timeOff: CalendarTimeOff[];
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
  Math = Math;
  formatHours = formatWorkHours;
  loadPercent = calculateLoadPercent;
  forecastLabels = computed(() => getForecastWeekLabels());

  @HostListener('window:resize')
  onResize(): void {
    this.isMobile.set(window.innerWidth <= 768);
  }

  // チーム負荷の折りたたみ
  showOtherMembers = signal(false);
  showOtherForecast = signal(false);
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
  previewSubtasksOpen = false;

  openCalTask(task: Task): void {
    this.selectedCalTask = task;
    this.previewSubtasksOpen = false;
  }

  closeCalTask(): void {
    this.selectedCalTask = null;
  }

  goToTask(taskId: string): void {
    this.selectedCalTask = null;
    this.router.navigate(['/board'], { queryParams: { taskId } });
  }

  // 完了タスク一覧(実績時間があるもの・親タスクのみ、アーカイブ含む)
  completedTasks = computed(() =>
    this.tasksService.tasks().filter((t) => (t.status === '完了' || t.status === 'アーカイブ済み') && t.actualHours !== null && t.parentId === null),
  );

  isCurrentUser(uid: string): boolean {
    return this.auth.currentUser()?.uid === uid;
  }

  // メンバーごとの統計
  memberStats = computed(() => {
    const uid = this.auth.currentUser()?.uid;
    this.memberOrderVersion();
    const now = Date.now();
    const fourWeeksAgo = now - 28 * 24 * 60 * 60 * 1000;

    const stats = this.tasksService.members().map((m) => {
      const myCompleted = this.completedTasks().filter((t) => t.assigneeId === m.uid);
      const totalEstimated = myCompleted.reduce((sum, t) => sum + (t.estimatedHours ?? 0), 0);
      const totalActual = myCompleted.reduce((sum, t) => sum + (t.actualHours ?? 0), 0);
      const diff = totalActual - totalEstimated;

      let accuracyEstimated = 0;
      let accuracyError = 0;
      for (const t of myCompleted) {
        if (t.estimatedHours <= 0 || t.actualHours === null || !Number.isFinite(t.actualHours)) continue;
        const completedAt = t.statusUpdatedAt?.toDate?.()?.getTime() ?? 0;
        if (completedAt < fourWeeksAgo || completedAt > now) continue;
        accuracyEstimated += t.estimatedHours;
        accuracyError += Math.abs(t.actualHours - t.estimatedHours);
      }
      const accuracy = accuracyEstimated > 0
        ? Math.round(Math.max(0, 1 - accuracyError / accuracyEstimated) * 100)
        : null;

      return {
        member: m,
        completedCount: myCompleted.length,
        totalEstimated,
        totalActual,
        diff,
        accuracy,
        loadPct: this.tasksService.getFocusLoadPercent(m.uid),
        focusHours: this.tasksService.getMemberFocusHours(m.uid),
        focusTaskCount: this.tasksService.getMemberFocusTaskCount(m.uid),
        forecast: this.tasksService.getMemberWeeklyHours(m.uid),
        forecastCounts: this.tasksService.getMemberWeeklyTaskCounts(m.uid),
      };
    });

    return sortMembersBySavedOrder(
      stats,
      uid ?? null,
      (stat) => stat.member.uid,
      (a, b) => b.loadPct - a.loadPct,
    );
  });

  // 今週完了したタスク数（月曜始まりのカレンダー週）
  weeklyCompleted = computed(() => {
    const weekStart = getWeekMonday(new Date()).getTime();
    return this.completedTasks().filter((t) => {
      if (!t.statusUpdatedAt?.toDate) return false;
      return t.statusUpdatedAt.toDate().getTime() >= weekStart;
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
  archiveDisplayLimit = signal(10);
  displayedArchiveTasks = computed(() => this.archivedTasks().slice(0, this.archiveDisplayLimit()));
  archiveCollapsed = (() => {
    try { return localStorage.getItem('archiveCollapsed') === 'true'; } catch { return false; }
  })();
  progressPct = computed(() =>
    this.totalTasks() > 0 ? Math.round((this.doneTasks() / this.totalTasks()) * 100) : 0,
  );

  toggleArchiveCollapsed(): void {
    this.archiveCollapsed = !this.archiveCollapsed;
    try { localStorage.setItem('archiveCollapsed', String(this.archiveCollapsed)); } catch {}
  }

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

  getSubtasks(taskId: string): Task[] {
    return this.tasksService.tasks().filter(t => t.parentId === taskId);
  }

  formatDueDate(task: Task): string {
    if (!task.dueDate?.toDate) return '未設定';
    const d = task.dueDate.toDate();
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  }

  // 過去4週間の完了タスク推移
  weeklyCompletionData = computed(() => {
    const weeks = [];
    const currentMonday = getWeekMonday(new Date());

    for (let i = 3; i >= 0; i--) {
      const weekStart = new Date(currentMonday);
      weekStart.setDate(weekStart.getDate() - i * 7);
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

  selectedTimeOffDay = signal<CalendarDay | null>(null);

  readonly isCalendarHoliday = (entry: CalendarTimeOff) => entry.kind === 'holiday';

  calendarMonths = computed(() => {
    const now = new Date();
    const timeOff = buildCalendarTimeOff(this.tasksService.teamSettings()?.holidays ?? [], this.tasksService.members());
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
          if (t.status === '完了' || t.status === 'アーカイブ済み' || !t.dueDate?.toDate) return false;
          const due = t.dueDate.toDate();
          return due.getFullYear() === year && due.getMonth() === month && due.getDate() === d;
        });
        days.push({ date, day: d, isToday, tasks, timeOff: timeOff.get(formatDateString(date)) ?? [] });
      }

      months.push({ label: `${year}年${month + 1}月`, days });
    }

    return months;
  });

  async moveTaskDueDate(task: Task, date: Date): Promise<void> {
    if (!this.canEditTask(task)) {
      this.notificationService.show('権限エラー', '自分が担当または作成したタスクのみ変更できます');
      return;
    }
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

  canEditTask(task: Task): boolean {
    const uid = this.auth.currentUser()?.uid;
    if (!uid) return false;
    const member = this.tasksService.members().find((m) => m.uid === uid);
    if (member?.role === 'manager') return true;
    return task.assigneeId === uid || task.createdBy === uid;
  }

  async restoreTask(task: Task): Promise<void> {
    await this.tasksService.updateStatus(task.id, '完了');
    this.notificationService.show('復元完了', `「${task.title}」をボードに戻しました`);
  }

  deletingTask: Task | null = null;
  deleteInProgress = signal(false);

  openDeleteTask(task: Task): void {
    if (!this.tasksService.canDeleteTask(task)) return;
    this.deletingTask = task;
  }

  cancelDeleteTask(): void {
    if (this.deleteInProgress()) return;
    this.deletingTask = null;
  }

  async confirmDeleteTask(): Promise<void> {
    if (!this.deletingTask || this.deleteInProgress()) return;
    const task = this.deletingTask;
    this.deleteInProgress.set(true);
    try {
      const result = await this.tasksService.deleteTask(task.id);
      this.deletingTask = null;
      this.notificationService.show('削除完了', `「${task.title}」を削除しました${result.cleanupPending ? '。添付ファイルの削除は自動で再試行します' : ''}`);
    } catch (e) {
      console.error('タスク削除エラー:', e);
      this.notificationService.show('エラー', (e as Error).message || 'タスクの削除に失敗しました');
    } finally {
      this.deleteInProgress.set(false);
    }
  }

  exportArchivedCsv(): void {
    const archived = this.archivedTasks();
    const allTasks = this.tasksService.tasks();
    const members = this.tasksService.members();
    const memberMap = new Map(members.map((m) => [m.uid, m.name]));
    const priorityMap: Record<string, string> = { high: '高', medium: '中', low: '低' };
    const fmtDate = (ts: any) => ts?.toDate ? `${ts.toDate().getFullYear()}/${String(ts.toDate().getMonth() + 1).padStart(2, '0')}/${String(ts.toDate().getDate()).padStart(2, '0')}` : '';

    const allExport: Task[] = [];
    for (const root of archived.filter((t) => t.parentId === null)) {
      allExport.push(root);
      const children = allTasks.filter((t) => t.parentId === root.id).sort((a, b) => a.order - b.order);
      allExport.push(...children);
    }

    const header = ['タスク名', 'ステータス', '担当者', '優先度', '見積もり(h)', '実績(h)', '締切日', '作成日', '親タスク'];
    const rows = allExport.map((t) => {
      const assignee = t.assigneeId ? (memberMap.get(t.assigneeId) ?? '') : '';
      const priority = t.priority ? (priorityMap[t.priority] ?? '') : '';
      const parentTitle = t.parentId ? (allTasks.find((p) => p.id === t.parentId)?.title ?? '') : '';
      return [
        t.parentId ? `  ${t.title}` : t.title,
        t.status,
        assignee,
        priority,
        String(t.estimatedHours ?? ''),
        t.actualHours != null ? String(t.actualHours) : '',
        fmtDate(t.dueDate),
        fmtDate(t.createdAt),
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
    a.download = `archived_tasks_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
