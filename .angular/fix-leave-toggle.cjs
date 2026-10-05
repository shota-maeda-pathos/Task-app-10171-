const fs=require('fs');const base='src/app/features/settings/';let s=fs.readFileSync(base+'settings.html','utf8');
for (const [label,state,id] of [['休日','holidayEditorOpen','holiday-editor-form'],['休暇','leaveEditorOpen','leave-editor-form']]) {
const start=`<details class="leave-editor"><summary>＋ ${label}を追加</summary><div class="holiday-add-form">`;
const i=s.indexOf(start);if(i<0)throw Error(start);const end=s.indexOf('</details>',i);
const content=s.slice(i+start.length,end).replace(/<\/div>\s*$/,'');
s=s.slice(0,i)+`<div class="leave-editor">
        <button type="button" class="leave-editor-toggle" [attr.aria-expanded]="${state}()" aria-controls="${id}" (click)="${state}.update(open => !open)">＋ ${label}を追加</button>
        @if (${state}()) {
          <div id="${id}" class="holiday-add-form">${content}</div>
        }
      </div>`+s.slice(end+'</details>'.length);
}
fs.writeFileSync(base+'settings.html',s);
s=fs.readFileSync(base+'settings.ts','utf8').replace("  newHolidayDate = '';", "  holidayEditorOpen = signal(false);\n  leaveEditorOpen = signal(false);\n\n  newHolidayDate = '';");fs.writeFileSync(base+'settings.ts',s);
s=fs.readFileSync(base+'settings.scss','utf8').replace('  summary { color: var(--accent); font-size: 12px; list-style: none; width: fit-content; }\n  summary::-webkit-details-marker { display: none; }',`  .leave-editor-toggle {
    color: var(--accent); font-size: 12px; background: transparent;
    border: 1px solid var(--line); border-radius: 7px; padding: 7px 12px; min-height: 36px;
    &:hover { background: rgba(var(--accent-rgb), .08); border-color: var(--accent); }
  }`);fs.writeFileSync(base+'settings.scss',s);
s=fs.readFileSync(base+'settings.spec.ts','utf8');s=s.replace(/  it\('opens holiday and own leave forms[\s\S]*?\n  \}\);/,`  it('opens and closes holiday and own leave inputs with accessible buttons', async () => {
    const editors = fixture.nativeElement.querySelectorAll('.leave-editor');
    for (const editor of editors) {
      const toggle = editor.querySelector('.leave-editor-toggle');
      expect(editor.querySelector('input')).toBeNull();
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      toggle.click(); await fixture.whenStable();
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(editor.querySelector('input[type="date"]')).toBeTruthy();
      toggle.click(); await fixture.whenStable();
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(editor.querySelector('input')).toBeNull();
    }
  });`);
s=s.replaceAll('.leave-editor summary','.leave-editor-toggle');s=s.replace("fixture.nativeElement.querySelectorAll('.leave-editor .add-btn')[1].click()","fixture.nativeElement.querySelector('#leave-editor-form .add-btn').click()");fs.writeFileSync(base+'settings.spec.ts',s);
