const API_BASE = 'https://devtulz.com/import-cookies/api';
const STORAGE_KEY = 'account_cache';

/**
 * Manages the current user's account state.
 * Caches results in chrome.storage.session (cleared on browser close).
 * Broadcasts 'accountChanged' to all extension contexts on change.
 */
export class AccountHandler {
  /**
   * @param {object} browserDetector
   */
  constructor(browserDetector) {
    this.browserDetector = browserDetector;
    this._account = null;
  }

  /**
   * Returns the cached account, or fetches from the API if not cached.
   * @return {Promise<object|null>}
   */
  async getAccount() {
    const cached = await this._readCache();
    if (cached !== undefined) return cached;
    return this.refreshAccount();
  }

  /**
   * Forces a fresh fetch from the API, updates cache, broadcasts change.
   * @return {Promise<object|null>}
   */
  async refreshAccount() {
    let user = null;
    try {
      const resp = await fetch(`${API_BASE}/auth/info`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      if (resp.ok) {
        const json = await resp.json();
        user = json?.data?.user ?? null;
      }
    } catch (e) {
      console.error('AccountHandler: failed to fetch account info', e);
    }
    await this._writeCache(user);
    this._broadcast(user);
    return user;
  }

  /**
   * Clears the cached account state (does not log out server-side).
   */
  async clearAccount() {
    await this._writeCache(null);
    this._broadcast(null);
  }

  /**
   * @return {Promise<boolean>}
   */
  async isLoggedIn() {
    const account = await this.getAccount();
    return account !== null;
  }

  /**
   * @return {Promise<boolean>}
   */
  async isPremium() {
    const account = await this.getAccount();
    return account?.account_type === 2;
  }

  // --- private ---

  /**
   * @return {Promise<*>}
   */
  async _readCache() {
    try {
      const api = this.browserDetector.getApi();
      if (!api.storage.session) return undefined;
      const result = await api.storage.session.get(STORAGE_KEY);
      if (STORAGE_KEY in result) {
        return result[STORAGE_KEY];
      }
    } catch (e) {
      // storage.session not available in all contexts
    }
    return undefined;
  }

  /**
   * @param {*} value
   * @return {Promise<void>}
   */
  async _writeCache(value) {
    try {
      const api = this.browserDetector.getApi();
      if (!api.storage.session) return;
      await api.storage.session.set({ [STORAGE_KEY]: value });
    } catch (e) {
      // ignore
    }
  }

  /**
   * @param {object|null} user
   */
  _broadcast(user) {
    try {
      this.browserDetector
        .getApi()
        .runtime.sendMessage({ type: 'accountChanged', params: { user } });
    } catch (e) {
      // no listeners — that's fine
    }
  }
}
