const fs=require('fs');const p='src/app/features/settings/settings.scss';let s=fs.readFileSync(p,'utf8');
s=s.replace('    flex-basis: calc(100% - 48px); min-width: 0; width: calc(100% - 48px);','    flex-basis: 100%; min-width: 0; width: 100%;');
s=s.replace('      width: 160px; max-width: 100%; min-height: 28px; padding: 2px 0;','      width: 100%; min-height: 28px; padding: 2px 0;');
s=s.replace('    .member-leave-body { padding-top: 8px;','    .member-leave-body { padding-top: 12px;');
s=s.replace('    .member-leaves { margin-left: 0; flex-basis: 100%; width: 100%; }','    .member-leaves { margin-left: 0; }');
fs.writeFileSync(p,s);
