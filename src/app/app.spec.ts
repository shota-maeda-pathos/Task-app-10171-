import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideFirebaseApp, initializeApp } from '@angular/fire/app';
import { provideAuth, getAuth } from '@angular/fire/auth';
import { provideFirestore, getFirestore } from '@angular/fire/firestore';
import { provideStorage, getStorage } from '@angular/fire/storage';
import { provideFunctions, getFunctions } from '@angular/fire/functions';
import { environment } from '../environments/environment';
import { App } from './app';
import { vi } from 'vitest';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),
        provideFirebaseApp(() => initializeApp(environment.firebase)),
        provideAuth(() => getAuth()),
        provideFirestore(() => getFirestore()),
        provideStorage(() => getStorage()),
        provideFunctions(() => getFunctions(undefined, 'asia-northeast1')),
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });
});

describe('account navigation', () => {
  function setup() {
    return Object.assign(Object.create(App.prototype), {
      auth: { loginWithEmail: vi.fn().mockResolvedValue(undefined), loginWithGoogle: vi.fn().mockResolvedValue(undefined), logout: vi.fn().mockResolvedValue(undefined) },
      router: { url: '/settings', navigate: vi.fn().mockResolvedValue(true) }, emailInput: 'test@example.com', passwordInput: 'password',
      initialNavigationHandled: false,
    });
  }
  it('opens Home after successful email login instead of the previous account route', async () => {
    const app = setup();
    await app.loginWithEmail();
    expect(app.router.navigate).toHaveBeenCalledWith(['/board'], { replaceUrl: true });
    expect(app.passwordInput).toBe('');
  });
  it('does not navigate when email authentication fails', async () => {
    const app = setup();
    app.auth.loginWithEmail.mockRejectedValue(new Error('unauthorized'));
    await app.loginWithEmail();
    expect(app.router.navigate).not.toHaveBeenCalled();
    expect(app.loginError).toBeTruthy();
  });
  it('resets the route only after signing out', async () => {
    const app = setup();
    let finish!: () => void;
    app.auth.logout.mockReturnValue(new Promise<void>(resolve => finish = resolve));
    const pending = app.onLogout();
    expect(app.router.navigate).not.toHaveBeenCalled();
    finish(); await pending;
    expect(app.router.navigate).toHaveBeenCalledWith(['/board'], { replaceUrl: true });
  });
  it('opens Home after successful Google login', async () => {
    const app = setup();
    await app.loginWithGoogle();
    expect(app.router.navigate).toHaveBeenCalledWith(['/board'], { replaceUrl: true });
  });
  it('opens Home once after restoring a signed-in session', () => {
    const app = setup();
    app.openHomeOnStartup(null);
    expect(app.router.navigate).not.toHaveBeenCalled();
    app.openHomeOnStartup('user');
    expect(app.router.navigate).toHaveBeenCalledWith(['/board'], { replaceUrl: true });
    app.router.navigate.mockClear();
    app.router.url = '/settings';
    app.openHomeOnStartup('user');
    expect(app.router.navigate).not.toHaveBeenCalled();
  });
  it('preserves a Home task link when opening the app', () => {
    const app = setup();
    app.router.url = '/board?taskId=task';
    app.openHomeOnStartup('user');
    expect(app.router.navigate).not.toHaveBeenCalled();
  });
});
