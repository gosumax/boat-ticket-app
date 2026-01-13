// src/utils/bugReporter.js
const state = {
  startedAt: new Date().toISOString(),
  network: [],
  errors: []
};

export function addNetworkLog(entry) {
  state.network.push({
    ...entry,
    time: new Date().toISOString()
  });
}

window.addEventListener('error', e => {
  state.errors.push({
    type: 'error',
    message: e.message,
    stack: e.error?.stack
  });
});

window.addEventListener('unhandledrejection', e => {
  state.errors.push({
    type: 'promise',
    message: e.reason?.message || String(e.reason)
  });
});

// глобальный fetch-перехват
const originalFetch = window.fetch;
window.fetch = async (...args) => {
  try {
    const res = await originalFetch(...args);
    return res;
  } catch (err) {
    state.errors.push({
      type: 'fetch',
      message: err.message
    });
    throw err;
  }
};

export function downloadBugReport() {
  const blob = new Blob(
    [JSON.stringify(state, null, 2)],
    { type: 'application/json' }
  );
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `bug-report-${new Date().toISOString()}.json`;
  a.click();
}
