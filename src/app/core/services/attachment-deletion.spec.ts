import { Injector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteDoc, getDoc, setDoc } from 'firebase/firestore';
import { deleteObject } from '@angular/fire/storage';
import { TasksService } from './tasks.service';
import './deletion-test-mocks';

describe('attachment deletion', () => {
  let service: TasksService;

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({});
    service = Object.create(TasksService.prototype);
    Object.assign(service, { firestore: {}, storage: {}, auth: { currentUser: { uid: 'author' } }, injector: TestBed.inject(Injector) });
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => ({ authorId: 'author', storagePath: 'task-attachments/task/author/file.jpg' }),
    } as any);
    vi.mocked(deleteObject).mockResolvedValue(undefined);
  });

  it('removes the attachment record after deleting the stored file', async () => {
    await service.deleteAttachment('task', 'attachment');
    expect(deleteObject).toHaveBeenCalledOnce();
    expect(deleteDoc).toHaveBeenCalledOnce();
  });

  it('removes the attachment record when the stored file is already missing', async () => {
    vi.mocked(deleteObject).mockRejectedValue({ code: 'storage/object-not-found' });
    await service.deleteAttachment('task', 'attachment');
    expect(deleteDoc).toHaveBeenCalledOnce();
  });

  it('preserves the attachment record when storage denies deletion', async () => {
    const error = { code: 'storage/unauthorized' };
    vi.mocked(deleteObject).mockRejectedValue(error);
    await expect(service.deleteAttachment('task', 'attachment')).rejects.toEqual(error);
    expect(deleteDoc).not.toHaveBeenCalled();
  });

  it('deletes legacy attachment records without a storage path', async () => {
    vi.mocked(getDoc).mockResolvedValue({ exists: () => true, data: () => ({ authorId: 'author', dataUrl: 'data:image/png;base64,' }) } as any);
    await service.deleteAttachment('task', 'attachment');
    expect(deleteObject).not.toHaveBeenCalled();
    expect(deleteDoc).toHaveBeenCalledOnce();
  });

  it('rejects deletion by another user before modifying storage or records', async () => {
    Object.assign(service, { auth: { currentUser: { uid: 'other' } } });
    await expect(service.deleteAttachment('task', 'attachment')).rejects.toMatchObject({ code: 'permission-denied' });
    expect(setDoc).not.toHaveBeenCalled();
    expect(deleteObject).not.toHaveBeenCalled();
    expect(deleteDoc).not.toHaveBeenCalled();
  });

  it('registers an owner claim before deleting an existing flat-path file', async () => {
    vi.mocked(getDoc)
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ authorId: 'author', storagePath: 'task-attachments/task/file.jpg' }) } as any)
      .mockResolvedValueOnce({ exists: () => false } as any);
    await service.deleteAttachment('task', 'attachment');
    expect(setDoc).toHaveBeenCalledWith(expect.anything(), { attachmentId: 'attachment', authorId: 'author' });
    expect(vi.mocked(setDoc).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(deleteObject).mock.invocationCallOrder[0]);
    expect(deleteDoc).toHaveBeenCalledOnce();
  });
});
