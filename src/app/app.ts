import { Component, inject, signal, computed, effect, HostListener } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { switchMap, distinctUntilChanged } from 'rxjs/operators';
import { of } from 'rxjs';
import { AuthService } from './core/services/auth.service';
import { TasksService } from './core/services/tasks.service';
import { NotificationService } from './core/services/notification.service';
import { Router } from '@angular/router';
import { Timestamp } from '@angular/fire/firestore';
import { Priority, RecurrenceType, TaskStatus, TaskTemplate } from './core/models/task.model';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, FormsModule],
  template: `
    @if (auth.currentUser(); as user) {
      <div (click)="showNotifications = false">
        <header class="app-header" (click)="$event.stopPropagation()">
          <div class="header-left">
            <span class="app-logo">SyncHub +</span>
            <nav class="nav">
              <a routerLink="/board" routerLinkActive="active">
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <rect x="3" y="3" width="7" height="7" />
                  <rect x="14" y="3" width="7" height="7" />
                  <rect x="14" y="14" width="7" height="7" />
                  <rect x="3" y="14" width="7" height="7" />
                </svg>
                Home
              </a>
              <a routerLink="/my-tasks" routerLinkActive="active">
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path
                    d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"
                  />
                  <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
                </svg>
                My Tasks
              </a>
              <a routerLink="/dashboard" routerLinkActive="active">
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <line x1="18" y1="20" x2="18" y2="10" />
                  <line x1="12" y1="20" x2="12" y2="4" />
                  <line x1="6" y1="20" x2="6" y2="14" />
                </svg>
                Dashboard
              </a>
              <a routerLink="/settings" routerLinkActive="active">
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="3" />
                  <path
                    d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
                  />
                </svg>
                Settings
              </a>
            </nav>
          </div>
          <div class="header-right">
            <div class="notif-wrap">
              <button class="notif-btn" (click)="showNotifications = !showNotifications">
                <svg
                  class="notif-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
                @if (unreadCount() > 0) {
                  <span class="notif-badge">{{ unreadCount() }}</span>
                }
              </button>
              @if (showNotifications) {
                <div class="notif-dropdown" (click)="$event.stopPropagation()">
                  <div class="notif-header">
                    <span>通知</span>
                    @if (unreadCount() > 0) {
                      <button class="notif-read-all" (click)="markAllRead()">
                        すべて既読にする
                      </button>
                    }
                  </div>
                  @if (notifList().length === 0) {
                    <div class="notif-empty">通知はありません</div>
                  }
                  @for (notif of notifList(); track notif.id) {
                    <div
                      class="notif-item"
                      [class.unread]="!notif.read"
                      (click)="onNotifClick(notif)"
                    >
                      <div class="notif-dot" [class.read]="notif.read"></div>
                      <div class="notif-content">
                        <div class="notif-title">
                          @if (notif.type === 'task_created') {
                            「{{ notif.taskTitle }}」が追加されました
                          } @else if (notif.type === 'returned') {
                            「{{ notif.taskTitle }}」の差し戻し申請が届きました
                          } @else if (notif.type === 'review_approved') {
                            「{{ notif.taskTitle }}」の差し戻しが承認されました
                          } @else if (notif.type === 'review_rejected') {
                            「{{ notif.taskTitle }}」の差し戻しが却下されました
                          } @else if (notif.type === 'task_completed') {
                            「{{ notif.taskTitle }}」が完了しました
                          } @else {
                            「{{ notif.taskTitle }}」に新着コメント
                          }
                        </div>
                        <div class="notif-body">
                          {{ notif.authorName }}: {{ notif.text.slice(0, 40) }}
                        </div>
                        <div class="notif-time">{{ formatNotifTime(notif.createdAt) }}</div>
                        @if (
                          notif.type === 'returned' &&
                          isManager() &&
                          !processedNotifIds().has(notif.id) &&
                          isNotifActionable(notif)
                        ) {
                          <div class="notif-actions" (click)="$event.stopPropagation()">
                            <button
                              class="notif-action-btn approve"
                              (click)="approveFromNotif(notif)"
                              [disabled]="processingNotifIds().has(notif.id)"
                              title="承認（未着手に戻す）"
                            >
                              <svg
                                width="12"
                                height="12"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="3"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                              >
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                              {{ processingNotifIds().has(notif.id) ? '処理中...' : '承認' }}
                            </button>
                            <button
                              class="notif-action-btn reject"
                              (click)="rejectFromNotif(notif)"
                              [disabled]="processingNotifIds().has(notif.id)"
                              title="却下（進行中に戻す）"
                            >
                              <svg
                                width="12"
                                height="12"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="3"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                              >
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                              </svg>
                              {{ processingNotifIds().has(notif.id) ? '処理中...' : '却下' }}
                            </button>
                          </div>
                        }
                        @if (processedNotifIds().has(notif.id)) {
                          <div class="notif-processed">{{ processedNotifLabels[notif.id] }}</div>
                        }
                      </div>
                      <button
                        class="notif-delete-btn"
                        (click)="deleteNotif(notif, $event)"
                        title="通知を削除"
                      >
                        ×
                      </button>
                    </div>
                  }
                </div>
              }
            </div>
            <span class="user-avatar" [style.background]="currentUserColor()">{{
              currentUserInitial()
            }}</span>
            <span class="user-name">{{ currentUserName() }}</span>
            @if (isManager()) {
              <span class="role-badge">Manager</span>
            }
            <button class="logout-btn" (click)="onLogout()">ログアウト</button>
          </div>
        </header>
        <router-outlet />

        <!-- グローバルFAB -->
        <button class="fab" (click)="openFabModal()" title="タスクを追加">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>

        <!-- FAB タスク作成モーダル -->
        @if (showFabModal) {
          <div class="modal-overlay" (click)="closeFabModal()">
            <div class="fab-modal" (click)="$event.stopPropagation()">
              <div class="fab-modal-header">
                <h3>タスクを作成</h3>
                <button class="fab-modal-close" (click)="closeFabModal()">✕</button>
              </div>
              <div class="fab-modal-body">
                @if (tasksService.templates().length > 0) {
                  <div class="fab-template-row">
                    <span class="fab-template-label">テンプレート:</span>
                    @for (tpl of tasksService.templates(); track tpl.id) {
                      <button class="fab-template-chip" (click)="applyFabTemplate(tpl)">
                        {{ tpl.title }}
                      </button>
                    }
                  </div>
                }
                <input
                  type="text"
                  [(ngModel)]="fabTitle"
                  placeholder="タスク名"
                  class="fab-input"
                  (keydown.enter)="createTaskFromFab()"
                />
                @if (fabError) {
                  <div class="fab-error">{{ fabError }}</div>
                }
                <textarea
                  [(ngModel)]="fabDescription"
                  placeholder="説明（任意）"
                  class="fab-textarea"
                  rows="2"
                ></textarea>
                <select [(ngModel)]="fabAssignee" class="fab-input">
                  <option [ngValue]="null">担当者を選ぶ（任意）</option>
                  @for (m of tasksService.members(); track m.uid) {
                    <option [ngValue]="m.uid">
                      {{ m.name }}（{{ tasksService.getFocusLoadPercent(m.uid) }}%）
                    </option>
                  }
                </select>
                <div class="fab-row">
                  <div class="fab-field">
                    <label>見積もり</label>
                    <div class="fab-input-unit">
                      <input type="number" [(ngModel)]="fabHours" min="0.5" step="0.5" />
                      <span>h</span>
                    </div>
                  </div>
                  <div class="fab-field">
                    <label>ステータス</label>
                    <select [(ngModel)]="fabStatus" class="fab-input">
                      <option value="未着手">未着手</option>
                      <option value="進行中">進行中</option>
                    </select>
                  </div>
                </div>
                <div class="fab-row">
                  <div class="fab-field">
                    <label>締切日</label>
                    <input type="date" [(ngModel)]="fabDueDate" class="fab-input" />
                  </div>
                  <div class="fab-field">
                    <label>優先度</label>
                    <select [(ngModel)]="fabPriority" class="fab-input">
                      <option [ngValue]="null">なし</option>
                      <option value="high">🔴 高</option>
                      <option value="medium">🟡 中</option>
                      <option value="low">🟢 低</option>
                    </select>
                  </div>
                </div>
                <div class="fab-row">
                  <div class="fab-field">
                    <label>繰り返し</label>
                    <select [(ngModel)]="fabRecurrence" class="fab-input">
                      <option [ngValue]="null">なし</option>
                      <option value="daily">毎日</option>
                      <option value="weekly">毎週</option>
                      <option value="biweekly">隔週</option>
                      <option value="monthly">毎月</option>
                    </select>
                  </div>
                  <div class="fab-field"></div>
                </div>
                <label class="fab-focus-check">
                  <input type="checkbox" [(ngModel)]="fabFocus" />
                  今週やる
                </label>
              </div>
              <div class="fab-modal-footer">
                <button class="fab-cancel" (click)="closeFabModal()">キャンセル</button>
                <button class="fab-submit" (click)="createTaskFromFab()">作成</button>
              </div>
            </div>
          </div>
        }

        <!-- モバイル用ボトムナビ -->
        <nav class="bottom-nav">
          <a routerLink="/board" routerLinkActive="active" class="bottom-nav-item">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
            </svg>
            <span>Home</span>
          </a>
          <a routerLink="/my-tasks" routerLinkActive="active" class="bottom-nav-item">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
              <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
            </svg>
            <span>My Tasks</span>
          </a>
          <a routerLink="/dashboard" routerLinkActive="active" class="bottom-nav-item">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <line x1="18" y1="20" x2="18" y2="10" />
              <line x1="12" y1="20" x2="12" y2="4" />
              <line x1="6" y1="20" x2="6" y2="14" />
            </svg>
            <span>Dashboard</span>
          </a>
          <a routerLink="/settings" routerLinkActive="active" class="bottom-nav-item">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="12" cy="12" r="3" />
              <path
                d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
              />
            </svg>
            <span>Settings</span>
          </a>
        </nav>

        <div class="toast-container">
          @for (toast of notificationService.toasts(); track toast.id) {
            <div class="toast" (click)="notificationService.dismiss(toast.id)">
              <div class="toast-title">{{ toast.title }}</div>
              <div class="toast-body">{{ toast.body }}</div>
            </div>
          }
        </div>

        <div class="portrait-only-notice" role="status">
          <div>
            <div class="portrait-only-icon" aria-hidden="true">↻</div>
            <strong>縦向きでご利用ください</strong>
            <p>この画面はスマートフォンの横向き表示に対応していません。</p>
          </div>
        </div>
      </div>
    } @else {
      <div class="login-screen">
        <div class="login-card">
          <h1>SyncHub +</h1>
          <p>チームの進捗を、もっとスマートに</p>
          <button class="login-btn" (click)="loginWithGoogle()">Googleでログイン</button>
          @if (googleLoginError) {
            <div class="login-error">{{ googleLoginError }}</div>
          }
          <div class="divider">または</div>
          @if (!showEmailForm) {
            <button class="login-btn-sub" (click)="showEmailForm = true">
              メールアドレスでログイン
            </button>
          } @else {
            <div class="email-form">
              <input
                type="email"
                [(ngModel)]="emailInput"
                placeholder="メールアドレス"
                class="email-input"
              />
              <input
                type="password"
                [(ngModel)]="passwordInput"
                placeholder="パスワード"
                class="email-input"
                (keydown.enter)="loginWithEmail()"
              />
              @if (loginError) {
                <div class="login-error">{{ loginError }}</div>
              }
              <button class="login-btn" (click)="loginWithEmail()">ログイン</button>
              <button class="login-btn-sub" (click)="showEmailForm = false">戻る</button>
            </div>
          }
        </div>
      </div>
    }
  `,
  styles: [
    `
      .app-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0 24px;
        background: var(--header-bg);
        color: var(--header-text);
        height: 52px;
        font-family: inherit;
        position: sticky;
        top: 0;
        z-index: 100;
      }
      .header-left {
        display: flex;
        align-items: center;
        gap: 32px;
      }
      .app-logo {
        font-family: 'Satisfy', cursive;
        font-size: 22px;
        font-weight: 400;
        letter-spacing: 0.03em;
      }
      .nav {
        display: flex;
        gap: 4px;
      }
      .nav a {
        display: flex;
        align-items: center;
        gap: 6px;
        color: rgba(255, 255, 255, 0.55);
        text-decoration: none;
        font-size: 13px;
        padding: 6px 12px;
        border-radius: 6px;
        transition: all 0.15s;
      }
      .nav a svg {
        width: 15px;
        height: 15px;
        flex: 0 0 auto;
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .nav a:hover {
        color: #fff;
        background: rgba(255, 255, 255, 0.08);
      }
      .nav a.active {
        color: #fff;
        background: rgba(255, 255, 255, 0.12);
      }
      .header-right {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .user-avatar {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        color: #fff;
        font-size: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 600;
      }
      .user-name {
        font-size: 13px;
      }
      .role-badge {
        font-size: 10px;
        padding: 2px 8px;
        border-radius: 10px;
        background: rgba(var(--accent-rgb), 0.3);
        color: rgba(var(--accent-rgb), 0.7);
      }
      .logout-btn {
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: var(--header-text);
        padding: 5px 12px;
        border-radius: 6px;
        font-size: 12px;
        cursor: pointer;
        font-family: inherit;
      }
      .logout-btn:hover {
        background: rgba(255, 255, 255, 0.18);
      }
      .login-screen {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
        background: var(--bg);
        font-family: inherit;
      }
      .login-card {
        background: var(--card);
        padding: 48px 40px;
        border-radius: 16px;
        text-align: center;
        box-shadow: 0 8px 30px rgba(var(--ink-rgb), 0.08);
      }
      .login-card h1 {
        font-family: 'Satisfy', cursive;
        font-size: 32px;
        font-weight: 400;
        margin: 0 0 8px;
        color: var(--ink);
      }
      .login-card p {
        font-size: 13px;
        color: var(--muted);
        margin: 0 0 28px;
      }
      .login-btn {
        background: var(--accent);
        color: #fff;
        border: none;
        padding: 12px 28px;
        border-radius: 8px;
        font-size: 14px;
        cursor: pointer;
        font-family: inherit;
        font-weight: 500;
      }
      .login-btn:hover {
        background: var(--accent-hover);
      }
      .divider {
        text-align: center;
        color: #9ca3af;
        font-size: 12px;
        margin: 16px 0;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .divider::before,
      .divider::after {
        content: '';
        flex: 1;
        height: 1px;
        background: var(--line);
      }
      .login-btn-sub {
        width: 100%;
        background: var(--card);
        color: var(--accent);
        border: 1px solid var(--accent);
        padding: 10px 28px;
        border-radius: 8px;
        font-size: 14px;
        cursor: pointer;
        font-family: inherit;
        margin-top: 8px;
      }
      .login-btn-sub:hover {
        background: rgba(var(--accent-rgb), 0.06);
      }
      .email-form {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: 8px;
      }
      .email-input {
        width: 100%;
        padding: 10px 12px;
        border: 1px solid var(--line);
        border-radius: 8px;
        font-size: 13px;
        font-family: inherit;
      }
      .email-input:focus {
        outline: none;
        border-color: var(--accent);
      }
      .login-error {
        font-size: 12px;
        color: var(--danger);
        text-align: center;
      }
      .login-btn {
        width: 100%;
        margin-top: 0;
      }
      .toast-container {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 1000;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .toast {
        background: var(--header-bg);
        color: var(--header-text);
        padding: 14px 18px;
        border-radius: 10px;
        min-width: 280px;
        max-width: 360px;
        cursor: pointer;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        animation: slideIn 0.2s ease;
      }
      .toast-title {
        font-size: 13px;
        font-weight: 600;
        margin-bottom: 4px;
      }
      .toast-body {
        font-size: 12px;
        opacity: 0.8;
      }
      .portrait-only-notice {
        display: none;
        position: fixed;
        inset: 0;
        z-index: 2000;
        align-items: center;
        justify-content: center;
        padding: 24px;
        background: var(--bg);
        color: var(--ink);
        text-align: center;
      }
      .portrait-only-notice strong {
        font-size: 18px;
      }
      .portrait-only-notice p {
        margin: 8px 0 0;
        color: var(--muted);
        font-size: 13px;
      }
      .portrait-only-icon {
        margin-bottom: 12px;
        color: var(--accent);
        font-size: 36px;
      }
      @keyframes slideIn {
        from {
          transform: translateX(100%);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
      .notif-wrap {
        position: relative;
      }
      .notif-btn {
        background: rgba(255, 255, 255, 0.1);
        border: none;
        cursor: pointer;
        padding: 6px 8px;
        border-radius: 6px;
        position: relative;
        color: rgba(255, 255, 255, 0.85);
        display: flex;
        align-items: center;
        transition: background 0.15s;
      }
      .notif-btn:hover {
        background: rgba(255, 255, 255, 0.18);
      }
      .notif-icon {
        width: 20px;
        height: 20px;
      }
      .notif-badge {
        position: absolute;
        top: -4px;
        right: -4px;
        width: 18px;
        height: 18px;
        background: var(--danger);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 10px;
        font-weight: 700;
        color: #fff;
        border: 2px solid var(--header-bg);
      }
      .notif-dropdown {
        position: absolute;
        top: calc(100% + 8px);
        right: 0;
        width: 320px;
        max-height: calc(100dvh - 80px);
        background: var(--card);
        border-radius: 12px;
        border: 1px solid var(--line);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
        z-index: 200;
        overflow-y: auto;
        overscroll-behavior: contain;
      }
      .notif-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 16px;
        border-bottom: 1px solid var(--line);
        font-size: 13px;
        font-weight: 600;
        color: var(--ink);
      }
      .notif-read-all {
        font-size: 11px;
        color: var(--accent);
        background: none;
        border: none;
        cursor: pointer;
      }
      .notif-empty {
        padding: 24px;
        text-align: center;
        font-size: 13px;
        color: var(--muted);
      }
      .notif-item {
        display: flex;
        gap: 10px;
        align-items: flex-start;
        padding: 10px 16px;
        border-bottom: 1px solid var(--line);
        cursor: pointer;
        &:hover {
          background: var(--bg);
        }
        &.unread {
          background: rgba(var(--accent-rgb), 0.04);
        }
      }
      .notif-content {
        flex: 1;
        min-width: 0;
      }
      .notif-delete-btn {
        flex-shrink: 0;
        background: none;
        border: none;
        color: #9aa3b2;
        font-size: 14px;
        cursor: pointer;
        padding: 0 2px;
        line-height: 1;
        border-radius: 4px;
        &:hover {
          color: var(--danger);
          background: rgba(var(--danger-rgb), 0.08);
        }
      }
      .notif-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--accent);
        margin-top: 4px;
        flex-shrink: 0;
        &.read {
          background: var(--line);
        }
      }
      .notif-title {
        font-size: 12px;
        font-weight: 500;
        color: var(--ink);
      }
      .notif-body {
        font-size: 11px;
        color: var(--muted);
        margin-top: 2px;
      }
      .notif-time {
        font-size: 10px;
        color: #9aa3b2;
        margin-top: 3px;
      }
      /* 通知インラインアクション */
      .notif-actions {
        display: flex;
        gap: 6px;
        margin-top: 6px;
      }
      .notif-action-btn {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        padding: 4px 10px;
        border-radius: 6px;
        border: none;
        cursor: pointer;
        font-family: inherit;
        font-weight: 500;
        transition: all 0.15s;
      }
      .notif-action-btn.approve {
        background: rgba(var(--ok-rgb), 0.12);
        color: var(--ok);
      }
      .notif-action-btn.approve:hover:not(:disabled) {
        background: rgba(var(--ok-rgb), 0.22);
      }
      .notif-action-btn.reject {
        background: rgba(var(--danger-rgb), 0.1);
        color: var(--danger);
      }
      .notif-action-btn.reject:hover:not(:disabled) {
        background: rgba(var(--danger-rgb), 0.2);
      }
      .notif-action-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .notif-processed {
        font-size: 11px;
        color: var(--muted);
        margin-top: 4px;
        font-weight: 500;
      }
      /* グローバルFAB */
      .fab {
        position: fixed;
        bottom: 28px;
        right: 28px;
        width: 52px;
        height: 52px;
        border-radius: 50%;
        background: var(--accent);
        color: #fff;
        border: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 4px 16px rgba(var(--accent-rgb), 0.35);
        z-index: 90;
        transition:
          right 0.2s ease,
          transform 0.15s,
          box-shadow 0.15s;
      }
      :host:has(app-comment-panel) .fab {
        right: min(calc(var(--comment-panel-width, 320px) + 28px), calc(100vw - 72px));
      }
      .fab:hover {
        transform: scale(1.08);
        box-shadow: 0 6px 20px rgba(var(--accent-rgb), 0.45);
      }
      .fab:active {
        transform: scale(0.96);
      }
      /* FABモーダル */
      .modal-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.35);
        z-index: 500;
        display: flex;
        align-items: center;
        justify-content: center;
        animation: fadeIn 0.15s ease;
      }
      @keyframes fadeIn {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }
      .fab-modal {
        background: var(--card);
        border-radius: 14px;
        width: 420px;
        max-width: calc(100vw - 32px);
        max-height: calc(100vh - 60px);
        overflow-y: auto;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
        animation: modalUp 0.2s ease;
      }
      @keyframes modalUp {
        from {
          transform: translateY(24px);
          opacity: 0;
        }
        to {
          transform: translateY(0);
          opacity: 1;
        }
      }
      .fab-modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 20px;
        border-bottom: 1px solid var(--line);
      }
      .fab-modal-header h3 {
        margin: 0;
        font-size: 15px;
        font-weight: 600;
        color: var(--ink);
      }
      .fab-modal-close {
        background: none;
        border: none;
        font-size: 16px;
        color: var(--muted);
        cursor: pointer;
        padding: 4px;
        border-radius: 4px;
      }
      .fab-modal-close:hover {
        color: var(--ink);
        background: var(--bg);
      }
      .fab-modal-body {
        padding: 16px 20px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .fab-input {
        width: 100%;
        padding: 9px 12px;
        border: 1px solid var(--line);
        border-radius: 8px;
        font-size: 13px;
        font-family: inherit;
        background: var(--card);
        color: var(--ink);
        transition: border-color 0.15s;
        height: 40px;
        box-sizing: border-box;
      }
      .fab-input:focus {
        outline: none;
        border-color: var(--accent);
      }
      .fab-textarea {
        width: 100%;
        padding: 9px 12px;
        border: 1px solid var(--line);
        border-radius: 8px;
        font-size: 13px;
        font-family: inherit;
        resize: vertical;
        background: var(--card);
        color: var(--ink);
      }
      .fab-textarea:focus {
        outline: none;
        border-color: var(--accent);
      }
      .fab-row {
        display: flex;
        gap: 12px;
      }
      .fab-field {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .fab-field label {
        font-size: 11px;
        color: var(--muted);
        font-weight: 500;
      }
      .fab-input-unit {
        display: flex;
        align-items: center;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--card);
        transition: border-color 0.15s;
        height: 40px;
        box-sizing: border-box;
      }
      .fab-input-unit:focus-within {
        border-color: var(--accent);
      }
      .fab-input-unit input {
        flex: 1;
        min-width: 0;
        padding: 9px 12px;
        border: none;
        border-radius: 8px 0 0 8px;
        font-size: 13px;
        font-family: inherit;
        background: transparent;
        color: var(--ink);
      }
      .fab-input-unit input:focus {
        outline: none;
      }
      .fab-input-unit span {
        font-size: 12px;
        color: var(--muted);
        padding-right: 12px;
        flex-shrink: 0;
      }
      .fab-error {
        font-size: 12px;
        color: var(--danger);
        margin: -4px 0;
      }
      .fab-template-row {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
        padding-bottom: 6px;
        border-bottom: 1px solid var(--line);
      }
      .fab-template-label {
        font-size: 11px;
        color: var(--muted);
        flex-shrink: 0;
      }
      .fab-template-chip {
        padding: 4px 10px;
        border: 1px solid var(--line);
        border-radius: 14px;
        background: var(--card);
        color: var(--ink);
        font-size: 11px;
        font-family: inherit;
        cursor: pointer;
        transition: all 0.15s;
        white-space: nowrap;
      }
      .fab-template-chip:hover {
        border-color: var(--accent);
        color: var(--accent);
        background: rgba(var(--accent-rgb), 0.06);
      }
      .fab-focus-check {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
        color: var(--ink);
        cursor: pointer;
        margin-top: 4px;
        input[type='checkbox'] {
          accent-color: var(--accent);
        }
      }
      .fab-modal-footer {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding: 12px 20px;
        border-top: 1px solid var(--line);
      }
      .fab-cancel {
        padding: 8px 16px;
        border-radius: 8px;
        border: 1px solid var(--line);
        background: var(--card);
        color: var(--muted);
        font-size: 13px;
        cursor: pointer;
        font-family: inherit;
      }
      .fab-cancel:hover {
        background: var(--bg);
        color: var(--ink);
      }
      .fab-submit {
        padding: 8px 20px;
        border-radius: 8px;
        border: none;
        background: var(--accent);
        color: #fff;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        font-family: inherit;
      }
      .fab-submit:hover {
        background: var(--accent-hover);
      }
      /* モバイルボトムナビ */
      .bottom-nav {
        display: none;
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        background: var(--card);
        border-top: 1px solid var(--line);
        z-index: 100;
        justify-content: space-around;
        padding: 6px 0 env(safe-area-inset-bottom, 4px);
      }
      .bottom-nav-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        font-size: 10px;
        color: var(--muted);
        text-decoration: none;
        padding: 4px 8px;
        border-radius: 8px;
        transition: color 0.15s;
      }
      .bottom-nav-item.active {
        color: var(--accent);
      }
      .bottom-nav-item svg {
        stroke: currentColor;
      }
      /* モバイル対応 */
      @media (max-width: 768px) {
        .header-right {
          position: relative;
        }
        .app-header {
          padding: 0 12px;
          height: 48px;
        }
        .nav {
          display: none;
        }
        .user-name {
          display: none;
        }
        .role-badge {
          display: none;
        }
        .logout-btn {
          font-size: 11px;
          padding: 4px 8px;
        }
        .notif-dropdown {
          position: fixed;
          top: 56px;
          right: 8px;
          left: 8px;
          width: auto;
          max-width: none;
          max-height: calc(100dvh - 120px);
          overflow-y: auto;
          overscroll-behavior: contain;
        }
        .notif-header {
          position: sticky;
          top: 0;
          z-index: 1;
          background: var(--card);
        }
        .bottom-nav {
          display: flex;
        }
        .fab {
          bottom: 72px;
          right: 16px;
          width: 48px;
          height: 48px;
        }
        .toast-container {
          bottom: 72px;
          right: 12px;
          left: 12px;
        }
        .toast {
          min-width: unset;
        }
      }
      @media (min-width: 769px) and (max-width: 1024px) {
        .app-header {
          padding: 0 16px;
        }
        .header-left {
          gap: 16px;
        }
        .nav a {
          padding-inline: 8px;
          font-size: 12px;
        }
        .header-right {
          gap: 8px;
        }
      }
      @media (min-width: 769px) and (max-width: 900px) {
        .user-name,
        .role-badge {
          display: none;
        }
      }
      @media (orientation: landscape) and (max-height: 500px) and (pointer: coarse) {
        .portrait-only-notice {
          display: flex;
        }
      }
    `,
  ],
})
export class App {
  auth = inject(AuthService);
  tasksService = inject(TasksService);
  notificationService = inject(NotificationService);

