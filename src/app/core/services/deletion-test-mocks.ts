import { vi } from 'vitest';

export const deletionMocks = vi.hoisted(() => ({
  invoke: vi.fn(), doc: vi.fn(() => ({})), getDoc: vi.fn(),
  deleteDoc: vi.fn().mockResolvedValue(undefined), setDoc: vi.fn().mockResolvedValue(undefined),
  updateDoc: vi.fn().mockResolvedValue(undefined),
  getDocs: vi.fn(), query: vi.fn(() => ({})),
  runTransaction: vi.fn(async (_firestore: unknown, callback: any) => callback({ get: deletionMocks.getDoc, update: deletionMocks.updateDoc })),
  ref: vi.fn(() => ({})), deleteObject: vi.fn(),
}));
vi.mock('firebase/firestore', async importOriginal => ({
  ...await importOriginal<typeof import('firebase/firestore')>(),
  doc: deletionMocks.doc, getDoc: deletionMocks.getDoc, deleteDoc: deletionMocks.deleteDoc, setDoc: deletionMocks.setDoc,
  updateDoc: deletionMocks.updateDoc,
  getDocs: deletionMocks.getDocs, query: deletionMocks.query,
  runTransaction: deletionMocks.runTransaction,
}));
vi.mock('@angular/fire/storage', async importOriginal => ({
  ...await importOriginal<typeof import('@angular/fire/storage')>(),
  ref: deletionMocks.ref, deleteObject: deletionMocks.deleteObject,
}));
vi.mock('firebase/functions', async importOriginal => ({
  ...await importOriginal<typeof import('firebase/functions')>(),
  httpsCallable: () => deletionMocks.invoke,
}));
