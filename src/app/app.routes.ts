import { Routes } from '@angular/router';
import { BoardComponent } from './features/board/board.component';

export const routes: Routes = [
  { path: '', redirectTo: 'board', pathMatch: 'full' },
  { path: 'board', component: BoardComponent },
  {
    path: 'my-tasks',
    loadComponent: () => import('./features/my-tasks/my-tasks').then((m) => m.MyTasksComponent),
  },
  {
    path: 'dashboard',
    loadComponent: () => import('./features/dashboard/dashboard').then((m) => m.DashboardComponent),
  },
  {
    path: 'settings',
    loadComponent: () => import('./features/settings/settings').then((m) => m.SettingsComponent),
  },
];
