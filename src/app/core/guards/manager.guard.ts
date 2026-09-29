import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { TasksService } from '../services/tasks.service';
import { toObservable } from '@angular/core/rxjs-interop';
import { filter, map, take } from 'rxjs/operators';

export const managerGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const tasksService = inject(TasksService);
  const router = inject(Router);

  const uid = auth.currentUser()?.uid;
  if (!uid) {
    router.navigate(['/board']);
    return false;
  }

  // メンバーデータがまだ読み込まれていない場合は待つ
  const members = tasksService.members();
  if (members.length > 0) {
    const member = members.find((m) => m.uid === uid);
    if (member?.role === 'manager') return true;
    router.navigate(['/board']);
    return false;
  }

  // メンバーが読み込まれるまで待ってから判定
  return toObservable(tasksService.members).pipe(
    filter((m) => m.length > 0),
    take(1),
    map((m) => {
      const member = m.find((mem) => mem.uid === uid);
      if (member?.role === 'manager') return true;
      router.navigate(['/board']);
      return false;
    }),
  );
};
