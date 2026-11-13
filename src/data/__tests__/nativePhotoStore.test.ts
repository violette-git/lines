/// <reference types="jest" />
// persist() of an inline data URL must not resolve before the async File.write() has finished.
const mockEvents: string[] = [];

jest.mock('expo-file-system', () => {
  class Directory {
    uri: string;
    exists = true;
    constructor(...parts: unknown[]) {
      this.uri = parts.map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri)).join('/');
    }
    create() {}
  }
  class File {
    uri: string;
    exists = false;
    constructor(...parts: unknown[]) {
      this.uri = parts.map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri)).join('/');
    }
    create() {}
    delete() {}
    async write() {
      await new Promise((r) => setTimeout(r, 5));
      mockEvents.push('written');
    }
    async copy() {
      mockEvents.push('copied');
    }
    async base64() {
      return 'QUJD';
    }
  }
  return { Directory, File, Paths: { document: new Directory('file:///docs') } };
});

// eslint-disable-next-line import/first
import { createNativePhotoStore } from '@/data/nativePhotoStore';

describe('nativePhotoStore', () => {
  it('waits for the base64 write before returning the durable uri', async () => {
    mockEvents.length = 0;
    const uri = await createNativePhotoStore().persist('data:image/jpeg;base64,QUJD', 'p1');
    mockEvents.push('returned');
    expect(uri).toBe('file:///docs/photos/p1.jpg');
    expect(mockEvents).toEqual(['written', 'returned']);
  });
});
