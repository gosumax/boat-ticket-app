function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function readStorageFromWindow(key) {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window[key] || null;
  } catch {
    return null;
  }
}

export function getLocalStorageSafe() {
  return readStorageFromWindow('localStorage');
}

export function getSessionStorageSafe() {
  return readStorageFromWindow('sessionStorage');
}

export function getStorageItemSafe(storage, key) {
  if (!storage) {
    return null;
  }
  try {
    return normalizeString(storage.getItem(key));
  } catch {
    return null;
  }
}

export function setStorageItemSafe(storage, key, value) {
  if (!storage) {
    return false;
  }
  const normalizedValue = normalizeString(value);
  if (!normalizedValue) {
    return false;
  }
  try {
    storage.setItem(key, normalizedValue);
    return true;
  } catch {
    return false;
  }
}

export function removeStorageItemSafe(storage, key) {
  if (!storage) {
    return false;
  }
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
