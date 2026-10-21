/* Injected at document start, in the app's main frame only. */
(() => {
  const pending = new Map(), listeners = new Map();
  let sequence = 0;
  window.__nativeReply = (id, value, error) => {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    if (error) entry.reject(new Error(error)); else entry.resolve(value);
  };
  window.__nativeEvent = (name, value) => {
    for (const callback of listeners.get(name) || []) callback(value);
  };
  const invoke = (method, args) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, {resolve, reject});
    window.webkit.messageHandlers.slopamp.postMessage(JSON.stringify({id, method, args}));
  });
  const methods = 'describeFiles openDialog savePlaylist quickSaveAll quickSave plList plOpen plDelete loadPlaylist dlInfo dlStart dlCancel dlChooseDir dlResetDirs dlOpenDir dlLookup dlRemember dlmList dlmDelete dlmCleanMissing dlForget filesExist trashFile listSubs openSubDialog prepare loadState saveState webMeta openExternal showInFolder minimize maximize close setFullscreen restoreSize setMini info updGet updCheck updMode updDownload updCancel updInstall updSkip updDismiss updPage'.split(' ');
  const api = Object.fromEntries(methods.map(method => [method, (...args) => invoke(method, args)]));
  for (const [method, event] of Object.entries({onDl:'dl', onMediaKey:'media-key', onUpd:'upd', onFullscreen:'fullscreen', onOpenFiles:'open-files'})) {
    api[method] = callback => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(callback);
    };
  }
  api.platform = 'darwin';
  // Finder drops are handled natively: WebKit deliberately conceals File paths.
  api.pathForFile = () => '';
  window.phosphor = Object.freeze(api);
  window.addEventListener('unhandledrejection', event => {
    console.error(event.reason);
    if (typeof toast === 'function') toast(String(event.reason.message || event.reason), 6000);
  });
})();