  showNotifications = false;

  // 通知の処理状態を独立したSignalで管理（Firestoreの再購読で消えないようにする）
  processedNotifIds = signal(new Set<string>());
  processingNotifIds = signal(new Set<string>());
  processedNotifLabels: Record<string, string> = {};

  // uid シグナルをObservableに変換し、switchMapで通知リストをリアクティブに購読する。
  // これによりログイン直後からバッジが表示される。
  private uid$ = toObservable(computed(() => this.auth.currentUser()?.uid ?? null)).pipe(
    distinctUntilChanged(),
  );

  private rawNotifList = toSignal(
    this.uid$.pipe(switchMap((uid) => (uid ? this.tasksService.getNotifications(uid) : of([])))),
    { initialValue: [] as any[] },
  );

  notifList = computed(() => {
    const taskIds = new Set(this.tasksService.tasks().map((t) => t.id));
    return this.rawNotifList().filter((n: any) => !n.taskId || taskIds.has(n.taskId));
  });

  unreadCount = computed(() => this.notifList().filter((n: any) => !n.read).length);

  constructor() {
    // トースト通知: uidが変わったときだけ監視を開始する
    let prevUid: string | null = null;
    effect(() => {
      const uid = this.auth.currentUser()?.uid ?? null;
      if (!uid || uid === prevUid) return;
      prevUid = uid;
      this.tasksService.watchMyTaskComments(uid, (taskTitle, authorName, text) => {
        this.notificationService.show(
          `「${taskTitle}」に新着コメント`,
          `${authorName}: ${text.slice(0, 40)}`,
        );
      });
    });

    // テーマ適用: ユーザーの保存テーマを document に反映
    effect(() => {
      const uid = this.auth.currentUser()?.uid;
      const members = this.tasksService.members();
      if (!uid || members.length === 0) return;
      const member = members.find((m) => m.uid === uid);
      const theme = member?.theme ?? '';
      if (theme) {
        document.documentElement.setAttribute('data-theme', theme);
      } else {
        document.documentElement.removeAttribute('data-theme');
      }
    });
  }

