const fs=require('fs'),p='src/app/core/services/tasks.service.ts';let s=fs.readFileSync(p,'utf8');const start=s.indexOf('      const dates = new Set(current.map(holiday => holiday.date));'),end=s.indexOf('      if (added.length > 0)',start);const logic=s.slice(start,end);s=s.slice(0,start)+'      const added = getNewHolidays(current, holidays);\n'+s.slice(end);s += '\nexport function getNewHolidays(current: TeamHoliday[], holidays: TeamHoliday[]): TeamHoliday[] {\n'+logic.replace('      const added = holidays.filter','      return holidays.filter')+'}\n';fs.writeFileSync(p,s);
fs.writeFileSync('src/app/core/services/holiday-import.spec.ts',`import { getNewHolidays } from './tasks.service';
describe('holiday bulk merge', () => {
  it('preserves existing dates and imports each new date once', () => {
    const current = [{ date: '2026-01-01', name: '独自の名称' }, { date: '2026-08-12', name: '会社休日' }];
    expect(getNewHolidays(current, [{ date: '2026-01-01', name: '元日' }, { date: '2026-01-12', name: '成人の日' }, { date: '2026-01-12', name: '成人の日' }])).toEqual([{ date: '2026-01-12', name: '成人の日' }]);
    expect(current).toEqual([{ date: '2026-01-01', name: '独自の名称' }, { date: '2026-08-12', name: '会社休日' }]);
  });
  it('adds nothing when all dates are already registered', () => {
    expect(getNewHolidays([{ date: '2026-01-01', name: '元日' }], [{ date: '2026-01-01', name: '元日' }])).toEqual([]);
  });
});\n`);
