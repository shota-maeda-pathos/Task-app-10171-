import { Component, inject, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { TasksService } from '../../core/services/tasks.service';
import { AuthService } from '../../core/services/auth.service';
import { Member } from '../../core/models/task.model';
import { NotificationService } from '../../core/services/notification.service';
import { saveMemberOrder, sortMembersBySavedOrder } from '../../core/utils/member-order';

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
      (a, b) => this.tasksService.getLoadPercent(b.uid) - this.tasksService.getLoadPercent(a.uid),
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
    if (!uid || !newName.trim()) return;

    await this.tasksService.updateMemberName(uid, newName.trim());
    this.notificationService.show('更新完了', '表示名を変更しました');
  }

  async updateCapacity(hours: number): Promise<void> {
    const uid = this.auth.currentUser()?.uid;
    if (!uid || !hours || hours < 1) return;
    try {
      await this.tasksService.updateMemberCapacity(uid, hours);
      this.notificationService.show('更新完了', '稼働時間を変更しました');
    } catch (e) {
      console.error('稼働時間更新エラー:', e);
      this.notificationService.show('エラー', '稼働時間の更新に失敗しました');
    }
  }
}
