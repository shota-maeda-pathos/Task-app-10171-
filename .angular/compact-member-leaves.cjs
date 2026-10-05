const fs = require('fs');
const path = 'src/app/features/settings/settings.scss';
let css = fs.readFileSync(path, 'utf8');
css = css.replace('    flex-basis: 100%; min-width: 0; width: 100%;\n    margin: 14px 0 0 48px; padding: 10px 0 0;', '    flex-basis: calc(100% - 48px); min-width: 0; width: calc(100% - 48px);\n    margin: 8px 0 0 48px; padding: 4px 0 0;');
css = css.replace('      width: 100%; min-height: 36px; padding: 4px 0;', '      width: 160px; max-width: 100%; min-height: 28px; padding: 2px 0;');
css = css.replace('.member-leave-body { padding-top: 12px;', '.member-leave-body { padding-top: 8px;');
css = css.replace('    .member-leaves { margin-left: 0; }', '    .member-leaves { margin-left: 0; flex-basis: 100%; width: 100%; }');
fs.writeFileSync(path, css);
