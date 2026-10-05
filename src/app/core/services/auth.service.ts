import { Injectable, Injector, inject } from '@angular/core';
import { observeActiveUser } from './active-user';
import {
  Auth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  user,
  User,
  signInWithEmailAndPassword,
} from '@angular/fire/auth';
import { toSignal } from '@angular/core/rxjs-interop';
import { Firestore, doc, getDoc, setDoc } from '@angular/fire/firestore';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private auth = inject(Auth);
  private firestore = inject(Firestore);
  private injector = inject(Injector);

  currentUser = toSignal(observeActiveUser(this.auth, this.firestore, this.injector));

  async loginWithGoogle(): Promise<void> {
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(this.auth, provider);
    await this.ensureMemberDoc(result.user);
  }

  async loginWithEmail(email: string, password: string): Promise<void> {
    const result = await signInWithEmailAndPassword(this.auth, email, password);
    await this.ensureMemberDoc(result.user);
  }

  async logout(): Promise<void> {
    await signOut(this.auth);
  }

  private async ensureMemberDoc(firebaseUser: User): Promise<void> {
    const memberRef = doc(this.firestore, 'members', firebaseUser.uid);
    const snapshot = await getDoc(memberRef);

    if (snapshot.exists()) {
      if (snapshot.data()?.['disabled']) {
        await this.auth.signOut();
        throw new Error('このアカウントは無効化されています。管理者にお問い合わせください。');
      }
      return;
    }

    const name = firebaseUser.displayName ?? firebaseUser.email?.split('@')[0] ?? '名称未設定';

    await setDoc(memberRef, {
      uid: firebaseUser.uid,
      name,
      role: 'member',
      weeklyCapacityHours: 40,
      avatarColor: randomAvatarColor(),
    });
  }
}

function randomAvatarColor(): string {
  const palette = [
    '#4C5FD5', // 青
    '#E5484D', // 赤
    '#1F8A72', // 緑
    '#E16B16', // オレンジ
    '#8B5CF6', // 紫
    '#0EA5E9', // スカイブルー
    '#D946A8', // ピンク
    '#15B8A6', // ターコイズ
    '#F59E0B', // イエロー
    '#64748B', // スレートグレー
  ];
  return palette[Math.floor(Math.random() * palette.length)];
}
