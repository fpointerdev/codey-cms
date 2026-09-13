// Storage is only a browser hint; credentials remain in secure cookies or memory.
export const browserStorage = {
  getItem(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  setItem(key, value) {
    try { localStorage.setItem(key, value); } catch { /* Browser storage can be disabled. */ }
  },
  removeItem(key) {
    try { localStorage.removeItem(key); } catch { /* Sign-out still clears in-memory state. */ }
  }
};
