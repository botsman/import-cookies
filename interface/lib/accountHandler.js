const API_BASE = 'https://devtulz.com/import-cookies/api';
const STORAGE_KEY = 'account_cache';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Manages the current user's account state.
 * Caches results in chrome.storage.session (cleared on browser close).
 * Cache is considered fresh for 1 hour; after that a background re-fetch runs.
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
   * Returns the cached account if fresh (< 1 h old), otherwise fetches from
   * the API and updates the cache.
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
   * Returns true only when the user has an active Premium subscription.
   * Checks both account_type and that expiry_date (if set) has not passed.
   * @return {Promise<boolean>}
   */
  async isPremium() {
    const account = await this.getAccount();
    if (!account || account.account_type !== 2) return false;
    if (!account.expiry_date) return true;
    return new Date(account.expiry_date) > new Date();
  }

  // --- private ---

  /**
   * Returns the cached user if the entry exists and is less than CACHE_TTL_MS
   * old. Returns undefined when the cache is missing or stale (caller should
   * fetch fresh data).
   * @return {Promise<object|null|undefined>}
   */
  async _readCache() {
    try {
      const api = this.browserDetector.getApi();
      if (!api.storage.session) return undefined;
      const result = await api.storage.session.get(STORAGE_KEY);
      if (STORAGE_KEY in result) {
        const { user, cachedAt } = result[STORAGE_KEY];
        if (Date.now() - cachedAt < CACHE_TTL_MS) {
          return user;
        }
      }
    } catch (e) {
      // storage.session not available in all contexts
    }
    return undefined;
  }

  /**
   * @param {object|null} user
   * @return {Promise<void>}
   */
  async _writeCache(user) {
    try {
      const api = this.browserDetector.getApi();
      if (!api.storage.session) return;
      await api.storage.session.set({
        [STORAGE_KEY]: { user, cachedAt: Date.now() },
      });
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
