import { Injector, runInInjectionContext } from '@angular/core';
import { Auth, User, user } from '@angular/fire/auth';
import { Firestore, doc, docData } from '@angular/fire/firestore';
import { Observable, catchError, map, of, switchMap } from 'rxjs';

// Wait for onboarding before team queries, and drop access when disabled live.
export function observeActiveUser(auth: Auth, firestore: Firestore, injector: Injector): Observable<User | null> {
  return runInInjectionContext(injector, () => user(auth)).pipe(
    switchMap(firebaseUser => {
      if (!firebaseUser) return of(null);
      return runInInjectionContext(injector, () => docData(doc(firestore, 'members', firebaseUser.uid))).pipe(
        map(member => member && member['disabled'] !== true ? firebaseUser : null),
        catchError(() => of(null)),
      );
    }),
  );
}