  isManager(): boolean {
    const uid = this.auth.currentUser()?.uid;
    if (!uid) return false;
    const member = this.tasksService.members().find((m) => m.uid === uid);
    return member?.role === 'manager';
  }

  emailInput = '';
  passwordInput = '';
  loginError = '';
  googleLoginError = '';
  showEmailForm = false;

  async loginWithGoogle(): Promise<void> {
    this.googleLoginError = '';
    try {
      await this.auth.loginWithGoogle();
      this.router.navigate(['/board']);
    } catch (e: any) {
      if (e?.code === 'auth/popup-closed-by-user') {
        this.googleLoginError = 'ログインがキャンセルされました';
      } else if (e?.code === 'auth/popup-blocked') {
        this.googleLoginError =
          'ポップアップがブロックされました。ブラウザの設定を確認してください';
      } else {
        this.googleLoginError = 'ログインに失敗しました。もう一度お試しください';
      }
    }
  }

  async loginWithEmail(): Promise<void> {
    this.loginError = '';
    try {
      await this.auth.loginWithEmail(this.emailInput, this.passwordInput);
    } catch (e: any) {
      this.loginError = 'メールアドレスまたはパスワードが正しくありません';
    }
  }

  currentUserName(): string {
    const uid = this.auth.currentUser()?.uid;
    if (!uid) return '';
    const member = this.tasksService.members().find((m) => m.uid === uid);
    return member?.name ?? this.auth.currentUser()?.displayName ?? '';
  }

