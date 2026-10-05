import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MyTasksComponent } from '../../features/my-tasks/my-tasks';
import { DashboardComponent } from '../../features/dashboard/dashboard';
import { TasksService } from '../services/tasks.service';
import { AuthService } from '../services/auth.service';
import { NotificationService } from '../services/notification.service';
import { Member, Task } from '../models/task.model';
import { formatDateString } from './week-utils';

for (const component of [MyTasksComponent, DashboardComponent]) {
  describe(component.name + ' calendar time off', () => {
    it('shows holidays and scoped leave, updates after edits, and retains deadline tasks', async () => {
      const now = new Date();
      const date = new Date(now.getFullYear(), now.getMonth(), 12);
      const dateKey = formatDateString(date);
      const makeMember = (uid: string, name: string): Member => ({ uid, name, role: 'member', weeklyCapacityHours: 40, avatarColor: '#123456', leaves: [{ date: dateKey, label: '有給' }] });
      const members = signal([makeMember('self', '本人'), makeMember('other', '別のメンバー')]);
      const teamSettings = signal({ holidays: [{ date: dateKey, name: '会社休日' }] });
      const task = { id: 'deadline', assigneeId: 'self', parentId: null, status: '未着手', dueDate: { toDate: () => date } } as unknown as Task;
      await TestBed.configureTestingModule({ imports: [component], providers: [provideRouter([]),
        { provide: TasksService, useValue: { tasks: signal([task]), members, teamSettings } },
        { provide: AuthService, useValue: { currentUser: signal({ uid: 'self' }) } },
        { provide: NotificationService, useValue: { show: () => {} } },
      ] }).overrideComponent(component, { set: { template: '' } }).compileComponents();
      const fixture = TestBed.createComponent<MyTasksComponent | DashboardComponent>(component);
      const day = () => fixture.componentInstance.calendarMonths()[0].days.find(day => day?.day === 12)!;
      expect(day().tasks).toEqual([task]);
      expect(day().timeOff.filter(entry => entry.kind === 'holiday').map(entry => entry.label)).toEqual(['休日：会社休日']);
      expect(day().timeOff.filter(entry => entry.kind === 'leave').map(entry => entry.label)).toEqual(component === MyTasksComponent ? ['休暇：有給'] : ['本人：有給', '別のメンバー：有給']);
      members.update(list => list.map(member => ({ ...member, leaves: [] })));
      teamSettings.set({ holidays: [] });
      expect(day().timeOff).toEqual([]);
      expect(day().tasks).toEqual([task]);
      members.update(list => list.map(member => member.uid === 'self' ? { ...member, leaves: [{ date: dateKey, label: '夏季休暇' }] } : member));
      expect(day().timeOff).toHaveLength(1);
      expect(day().timeOff[0].label).toContain('夏季休暇');
    });
  });
}

