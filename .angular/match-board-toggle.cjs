const fs=require('fs'); const base='src/app/features/settings/';let s=fs.readFileSync(base+'settings.scss','utf8');
s=s.replace('    margin: 8px 0 0 48px; padding: 4px 0 0;\n    border-top: 1px solid var(--line);','    margin: 0 0 0 48px; padding: 0;\n    border-top: 0;');
s=s.replace('      width: 100%; min-height: 28px; padding: 2px 0;\n      border: 0; background: transparent; text-align: left;\n      font-size: 12px; color: var(--muted);\n      &:hover { color: var(--accent); }',`      width: 100%; margin-top: 8px; padding: 7px 9px;
      border: 0; border-radius: 7px; background: transparent; text-align: left;
      font: inherit; font-size: 11px; color: var(--muted);
      &:hover { background: rgba(var(--accent-rgb), 0.06); }
    }
    .member-leaves-chevron {
      width: 14px; height: 14px; flex: 0 0 14px;
      transition: transform 0.15s ease;
      &.collapsed { transform: rotate(-90deg); }`);
fs.writeFileSync(base+'settings.scss',s);
s=fs.readFileSync(base+'settings.html','utf8');s=s.replaceAll(`<span aria-hidden="true">{{ expandedMemberLeaves().has(member.uid) ? '⌃' : '⌄' }}</span>`,`<svg class="member-leaves-chevron"
                  [class.collapsed]="!expandedMemberLeaves().has(member.uid)"
                  viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>`);fs.writeFileSync(base+'settings.html',s);
