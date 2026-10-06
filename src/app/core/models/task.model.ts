import { Timestamp } from '@angular/fire/firestore';

export type TaskStatus = '未着手' | '進行中' | '差し戻し中' | '完了' | 'アーカイブ済み';
export type Priority = 'high' | 'medium' | 'low';
export type RecurrenceType = 'daily' | 'weekly' | 'biweekly' | 'monthly';

export interface Task {
  id: string;
  title: string;
  description?: string;

  parentId: string | null;
  assigneeId: string | null;
  createdBy: string | null;

  status: TaskStatus;

  estimatedHours: number;
  actualHours: number | null;

  dueDate: Timestamp | null;
  blockedBy: string[];

  order: number;

  createdAt: Timestamp;
  statusUpdatedAt: Timestamp;

  reviewReason?: string | null;
  proposedDueDate?: Timestamp | null;

  priority: Priority | null;

  focusThisWeek: boolean;
  focusHours: number | null;
  targetWeekStart: Timestamp | null;

  recurrence: RecurrenceType | null;
  recurrenceSourceId: string | null;
  recurrencePreviousTaskId?: string | null;
  recurrenceNextTaskId?: string | null;
}

export type LeavePeriod = 'full' | 'am' | 'pm';

export interface MemberLeave {
  date: string;
  label: string;
  period?: LeavePeriod;
}

export interface TeamHoliday {
  date: string;
  name: string;
}

export interface TeamSettings {
  holidays: TeamHoliday[];
  _error?: boolean;
}

export interface Member {
  uid: string;
  name: string;
  role: 'manager' | 'member';
  weeklyCapacityHours: number;
  avatarColor: string;
  theme?: string;
  leaves?: MemberLeave[];
  disabled?: boolean;
}

export interface TaskComment {
  id: string;
  taskId: string;
  text: string;
  authorId: string;
  authorName: string;
  createdAt: Timestamp;
  reactions?: Record<string, string[]>; // emoji -> uid[]
}

export interface TaskAttachment {
  id: string;
  taskId: string;
  fileName: string;
  fileType: string;       // MIME type
  fileSize: number;       // bytes
  dataUrl: string;        // base64 data URL (small files)
  authorId: string;
  authorName: string;
  createdAt: Timestamp;
}

export interface TaskActivity {
  id: string;
  taskId: string;
  type:
    | 'status_change'
    | 'assignee_change'
    | 'priority_change'
    | 'due_date_change'
    | 'completed'
    | 'created'
    | 'review_request'
    | 'review_approve'
    | 'review_reject'
    | 'review_withdraw'
    | 'focus_change'
    | 'estimate_change';
  authorId: string;
  authorName: string;
  oldValue?: string | null;
  newValue?: string | null;
  createdAt: Timestamp;
}

export interface TaskTemplate {
  id: string;
  title: string;
  description: string;
  priority: Priority | null;
  estimatedHours: number;
  assigneeId: string | null;
  subtasks: { title: string; estimatedHours: number }[];
  createdBy: string;
  createdAt: Timestamp;
}

export interface TaskNotification {
  id: string;
  taskId: string;
  taskTitle: string;
  authorName: string;
  text: string;
  read: boolean;
  createdAt: Timestamp;
  type?: 'comment' | 'task_created' | 'returned' | 'review_approved' | 'review_rejected' | 'review_withdrawn' | 'task_completed';
}