  currentUserInitial(): string {
    return this.currentUserName().charAt(0) ?? '?';
  }

  currentUserColor(): string {
    const uid = this.auth.currentUser()?.uid;
    if (!uid) return '#4C5FD5';
    const member = this.tasksService.members().find((m) => m.uid === uid);
    return member?.avatarColor ?? '#4C5FD5';
  }

  async markAllRead(): Promise<void> {
    const uid = this.auth.currentUser()?.uid;
    if (!uid) return;
    await this.tasksService.markAllAsRead(uid);
  }

  formatNotifTime(timestamp: any): string {
    if (!timestamp?.toDate) return '';
    const d = timestamp.toDate();
    const diff = Date.now() - d.getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'たった今';
    if (min < 60) return `${min}分前`;
    const hour = Math.floor(min / 60);
    if (hour < 24) return `${hour}時間前`;
    return `${Math.floor(hour / 24)}日前`;
  }

  router = inject(Router);

  async onNotifClick(notif: any): Promise<void> {
    // 既読にする
    const uid = this.auth.currentUser()?.uid;
    if (uid) await this.tasksService.markAsRead(uid, notif.id);

    // ボード画面にタスクIDを渡して遷移
    this.showNotifications = false;
    this.router.navigate(['/board'], { queryParams: { taskId: notif.taskId } });
  }

