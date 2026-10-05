const fs=require('fs'),p='src/app/features/settings/settings.html';let s=fs.readFileSync(p,'utf8');s=s.replaceAll('                </div></details>','                </div>');fs.writeFileSync(p,s);
