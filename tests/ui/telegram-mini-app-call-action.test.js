import { describe, expect, it, vi } from 'vitest';
import { copyMiniAppTextToClipboard } from '../../src/telegram/mini-app-clipboard.js';

describe('telegram mini app buyer seller-phone copy action', () => {
  it('uses navigator.clipboard.writeText with the exact seller phone when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    const copied = await copyMiniAppTextToClipboard('+7 (999) 555-44-33', {
      runtimeNavigator: {
        clipboard: {
          writeText,
        },
      },
      runtimeDocument: null,
    });

    expect(copied).toBe(true);
    expect(writeText).toHaveBeenCalledWith('+7 (999) 555-44-33');
  });

  it('falls back to execCommand copy when clipboard api is unavailable', async () => {
    const textArea = {
      value: '',
      style: {},
      setAttribute: vi.fn(),
      focus: vi.fn(),
      select: vi.fn(),
      setSelectionRange: vi.fn(),
    };
    const appendChild = vi.fn();
    const removeChild = vi.fn();
    const execCommand = vi.fn(() => true);
    const activeElement = {
      focus: vi.fn(),
    };

    const copied = await copyMiniAppTextToClipboard('+79995554433', {
      runtimeNavigator: {},
      runtimeDocument: {
        activeElement,
        body: {
          appendChild,
          removeChild,
        },
        createElement: vi.fn(() => textArea),
        execCommand,
      },
    });

    expect(copied).toBe(true);
    expect(appendChild).toHaveBeenCalledWith(textArea);
    expect(textArea.value).toBe('+79995554433');
    expect(textArea.select).toHaveBeenCalled();
    expect(textArea.setSelectionRange).toHaveBeenCalledWith(0, 12);
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(removeChild).toHaveBeenCalledWith(textArea);
    expect(activeElement.focus).toHaveBeenCalled();
  });

  it('falls back to execCommand copy when clipboard writeText rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('SecurityError'));
    const execCommand = vi.fn(() => true);

    const copied = await copyMiniAppTextToClipboard('+79995554433', {
      runtimeNavigator: {
        clipboard: {
          writeText,
        },
      },
      runtimeDocument: {
        activeElement: null,
        body: {
          appendChild: vi.fn(),
          removeChild: vi.fn(),
        },
        createElement: vi.fn(() => ({
          value: '',
          style: {},
          setAttribute: vi.fn(),
          focus: vi.fn(),
          select: vi.fn(),
          setSelectionRange: vi.fn(),
        })),
        execCommand,
      },
    });

    expect(copied).toBe(true);
    expect(writeText).toHaveBeenCalledWith('+79995554433');
    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('returns false when seller phone is missing', async () => {
    await expect(copyMiniAppTextToClipboard('   ', {})).resolves.toBe(false);
  });
});