  async deleteNotif(notif: any, event: Event): Promise<void> {
    event.stopPropagation(); // 親のonNotifClickが発火しないようにする
    const uid = this.auth.currentUser()?.uid;
    if (!uid) return;
    await this.tasksService.deleteNotification(uid, notif.id);
  }

  async onLogout(): Promise<void> {
    this.router.navigate([], { queryParams: {} });
    await this.auth.logout();
  }

  // ===== FAB タスク作成 =====
  showFabModal = false;
  fabTitle = '';
  fabDescription = '';
  fabAssignee: string | null = null;
  fabHours = 1;
  fabDueDate = '';
  fabPriority: Priority | null = null;
  fabStatus: TaskStatus = '未着手';
  fabFocus = false;
  fabRecurrence: RecurrenceType | null = null;
  fabError = '';
  fabSubmitting = false;
  private fabTemplateSubtasks: { title: string; estimatedHours: number }[] = [];

  openFabModal(): void {
    this.showFabModal = true;
    this.fabTitle = '';
    this.fabDescription = '';
    this.fabAssignee = null;
    this.fabHours = 1;
    this.fabDueDate = '';
    this.fabPriority = null;
    this.fabStatus = '未着手';
    this.fabFocus = false;
    this.fabRecurrence = null;
    this.fabError = '';
    this.fabTemplateSubtasks = [];
  }

