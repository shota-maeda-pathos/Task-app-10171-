const fs=require('fs');const p='src/app/features/settings/settings.scss';let s=fs.readFileSync(p,'utf8');
s=s.replace('  .member-row { border-radius: 11px; padding: 18px; }','  .member-row { border-radius: 11px; padding: 10px 18px; row-gap: 0; }');
s=s.replace('      width: 100%; margin-top: 8px; padding: 7px 9px;','      width: 100%; margin-top: 4px; padding: 4px 9px;');
s=s.replace('  .leave-card, .member-settings .member-row { padding: 16px; }','  .leave-card { padding: 16px; }\n  .member-settings .member-row { padding: 10px 16px; }');
fs.writeFileSync(p,s);
