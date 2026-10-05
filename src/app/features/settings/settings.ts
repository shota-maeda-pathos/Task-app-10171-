import { leavePeriodLabel, totalLeaveDays } from '../../core/utils/leave-utils';
import { Component, HostListener, inject, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { TasksService } from '../../core/services/tasks.service';
import { AuthService } from '../../core/services/auth.service';
import { Member, Priority, TaskTemplate, MemberLeave, LeavePeriod } from '../../core/models/task.model';
import { NotificationService } from '../../core/services/notification.service';
import { saveMemberOrder, sortMembersBySavedOrder } from '../../core/utils/member-order';
import { expandWeekdayRange } from '../../core/utils/week-utils';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, DragDropModule],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class SettingsComponent {
  tasksService = inject(TasksService);
  auth = inject(AuthService);
  notificationService = inject(NotificationService);

  readonly THEMES = [
    { id: '', label: 'Default', color: '#4c5fd5', headerBg: '#1e2430' },
    { id: 'ocean', label: 'Ocean Breeze', color: '#0ea5e9', headerBg: '#0f172a' },
    { id: 'sunset', label: 'Sunset Warm', color: '#f97316', headerBg: '#292524' },
    { id: 'lavender', label: 'Lavender Night', color: '#8b5cf6', headerBg: '#4c1d95' },
    { id: 'midnight', label: 'Midnight Blue', color: '#3b82f6', headerBg: '#1e3a5f' },
    { id: 'forest', label: 'Forest', color: '#16a34a', headerBg: '#14532d' },
    { id: 'rose', label: 'Rose', color: '#e11d48', headerBg: '#881337' },
    { id: 'noir', label: 'Noir', color: '#a78bfa', headerBg: '#09090b' },
    { id: 'candy', label: 'Candy Pop', color: '#ec4899', headerBg: '#7c3aed' },
  ];

  currentTheme = computed(() => {
    const uid = this.auth.currentUser()?.uid;
    if (!uid) return '';
    const member = this.tasksService.members().find((m) => m.uid === uid);
    return member?.theme ?? '';
  });

  isManager = computed(() => {
    const uid = this.auth.currentUser()?.uid;
    if (!uid) return false;
    const member = this.tasksService.members().find((m) => m.uid === uid);
    return member?.role === 'manager';
  });

  async selectTheme(themeId: string): Promise<void> {
    const uid = this.auth.currentUser()?.uid;
    if (!uid) return;
    try {
      await this.tasksService.updateMemberTheme(uid, themeId);
      this.notificationService.show('テーマ変更', 'テーマを変更しました');
    } catch (e) {
      console.error('テーマ変更エラー:', e);
      this.notificationService.show('エラー', 'テーマの変更に失敗しました');
    }
  }

  sortedMembers = computed(() => {
    const uid = this.auth.currentUser()?.uid;
    const members = this.tasksService.members();
    this.memberOrderVersion();
    return sortMembersBySavedOrder(
      members,
      uid ?? null,
      (member) => member.uid,
      (a, b) => this.tasksService.getFocusLoadPercent(b.uid) - this.tasksService.getFocusLoadPercent(a.uid),
    );
  });

  pinnedMember = computed(() => {
    const uid = this.auth.currentUser()?.uid;
    return this.sortedMembers().find((member) => member.uid === uid) ?? null;
  });

  draggableMembers = computed(() => {
    const uid = this.auth.currentUser()?.uid;
    return this.sortedMembers().filter((member) => member.uid !== uid);
  });
  private memberOrderVersion = signal(0);

  reorderMembers(event: CdkDragDrop<Member[]>): void {
    const uid = this.auth.currentUser()?.uid;
    if (!uid) return;

    const members = [...this.draggableMembers()];
    if (
      event.previousIndex < 0 ||
      event.currentIndex < 0 ||
      event.previousIndex >= members.length ||
      event.currentIndex >= members.length
    ) {
      return;
    }

    moveItemInArray(members, event.previousIndex, event.currentIndex);
    saveMemberOrder(uid, members);
    this.memberOrderVersion.update((version) => version + 1);
  }

  showThemePicker = false;

  toggleThemePicker(): void {
    this.showThemePicker = !this.showThemePicker;
  }

  currentThemeLabel = computed(() => {
    const id = this.currentTheme();
    const found = this.THEMES.find((t) => t.id === id);
    return found?.label ?? 'Default';
  });

  currentThemeColor = computed(() => {
    const id = this.currentTheme();
    const found = this.THEMES.find((t) => t.id === id);
    return found?.color ?? '#4c5fd5';
  });

  editingMember: Member | null = null;
  editCapacity = 40;
  editRole: 'manager' | 'member' = 'member';

  deletingMember: Member | null = null;

  isCurrentUser(uid: string): boolean {
    return this.auth.currentUser()?.uid === uid;
  }

  openEdit(member: Member): void {
    this.editingMember = member;
    this.editCapacity = member.weeklyCapacityHours;
    this.editRole = member.role;
  }

  async confirmEdit(newName: string): Promise<void> {
    const member = this.editingMember;
    if (!member) return;
    try {
      await this.tasksService.updateMemberBatch(member.uid, {
        role: this.editRole,
        name: newName?.trim() || member.name,
        weeklyCapacityHours: this.editCapacity,
      });
      this.notificationService.show('更新完了', 'メンバー情報を更新しました');
    } catch (e) {
      console.error('メンバー更新エラー:', e);
      this.notificationService.show('エラー', 'メンバー情報の更新に失敗しました');
    }
    this.editingMember = null;
  }

  cancelEdit(): void {
    this.editingMember = null;
  }

  openDelete(member: Member): void {
    this.deletingMember = member;
  }

  async confirmDelete(): Promise<void> {
    if (!this.deletingMember) return;
    const member = this.deletingMember;
    this.deletingMember = null;
    try {
      await this.tasksService.deleteMember(member.uid);
      this.notificationService.show('削除完了', `${member.name}さんを削除しました`);
    } catch (e) {
      console.error('メンバー削除エラー:', e);
      this.notificationService.show('エラー', 'メンバーの削除に失敗しました');
    }
  }

  cancelDelete(): void {
    this.deletingMember = null;
  }

  // クラス内のプロパティとして以下を追加します
  myProfile = computed(() =>
    this.tasksService.members().find((m) => m.uid === this.auth.currentUser()?.uid),
  );

  // クラス内のメソッドとして以下を追加します
  async updateName(newName: string): Promise<void> {
    const uid = this.auth.currentUser()?.uid;
    if (!uid) return;
    if (!newName.trim()) {
      this.notificationService.show('入力エラー', '表示名を入力してください');
      return;
    }
    try {
      await this.tasksService.updateMemberName(uid, newName.trim());
      this.notificationService.show('更新完了', '表示名を変更しました');
    } catch (e) {
      console.error('表示名更新エラー:', e);
      this.notificationService.show('エラー', '表示名の更新に失敗しました');
    }
  }

  async updateCapacity(hours: number): Promise<void> {
    const uid = this.auth.currentUser()?.uid;
    if (!uid) return;
    if (!hours || hours < 1) {
      this.notificationService.show('入力エラー', '稼働時間は1時間以上で入力してください');
      return;
    }
    try {
      await this.tasksService.updateMemberCapacity(uid, hours);
      this.notificationService.show('更新完了', '稼働時間を変更しました');
    } catch (e) {
      console.error('稼働時間更新エラー:', e);
      this.notificationService.show('エラー', '稼働時間の更新に失敗しました');
    }
  }

  // --- 祝日・休暇 ---

  teamHolidays = computed(() =>
    [...(this.tasksService.teamSettings()?.holidays ?? [])].sort((a, b) => a.date.localeCompare(b.date)),
  );

  myLeaves = computed(() => {
    const uid = this.auth.currentUser()?.uid;
    if (!uid) return [];
    const member = this.tasksService.members().find((m) => m.uid === uid);
    return [...(member?.leaves ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  });

  otherMembers = computed(() => {
    const uid = this.auth.currentUser()?.uid;
    return this.tasksService.members().filter((m) => m.uid !== uid);
  });

  expandedMemberLeaves = signal<ReadonlySet<string>>(new Set());

  toggleMemberLeaves(uid: string): void {
    this.expandedMemberLeaves.update(current => {
      const expanded = new Set(current);
      if (expanded.has(uid)) expanded.delete(uid);
      else expanded.add(uid);
      return expanded;
    });
  }

  readonly holidayCurrentYear = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', year: 'numeric' }).format(new Date()));
  readonly holidayImportYears = [this.holidayCurrentYear - 1, this.holidayCurrentYear, this.holidayCurrentYear + 1];
  holidayImportYear = this.holidayCurrentYear;
  importingHolidays = signal(false);

  async importJapaneseHolidays(): Promise<void> {
    if (!this.isManager() || this.importingHolidays()) return;
    const year = Number(this.holidayImportYear);
    if (!this.holidayImportYears.includes(year)) return;
    this.importingHolidays.set(true);
    try {
      const response = await fetch('https://holidays-jp.github.io/api/v1/date.json', {
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error('祝日データの取得に失敗しました');
      const data: unknown = await response.json();
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('祝日データの形式が不正です');
      const holidays = Object.entries(data).filter(([date]) => date.startsWith(year + '-')).map(([date, name]) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || typeof name !== 'string' || !name.trim()
          || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
          throw new Error('祝日データの形式が不正です');
        }
        return { date, name: name.trim() };
      });
      if (holidays.length === 0) throw new Error(year + '年の祝日データは公開されていません');
      const count = await this.tasksService.addHolidays(holidays);
      this.notificationService.show('祝日の一括登録', count ? year + '年の祝日を' + count + '日追加しました' : year + '年の祝日はすべて登録済みです');
    } catch (error) {
      console.error('祝日一括登録エラー:', error);
      this.notificationService.show('エラー', '祝日を一括登録できませんでした。通信状況やデータの公開状況を確認して再試行してください。');
    } finally {
      this.importingHolidays.set(false);
    }
  }

  teamHolidaysExpanded = signal(false);
  myLeavesExpanded = signal(false);

  holidayEditorOpen = signal(false);
  leaveEditorOpen = signal(false);

  newHolidayDate = '';
  newHolidayName = '';
  newLeaveStartDate = '';
  newLeaveEndDate = '';
  newLeaveLabel = '有給';
  newLeavePeriod: LeavePeriod = 'full';
  leavePeriodMenu = signal<string | null>(null);
  readonly leavePeriodOptions: { value: LeavePeriod; label: string }[] = [
    { value: 'full', label: '全日' }, { value: 'am', label: '午前休' }, { value: 'pm', label: '午後休' },
  ];
  periodName(period: LeavePeriod): string {
    return this.leavePeriodOptions.find(option => option.value === period)?.label ?? '全日';
  }
  selectLeavePeriod(target: string, period: LeavePeriod): void {
    if (target === 'own') this.newLeavePeriod = period;
    else this.memberLeavePeriod = period;
    this.leavePeriodMenu.set(null);
  }
  @HostListener('document:click', ['$event'])
  closeLeavePeriodMenu(event: MouseEvent): void {
    if (!(event.target instanceof Element) || !event.target.closest('.leave-period-menu')) this.leavePeriodMenu.set(null);
  }
  @HostListener('document:keydown.escape')
  dismissLeavePeriodMenu(): void { this.leavePeriodMenu.set(null); }
  readonly leavePeriodLabel = leavePeriodLabel;
  myLeaveDays = computed(() => totalLeaveDays(this.myLeaves()));

  getMemberLeaveDays(uid: string): number {
    return totalLeaveDays(this.getMemberLeaves(uid));
  }
  addMemberLeaveTarget: string | null = null;
  memberLeaveStartDate = '';
  memberLeaveEndDate = '';
  memberLeaveLabel = '有給';
  memberLeavePeriod: LeavePeriod = 'full';

  formatHolidayDate(dateStr: string): string {
    const d = new Date(dateStr + 'T00:00:00');
    return `${d.getMonth() + 1}/${d.getDate()}（${'日月火水木金土'[d.getDay()]}）`;
  }

  getMemberLeaves(uid: string): MemberLeave[] {
    const member = this.tasksService.members().find((m) => m.uid === uid);
    return [...(member?.leaves ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  }

  async addHoliday(): Promise<void> {
    if (!this.newHolidayDate || !this.newHolidayName.trim()) return;
    try {
      await this.tasksService.addHoliday({ date: this.newHolidayDate, name: this.newHolidayName.trim() });
      this.newHolidayDate = '';
      this.newHolidayName = '';
      this.notificationService.show('追加完了', '祝日を追加しました');
    } catch (e) {
      console.error('祝日追加エラー:', e);
      this.notificationService.show('エラー', '祝日の追加に失敗しました');
    }
  }

  async removeHoliday(date: string): Promise<void> {
    try {
      await this.tasksService.removeHoliday(date);
    } catch (e) {
      console.error('祝日削除エラー:', e);
    }
  }

  async addMyLeave(): Promise<void> {
    const start = this.newLeaveStartDate;
    if (!start) return;
    const end = this.newLeaveEndDate || start;
    if (this.newLeavePeriod !== 'full' && end !== start) {
      this.notificationService.show('入力エラー', '半休は開始日と終了日を同じ日にしてください');
      return;
    }
    const label = this.newLeaveLabel.trim() || '休暇';
    const uid = this.auth.currentUser()?.uid;
    if (!uid) return;
    const dates = expandWeekdayRange(start, end);
    if (dates.length === 0) {
      this.notificationService.show('入力エラー', '開始日・終了日を確認し、平日を含む期間を指定してください');
      return;
    }
    try {
      await this.tasksService.addLeave(uid, dates.map((d) => ({ date: d, label, ...(this.newLeavePeriod === 'full' ? {} : { period: this.newLeavePeriod }) })));
      this.newLeaveStartDate = '';
      this.newLeaveEndDate = '';
      this.newLeaveLabel = '有給';
      this.newLeavePeriod = 'full';
      this.notificationService.show('追加完了', '休暇を追加しました');
    } catch (e) {
      console.error('休暇追加エラー:', e);
      this.notificationService.show('エラー', '休暇の追加に失敗しました');
    }
  }

  async removeMyLeave(date: string): Promise<void> {
    const uid = this.auth.currentUser()?.uid;
    if (!uid) return;
    try {
      await this.tasksService.removeLeave(uid, date);
    } catch (e) {
      console.error('休暇削除エラー:', e);
    }
  }

  openAddMemberLeave(uid: string): void {
    this.addMemberLeaveTarget = uid;
    this.memberLeaveStartDate = '';
    this.memberLeaveEndDate = '';
    this.memberLeaveLabel = '有給';
    this.memberLeavePeriod = 'full';
  }

  async addMemberLeave(): Promise<void> {
    const uid = this.addMemberLeaveTarget;
    if (!uid || !this.memberLeaveStartDate) return;
    const end = this.memberLeaveEndDate || this.memberLeaveStartDate;
    if (this.memberLeavePeriod !== 'full' && end !== this.memberLeaveStartDate) {
      this.notificationService.show('入力エラー', '半休は開始日と終了日を同じ日にしてください');
      return;
    }
    const label = this.memberLeaveLabel.trim() || '休暇';
    const dates = expandWeekdayRange(this.memberLeaveStartDate, end);
    if (dates.length === 0) return;
    try {
      await this.tasksService.addLeave(uid, dates.map((d) => ({ date: d, label, ...(this.memberLeavePeriod === 'full' ? {} : { period: this.memberLeavePeriod }) })));
      this.addMemberLeaveTarget = null;
      this.notificationService.show('追加完了', '休暇を追加しました');
    } catch (e) {
      console.error('休暇追加エラー:', e);
      this.notificationService.show('エラー', '休暇の追加に失敗しました');
    }
  }

  async removeMemberLeave(uid: string, date: string): Promise<void> {
    try {
      await this.tasksService.removeLeave(uid, date);
    } catch (e) {
      console.error('休暇削除エラー:', e);
    }
  }

  // --- テンプレート ---

  templates = computed(() => this.tasksService.templates());
  templateDisplayLimit = signal(10);
  displayedTemplates = computed(() => this.templates().slice(0, this.templateDisplayLimit()));

  templateFormOpen = false;
  editingTemplate: TaskTemplate | null = null;
  deletingTemplate: TaskTemplate | null = null;

  tplTitle = '';
  tplDescription = '';
  tplPriority: Priority | null = null;
  tplHours = 0;
  tplAssigneeId: string | null = null;
  tplSubtasks: { title: string; estimatedHours: number }[] = [];

  priorityLabel(p: Priority): string {
    return { high: '高', medium: '中', low: '低' }[p];
  }

  memberName(uid: string | null): string {
    if (!uid) return '';
    return this.tasksService.members().find(m => m.uid === uid)?.name ?? '';
  }

  openAddTemplate(): void {
    this.editingTemplate = null;
    this.tplTitle = '';
    this.tplDescription = '';
    this.tplPriority = null;
    this.tplHours = 0;
    this.tplAssigneeId = null;
    this.tplSubtasks = [];
    this.templateFormOpen = true;
  }

  openEditTemplate(tpl: TaskTemplate): void {
    this.editingTemplate = tpl;
    this.tplTitle = tpl.title;
    this.tplDescription = tpl.description;
    this.tplPriority = tpl.priority;
    this.tplHours = tpl.estimatedHours;
    this.tplAssigneeId = tpl.assigneeId ?? null;
    this.tplSubtasks = tpl.subtasks.map(s => ({ ...s }));
    this.templateFormOpen = true;
  }

  cancelTemplateForm(): void {
    this.templateFormOpen = false;
    this.editingTemplate = null;
  }

  addSubtask(): void {
    this.tplSubtasks.push({ title: '', estimatedHours: 0 });
  }

  removeSubtask(index: number): void {
    this.tplSubtasks.splice(index, 1);
  }

  async saveTemplate(): Promise<void> {
    const uid = this.auth.currentUser()?.uid;
    if (!uid) return;
    if (!this.tplTitle.trim()) {
      this.notificationService.show('入力エラー', 'タスクタイトルを入力してください');
      return;
    }

    const data = {
      title: this.tplTitle.trim(),
      description: this.tplDescription.trim(),
      priority: this.tplPriority,
      estimatedHours: this.tplHours || 0,
      assigneeId: this.tplAssigneeId,
      subtasks: this.tplSubtasks.filter(s => s.title.trim()),
      createdBy: uid,
    };

    try {
      if (this.editingTemplate) {
        await this.tasksService.updateTemplate(this.editingTemplate.id, data);
        this.notificationService.show('更新完了', 'テンプレートを更新しました');
      } else {
        await this.tasksService.createTemplate(data);
        this.notificationService.show('追加完了', 'テンプレートを追加しました');
      }
    } catch (e) {
      console.error('テンプレート保存エラー:', e);
      this.notificationService.show('エラー', 'テンプレートの保存に失敗しました');
    }

    this.templateFormOpen = false;
    this.editingTemplate = null;
  }

  openDeleteTemplate(tpl: TaskTemplate): void {
    this.deletingTemplate = tpl;
  }

  async confirmDeleteTemplate(): Promise<void> {
    if (!this.deletingTemplate) return;
    const tpl = this.deletingTemplate;
    this.deletingTemplate = null;
    try {
      await this.tasksService.deleteTemplate(tpl.id);
      this.notificationService.show('削除完了', 'テンプレートを削除しました');
    } catch (e) {
      console.error('テンプレート削除エラー:', e);
      this.notificationService.show('エラー', 'テンプレートの削除に失敗しました');
    }
  }
}