  closeFabModal(): void {
    this.showFabModal = false;
    this.fabTemplateSubtasks = [];
  }

  applyFabTemplate(tpl: TaskTemplate): void {
    this.fabTitle = tpl.title;
    this.fabDescription = tpl.description || '';
    this.fabAssignee = tpl.assigneeId ?? null;
    this.fabHours = tpl.estimatedHours || 1;
    this.fabPriority = tpl.priority;
    this.fabTemplateSubtasks = tpl.subtasks?.filter((s) => s.title.trim()) ?? [];
    this.fabError = '';
  }

  async createTaskFromFab(): Promise<void> {
    if (this.fabSubmitting) return;
    const title = this.fabTitle.trim();
    if (!title) {
      this.fabError = 'タスク名を入力してください';
      return;
    }
    this.fabSubmitting = true;
    try {
      const dueDate = this.fabDueDate
        ? Timestamp.fromDate(new Date(this.fabDueDate + 'T00:00:00'))
        : null;
      const parentId = await this.tasksService.createTask({
        title,
        description: this.fabDescription.trim(),
        assigneeId: this.fabAssignee,
        createdBy: this.auth.currentUser()?.uid ?? null,
        estimatedHours: this.fabHours,
        status: this.fabStatus,
        priority: this.fabPriority,
        dueDate,
        focusThisWeek: this.fabFocus,
        focusHours: this.fabFocus ? this.fabHours : null,
        recurrence: this.fabRecurrence ?? null,
      });
      for (const sub of this.fabTemplateSubtasks) {
        await this.tasksService.createTask({
          title: sub.title,
          parentId,
          assigneeId: this.fabAssignee,
          createdBy: this.auth.currentUser()?.uid ?? null,
          estimatedHours: sub.estimatedHours || 0,
          status: '未着手',
        });
      }
      this.fabTemplateSubtasks = [];
      this.notificationService.show('タスク作成', `「${title}」を作成しました`);
      this.closeFabModal();
      if (this.router.url.startsWith('/board')) {
        this.router.navigate(['/board'], { queryParams: { taskId: parentId } });
      }
    } catch (e) {
      console.error('FABタスク作成エラー:', e);
      this.fabError = 'タスクの作成に失敗しました';
    } finally {
      this.fabSubmitting = false;
    }
  }

