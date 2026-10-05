import { getNewHolidays } from './tasks.service';
describe('holiday bulk merge', () => {
  it('preserves existing dates and imports each new date once', () => {
    const current = [{ date: '2026-01-01', name: '独自の名称' }, { date: '2026-08-12', name: '会社休日' }];
    expect(getNewHolidays(current, [{ date: '2026-01-01', name: '元日' }, { date: '2026-01-12', name: '成人の日' }, { date: '2026-01-12', name: '成人の日' }])).toEqual([{ date: '2026-01-12', name: '成人の日' }]);
    expect(current).toEqual([{ date: '2026-01-01', name: '独自の名称' }, { date: '2026-08-12', name: '会社休日' }]);
  });
  it('adds nothing when all dates are already registered', () => {
    expect(getNewHolidays([{ date: '2026-01-01', name: '元日' }], [{ date: '2026-01-01', name: '元日' }])).toEqual([]);
  });
});
