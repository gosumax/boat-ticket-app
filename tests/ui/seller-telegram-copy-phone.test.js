import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadCopyHelper() {
  if (!globalThis.window) {
    globalThis.window = {
      addEventListener: () => {},
      removeEventListener: () => {},
      localStorage: {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
      },
    };
  }
  if (!globalThis.document) {
    globalThis.document = {
      createElement: () => ({
        setAttribute: () => {},
        style: {},
        select: () => {},
      }),
      body: {
        appendChild: () => {},
        removeChild: () => {},
      },
      execCommand: () => true,
    };
  }

  const module = await import('../../src/views/SellerTelegramRequests.jsx');
  return module.copyTextToClipboard;
}

describe('seller telegram copy phone helper', () => {
  afterEach(() => {
    if (globalThis.navigator) {
      Reflect.deleteProperty(globalThis, 'navigator');
    }
    if (globalThis.window) {
      Reflect.deleteProperty(globalThis, 'window');
    }
    if (globalThis.document) {
      Reflect.deleteProperty(globalThis, 'document');
    }
  });

  it('returns false for empty values', async () => {
    const copyTextToClipboard = await loadCopyHelper();
    await expect(copyTextToClipboard('')).resolves.toBe(false);
    await expect(copyTextToClipboard('   ')).resolves.toBe(false);
  });

  it('uses Clipboard API when available', async () => {
    const copyTextToClipboard = await loadCopyHelper();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        clipboard: {
          writeText,
        },
      },
      configurable: true,
      writable: true,
    });

    const result = await copyTextToClipboard('+79990001122');
    expect(result).toBe(true);
    expect(writeText).toHaveBeenCalledWith('+79990001122');
  });
});