  /** タスクがまだ差し戻し中で、かつこの通知が今回の差し戻しに対応するものかを確認する */
  isNotifActionable(notif: any): boolean {
    const task = this.tasksService.tasks().find((t) => t.id === notif.taskId);
    if (!task || task.status !== '差し戻し中') return false;
    // 通知の作成時刻がタスクのステータス更新時刻より前なら、古い差し戻しの通知
    if (notif.createdAt?.toDate && task.statusUpdatedAt?.toDate) {
      const notifTime = notif.createdAt.toDate().getTime();
      const taskTime = task.statusUpdatedAt.toDate().getTime();
      // 通知がステータス更新より2秒以上前なら古い通知とみなす（同時刻の誤差を許容）
      if (notifTime < taskTime - 2000) return false;
    }
    return true;
  }

  // ===== 通知インラインアクション =====
  private markNotifProcessing(id: string): void {
    this.processingNotifIds.update((s) => {
      const n = new Set(s);
      n.add(id);
      return n;
    });
  }
  private unmarkNotifProcessing(id: string): void {
    this.processingNotifIds.update((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });
  }
  private markNotifProcessed(id: string, label: string): void {
    this.processedNotifIds.update((s) => {
      const n = new Set(s);
      n.add(id);
      return n;
    });
    this.processedNotifLabels[id] = label;
  }

