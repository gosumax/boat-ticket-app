import { afterEach, describe, expect, it } from 'vitest';
import {
  getLocalStorageSafe,
  getSessionStorageSafe,
  getStorageItemSafe,
  removeStorageItemSafe,
  setStorageItemSafe,
} from '../../src/utils/safeWebStorage.js';

const originalWindow = global.window;

afterEach(() => {
  global.window = originalWindow;
});

describe('safe web storage guards', () => {
  it('returns null when iOS-style SecurityError blocks localStorage getter', () => {
    global.window = {
      get localStorage() {
        throw new Error('SecurityError');
      },
    };

    expect(getLocalStorageSafe()).toBeNull();
  });

  it('returns null when iOS-style SecurityError blocks sessionStorage getter', () => {
    global.window = {
      get sessionStorage() {
        throw new Error('SecurityError');
      },
    };

    expect(getSessionStorageSafe()).toBeNull();
  });

  it('reads/writes/removes values when storage is available', () => {
    const values = new Map();
    const storage = {
      getItem(key) {
        return values.get(String(key)) ?? null;
      },
      setItem(key, value) {
        values.set(String(key), String(value));
      },
      removeItem(key) {
        values.delete(String(key));
      },
    };
    global.window = {
      localStorage: storage,
    };

    const local = getLocalStorageSafe();
    expect(local).toBe(storage);
    expect(setStorageItemSafe(local, 'token', 'abc123')).toBe(true);
    expect(getStorageItemSafe(local, 'token')).toBe('abc123');
    expect(removeStorageItemSafe(local, 'token')).toBe(true);
    expect(getStorageItemSafe(local, 'token')).toBeNull();
  });
});
