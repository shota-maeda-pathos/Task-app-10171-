const fs = require('fs');
for (const feature of ['my-tasks', 'dashboard']) {
  const path = `src/app/features/${feature}/${feature}.scss`;
  let css = fs.readFileSync(path, 'utf8');
  css = css.replace(/(\.cal-day\s*\{[^}]*?)text-align: right;/, '$1text-align: left;');
  fs.writeFileSync(path, css);
}
