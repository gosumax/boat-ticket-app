import { normalizeString } from './mini-app-identity.js';

function resolveRuntimeClipboard(runtimeNavigator = null, runtimeWindow = null) {
  return runtimeNavigator?.clipboard ?? runtimeWindow?.navigator?.clipboard ?? null;
}

function restoreActiveElementFocus(activeElement) {
  if (!activeElement || typeof activeElement.focus !== 'function') {
    return;
  }

  try {
    activeElement.focus({ preventScroll: true });
  } catch {
    activeElement.focus();
  }
}

function copyMiniAppTextViaExecCommand(text, runtimeDocument = null) {
  if (!runtimeDocument || typeof runtimeDocument.createElement !== 'function') {
    return false;
  }

  const body = runtimeDocument.body;
  if (
    !body ||
    typeof body.appendChild !== 'function' ||
    typeof body.removeChild !== 'function'
  ) {
    return false;
  }

  const textArea = runtimeDocument.createElement('textarea');
  if (!textArea) {
    return false;
  }

  const activeElement = runtimeDocument.activeElement;
  textArea.value = text;
  textArea.setAttribute?.('readonly', '');
  textArea.setAttribute?.('aria-hidden', 'true');

  if (textArea.style) {
    textArea.style.position = 'fixed';
    textArea.style.top = '0';
    textArea.style.left = '0';
    textArea.style.width = '1px';
    textArea.style.height = '1px';
    textArea.style.opacity = '0';
    textArea.style.pointerEvents = 'none';
  }

  body.appendChild(textArea);

  try {
    try {
      textArea.focus?.({ preventScroll: true });
    } catch {
      textArea.focus?.();
    }

    textArea.select?.();
    textArea.setSelectionRange?.(0, text.length);

    return (
      typeof runtimeDocument.execCommand === 'function' &&
      runtimeDocument.execCommand('copy') === true
    );
  } catch {
    return false;
  } finally {
    body.removeChild(textArea);
    restoreActiveElementFocus(activeElement);
  }
}

export async function copyMiniAppTextToClipboard(
  text,
  {
    runtimeWindow = typeof window !== 'undefined' ? window : null,
    runtimeNavigator = typeof navigator !== 'undefined' ? navigator : null,
    runtimeDocument = typeof document !== 'undefined' ? document : null,
  } = {}
) {
  const normalizedText = normalizeString(text);
  if (!normalizedText) {
    return false;
  }

  const clipboard = resolveRuntimeClipboard(runtimeNavigator, runtimeWindow);
  if (clipboard && typeof clipboard.writeText === 'function') {
    try {
      await clipboard.writeText(normalizedText);
      return true;
    } catch {
      // Continue to the DOM-based fallback for constrained webviews.
    }
  }

  return copyMiniAppTextViaExecCommand(
    normalizedText,
    runtimeDocument ?? runtimeWindow?.document ?? null
  );
}