  async approveFromNotif(notif: any): Promise<void> {
    if (this.processingNotifIds().has(notif.id) || this.processedNotifIds().has(notif.id)) return;
    if (!this.isNotifActionable(notif)) {
      this.markNotifProcessed(notif.id, '（処理済み）');
      return;
    }
    this.markNotifProcessing(notif.id);
    try {
      await this.tasksService.approveReview(notif.taskId);
      const uid = this.auth.currentUser()?.uid;
      if (uid) await this.tasksService.markAsRead(uid, notif.id);
      this.markNotifProcessed(notif.id, '✓ 承認済み');
      this.notificationService.show('承認完了', `「${notif.taskTitle}」の差し戻しを承認しました`);
    } catch (e) {
      console.error('承認エラー:', e);
      this.notificationService.show('エラー', '承認に失敗しました');
    }
    this.unmarkNotifProcessing(notif.id);
  }

  async rejectFromNotif(notif: any): Promise<void> {
    if (this.processingNotifIds().has(notif.id) || this.processedNotifIds().has(notif.id)) return;
    if (!this.isNotifActionable(notif)) {
      this.markNotifProcessed(notif.id, '（処理済み）');
      return;
    }
    this.markNotifProcessing(notif.id);
    try {
      await this.tasksService.rejectReview(notif.taskId);
      const uid = this.auth.currentUser()?.uid;
      if (uid) await this.tasksService.markAsRead(uid, notif.id);
      this.markNotifProcessed(notif.id, '✗ 却下済み');
      this.notificationService.show('却下完了', `「${notif.taskTitle}」の差し戻しを却下しました`);
    } catch (e) {
      console.error('却下エラー:', e);
      this.notificationService.show('エラー', '却下に失敗しました');
    }
    this.unmarkNotifProcessing(notif.id);
  }
}
