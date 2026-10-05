const fs=require('fs');const base='src/app/features/settings/';let s=fs.readFileSync(base+'settings.scss','utf8');
s=s.replace('    .member-leave-body { padding-top: 12px; display: flex; flex-wrap: wrap; gap: 8px; }','    .member-leave-body { padding-top: 4px; display: flex; flex-wrap: wrap; gap: 6px; }');
s=s.replace('    .member-leave-add-form { width: 100%; }',`    .member-leave-add-form {
      width: 100%; margin-top: 0; gap: 6px;
      input { min-height: 30px; height: 30px; padding: 5px 8px; }
      .add-btn, .cancel-btn-sm {
        min-height: 30px; padding: 5px 10px; border-radius: 7px;
        border: 1px solid var(--line); font: inherit; font-size: 12px;
        line-height: 18px; white-space: nowrap; cursor: pointer;
      }
      .add-btn {
        background: var(--accent); border-color: var(--accent); color: #fff;
        &:hover:not(:disabled) { background: var(--accent-hover); border-color: var(--accent-hover); }
        &:disabled { opacity: .4; cursor: default; }
      }
      .cancel-btn-sm {
        background: var(--card); color: var(--muted);
        &:hover { border-color: var(--accent); color: var(--accent); }
      }
    }`);
s=s.replace('    .cancel-btn-sm { min-width: 32px; min-height: 32px; }','');
fs.writeFileSync(base+'settings.scss',s);
s=fs.readFileSync(base+'settings.html','utf8').replaceAll('<button class="cancel-btn-sm" aria-label="休暇の追加をキャンセル" (click)="addMemberLeaveTarget = null">✕</button>','<button type="button" class="cancel-btn-sm" aria-label="休暇の追加をキャンセル" (click)="addMemberLeaveTarget = null">キャンセル</button>');fs.writeFileSync(base+'settings.html',s);
