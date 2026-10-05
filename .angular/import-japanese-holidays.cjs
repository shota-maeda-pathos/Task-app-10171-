const fs=require('fs'),base='src/app/features/settings/';let s=fs.readFileSync('src/app/core/services/tasks.service.ts','utf8');s=s.replace('  writeBatch,','  writeBatch,\n  runTransaction,');s=s.replace('  async removeHoliday(date: string): Promise<void> {',`  async addHolidays(holidays: TeamHoliday[]): Promise<number> {
    return runTransaction(this.firestore, async transaction => {
      const snapshot = await transaction.get(this.teamSettingsDoc);
      const current = (snapshot.data()?.['holidays'] ?? []) as TeamHoliday[];
      const dates = new Set(current.map(holiday => holiday.date));
      const added = holidays.filter(holiday => {
        if (dates.has(holiday.date)) return false;
        dates.add(holiday.date);
        return true;
      });
      if (added.length > 0) {
        transaction.set(this.teamSettingsDoc, {
          holidays: [...current, ...added].sort((a, b) => a.date.localeCompare(b.date)),
        }, { merge: true });
      }
      return added.length;
    });
  }

  async removeHoliday(date: string): Promise<void> {`);fs.writeFileSync('src/app/core/services/tasks.service.ts',s);
s=fs.readFileSync(base+'settings.ts','utf8');s=s.replace('  holidayEditorOpen = signal(false);',`  readonly holidayCurrentYear = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', year: 'numeric' }).format(new Date()));
  readonly holidayImportYears = [this.holidayCurrentYear - 1, this.holidayCurrentYear, this.holidayCurrentYear + 1];
  holidayImportYear = this.holidayCurrentYear;
  importingHolidays = signal(false);

  async importJapaneseHolidays(): Promise<void> {
    if (!this.isManager() || this.importingHolidays()) return;
    const year = Number(this.holidayImportYear);
    if (!this.holidayImportYears.includes(year)) return;
    this.importingHolidays.set(true);
    try {
      const response = await fetch('https://holidays-jp.github.io/api/v1/date.json', {
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error('祝日データの取得に失敗しました');
      const data: unknown = await response.json();
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('祝日データの形式が不正です');
      const holidays = Object.entries(data).filter(([date]) => date.startsWith(year + '-')).map(([date, name]) => {
        if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(date) || typeof name !== 'string' || !name.trim()
          || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
          throw new Error('祝日データの形式が不正です');
        }
        return { date, name: name.trim() };
      });
      if (holidays.length === 0) throw new Error(year + '年の祝日データは公開されていません');
      const count = await this.tasksService.addHolidays(holidays);
      this.notificationService.show('祝日の一括登録', count ? year + '年の祝日を' + count + '日追加しました' : year + '年の祝日はすべて登録済みです');
    } catch (error) {
      console.error('祝日一括登録エラー:', error);
      this.notificationService.show('エラー', '祝日を一括登録できませんでした。通信状況やデータの公開状況を確認して再試行してください。');
    } finally {
      this.importingHolidays.set(false);
    }
  }

  holidayEditorOpen = signal(false);`);fs.writeFileSync(base+'settings.ts',s);
s=fs.readFileSync(base+'settings.html','utf8');const anchor='      <div class="leave-editor">';const i=s.indexOf(anchor);s=s.slice(0,i)+`      <div class="holiday-import">
        <select aria-label="祝日を取得する年" [(ngModel)]="holidayImportYear" [disabled]="importingHolidays()">
          @for (year of holidayImportYears; track year) { <option [ngValue]="year">{{ year }}年</option> }
        </select>
        <button type="button" class="edit-btn" [disabled]="importingHolidays()" (click)="importJapaneseHolidays()">{{ importingHolidays() ? '取得・登録中…' : '日本の祝日を一括登録' }}</button>
        <p>登録済みの日付はそのまま残し、未登録の祝日を追加します。</p>
      </div>
`+s.slice(i);fs.writeFileSync(base+'settings.html',s);
fs.appendFileSync(base+'settings.scss',`\n.holiday-import {
  display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 16px;
  select { min-height: 36px; padding: 7px 10px; border: 1px solid var(--line); border-radius: 7px; background: var(--card); color: var(--ink); font: inherit; font-size: 12px; }
  p { flex-basis: 100%; margin: 0; color: var(--muted); font-size: 11px; }
  button:disabled { opacity: .5; cursor: default; }
}\n`);
