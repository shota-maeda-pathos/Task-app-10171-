# Task Flow + 開発 引き継ぎプロンプト

## プロジェクト概要
Angular 18+ と Firebase Firestore を使ったタスク管理アプリ「Task Flow +」の開発。
ユーザーのPC上のパスは `C:\Users\pluser1\Desktop\task-app\`。

## 技術スタック
- Angular 18+（standalone components, signals, computed, effect, @if/@for テンプレート構文）
- Firebase Firestore（セキュリティルール、サブコレクション）
- SCSS（テーマはCSS変数ベース）
- Angular CDK（Drag & Drop）
- Angular View Encapsulation: Emulated（デフォルト）

## ファイル構成（主要ファイル）
```
src/app/
├── app.ts                          # ルートコンポーネント（ヘッダー52px/モバイル48px、router-outlet、FAB、bottom-nav）
├── app.html
├── app.routes.ts
├── core/
│   ├── models/task.model.ts
│   └── services/tasks.service.ts   # Firestore CRUD、リアクション（toggleReaction→updateDoc）
├── features/
│   ├── board/
│   │   ├── board.component.ts      # メインボード（signal/computed/effect、isMobile signal、D&D、フィルター、ソート、スイムレーン）
│   │   ├── board.component.html    # テンプレート（.app > .sidebar + .board-with-panel > main.board-outer + app-comment-panel）
│   │   ├── board.component.scss    # 全スタイル（1738行、末尾にモバイルメディアクエリ）
│   │   └── comment-panel/
│   │       ├── comment-panel.ts    # コメント・アクティビティ・添付ファイル・リアクション
│   │       ├── comment-panel.html  # @if (task()) でパネル内容を条件表示
│   │       └── comment-panel.scss  # パネルスタイル（モバイル用:host fixed追加済み）
│   ├── dashboard/
│   │   ├── dashboard.ts
│   │   └── dashboard.html
│   ├── settings/
│   │   ├── settings.ts
│   │   └── settings.html
│   └── my-tasks/
│       └── my-tasks.ts
└── styles.scss                     # グローバルスタイル、テーマCSS変数
```

## レイアウト構造

### デスクトップ
```
header (52px)
├── .app (CSS Grid: grid-template-columns: 260px 1fr)
│   ├── .sidebar (260px, 折りたたみ時48px)
│   └── .board-with-panel (display: flex)
│       ├── main.board-outer (flex: 1)
│       │   ├── .filter-bar
│       │   └── .board (flex, 横並びカラム)
│       └── app-comment-panel (@if selectedTask()で条件表示)
```

### モバイル (≤768px)
```
header (48px)
├── .app (display: flex, flex-direction: column, grid-template-columns: 1fr)
│   ├── .sidebar → display: none
│   └── .board-with-panel (flex-direction: column)
│       ├── main.board-outer
│       │   ├── .filter-bar (flex-wrap)
│       │   └── .board (flex-direction: column, 縦並び)
│       └── app-comment-panel (position: fixed, inset: 0, z-index: 300)
bottom-nav (56px)
```

### テンプレートのインラインスタイル
```html
<div class="app"
  [style.grid-template-columns]="isMobile() ? '1fr' : (sidebarCollapsed() ? '48px 1fr' : '260px 1fr')"
>
```

### isMobile signal
```typescript
isMobile = signal(typeof window !== 'undefined' && window.innerWidth <= 768);
@HostListener('window:resize')
onResize() {
  this.isMobile.set(window.innerWidth <= 768);
}
```

## 済み（修正完了）

### 1. リアクション Firebase permission error
- **原因**: Firestore ルールの comments サブコレクションに `allow update` がなかった
- **修正**: ユーザーが Firestore ルールに `allow update: if isSignedIn()` を追加。コードは `toggleReaction` を delete+recreate から `updateDoc` に変更

### 2. フィルターバーのレイアウト
- **原因**: ソート・コンパクト・スイムレーンのコントロールがフィルターバーの中央に表示されていた
- **修正**: `<div class="toolbar-right">` で囲み `margin-left: auto` で右寄せ

### 3. モバイル白画面（400px）— 未確認（修正デプロイ済み、ユーザー確認待ち）
- **原因分析**: `<app-comment-panel>` が常にDOMに存在し、320px幅の `.panel` がビューポートを圧迫。親SCSSからの `app-comment-panel` セレクタがAngularのビューカプセル化で適用されない可能性
- **修正内容**:
  1. `board.component.html`: `<app-comment-panel>` を `@if (selectedTask())` で囲み、未選択時はDOM除去
  2. `board.component.html`: インラインスタイル `grid-template-columns` のモバイル値を `null` → `'1fr'` に変更
  3. `board.component.scss`: `.board-outer` のモバイルスタイルに `!important` 追加（width: 100%等）
  4. `comment-panel.scss`: コメントパネル自身のSCSSにモバイル用 `:host { position: fixed; inset: 0 }` と `.panel { width: 100% }` を追加

### 4. リアクションUIをSlack風ピルスタイルに変更
- **修正内容**:
  - `.reaction-chip`: `border-radius: 100px`（完全角丸ピル）、ホバーで `scale(1.06)`、自分のリアクションはアクセントカラー縁取り
  - カウント表示: `<span class="reaction-count">` で分離、`font-variant-numeric: tabular-nums`
  - `.reaction-add-btn`: `😊+` → `+` の丸型ボタン（`dashed border`、ホバーで `solid` + アクセントカラー）
  - `.emoji-picker`: 角丸拡大、シャドウ強化

## 残タスク（ユーザーが1つずつ進めたいと言っている）

1. **サイドバーの並び替えをSettings/Dashboard画面にも反映**
   - サイドバーで人の順番を並び替えたら、Settings画面・Dashboard画面・絞り込みのところも名前順が変わるように
   - Settings画面とDashboard画面でも並び替えができるとベスト

2. **サイドバー・コメントパネルの幅変更ができるように**
   - ドラッグでリサイズできるようにする

3. **画面サイズ変更時の対応**
   - ウィンドウリサイズ時のレスポンシブ対応の改善

4. **コンパクト表示でタスク詳細ポップオーバー + 進む/戻すボタン**
   - コンパクト表示でタスクをクリックすると詳細が見られるようにしたい
   - コンパクト画面だと「進む」「戻す」ボタンがないから不便

5. **コンパクト画面でD&D時に全体が文字列として表示される問題**
   - ドラッグ中にプレビューが文字列になってしまう

6. **カレンダーでD&Dで締め切り変更**
   - 既存カレンダー画面があるはず（ただし `src/app/features/` 配下にcalendar関連ファイルは見つからなかった）

## ファイル転送の手順
クラウドワークスペースで修正 → `/mnt/user-data/outputs/` に出力 → `SendUserFile` → `device_commit_files` で `C:\Users\pluser1\Desktop\task-app\...` に書き込み

## 注意事項
- ユーザーは日本語でやり取り
- Angular のビューカプセル化に注意：親コンポーネントのSCSSから子コンポーネントのホスト要素を直接スタイリングする場合、セレクタが `_ngcontent` 属性で制限される
- `styles.scss` にグローバルテーマ変数（`--ink`, `--muted`, `--line`, `--active`, `--bg`, `--card` 等）あり
- コンポーネントSCSSでは SCSS変数（`$ink`, `$active` 等）をファイル冒頭で定義して使用
