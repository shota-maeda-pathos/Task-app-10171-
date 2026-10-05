import { leavePeriodLabel } from './leave-utils';
import { Member, TeamHoliday } from '../models/task.model';

export interface CalendarTimeOff {
  id: string;
  kind: 'holiday' | 'leave';
  label: string;
}

export function buildCalendarTimeOff(holidays: TeamHoliday[], members: Member[], memberId?: string): Map<string, CalendarTimeOff[]> {
  const result = new Map<string, CalendarTimeOff[]>();
  const add = (date: string, entry: CalendarTimeOff) => {
    const entries = result.get(date) ?? [];
    if (!entries.some(existing => existing.id === entry.id)) entries.push(entry);
    result.set(date, entries);
  };
  for (const holiday of holidays) {
    add(holiday.date, { id: 'holiday:' + holiday.date, kind: 'holiday', label: '休日：' + holiday.name });
  }
  for (const member of members) {
    if (memberId !== undefined && member.uid !== memberId) continue;
    for (const leave of member.leaves ?? []) {
      add(leave.date, { id: 'leave:' + member.uid + ':' + leave.date, kind: 'leave', label: (memberId === undefined ? member.name + '：' : '休暇：') + (leave.label || '休暇') + (leave.period && leave.period !== 'full' ? '（' + leavePeriodLabel(leave) + '）' : '') });
    }
  }
  return result;
}
