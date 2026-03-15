/**
 * Cookie sharing utilities: AES-GCM encryption/decryption and API calls.
 * Zero-knowledge: the decryption key is never sent to the server.
 *
 * URL formats:
 *   No password:    .../share/<uuid>#<base64key>
 *   With password:  .../share/<uuid>#pw:<base64salt>
 *
 * Password-protected shares use PBKDF2 to derive the AES key from the
 * password + a random salt. Only the salt is embedded in the URL; the
 * password itself is never stored or transmitted.
 */

const API_BASE = 'https://devtulz.com/import-cookies/api';
const SHARE_BASE = 'https://devtulz.com/import-cookies/share';
const SHARE_URL_RE = /\/share\/([0-9a-f-]{36})#([A-Za-z0-9+/=:]+)$/;
const PBKDF2_ITERATIONS = 200000;

/**
 * Encrypts a cookies array with a random AES-GCM key.
 * @param {Array} cookies Array of cookie objects.
 * @return {Promise<{encryptedData: string, keyBase64: string}>}
 */
async function encryptCookies(cookies) {
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(cookies));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext
  );

  const rawKey = await crypto.subtle.exportKey('raw', key);
  const keyBase64 = uint8ToBase64(new Uint8Array(rawKey));
  const ivBase64 = uint8ToBase64(iv);
  const ctBase64 = uint8ToBase64(new Uint8Array(ciphertext));

  return {
    encryptedData: JSON.stringify({ iv: ivBase64, ct: ctBase64 }),
    keyBase64,
  };
}

/**
 * Decrypts an encrypted cookie payload.
 * @param {string} encryptedDataStr JSON string with {iv, ct} fields (base64).
 * @param {string} keyBase64 Base64-encoded AES-GCM key.
 * @return {Promise<Array>} Decrypted cookies array.
 */
async function decryptCookies(encryptedDataStr, keyBase64) {
  const { iv: ivBase64, ct: ctBase64 } = JSON.parse(encryptedDataStr);
  const rawKey = base64ToUint8(keyBase64);
  const iv = base64ToUint8(ivBase64);
  const ct = base64ToUint8(ctBase64);

  const key = await crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ct
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}

/**
 * Derives an AES-GCM key from a password and salt using PBKDF2.
 * @param {string} password
 * @param {Uint8Array} salt
 * @return {Promise<CryptoKey>}
 */
async function deriveKeyFromPassword(password, salt) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts a cookies array using a user-provided password (PBKDF2 + AES-GCM).
 * The salt — not the password — is embedded in the share URL.
 * @param {Array} cookies
 * @param {string} password
 * @return {Promise<{encryptedData: string, saltBase64: string}>}
 */
async function encryptCookiesWithPassword(cookies, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKeyFromPassword(password, salt);

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(cookies));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext
  );

  return {
    encryptedData: JSON.stringify({
      iv: uint8ToBase64(iv),
      ct: uint8ToBase64(new Uint8Array(ciphertext)),
    }),
    saltBase64: uint8ToBase64(salt),
  };
}

/**
 * Decrypts a password-protected cookie payload.
 * @param {string} encryptedDataStr JSON string with {iv, ct} fields (base64).
 * @param {string} password
 * @param {string} saltBase64 Base64-encoded PBKDF2 salt (from URL fragment).
 * @return {Promise<Array>} Decrypted cookies array.
 */
async function decryptCookiesWithPassword(
  encryptedDataStr,
  password,
  saltBase64
) {
  const salt = base64ToUint8(saltBase64);
  const key = await deriveKeyFromPassword(password, salt);

  const { iv: ivBase64, ct: ctBase64 } = JSON.parse(encryptedDataStr);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToUint8(ivBase64) },
    key,
    base64ToUint8(ctBase64)
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}

/**
 * Uploads encrypted cookies to the server and returns the share UUID.
 * @param {Object} opts
 * @param {string} opts.encryptedData
 * @param {string} opts.title
 * @param {string} opts.domain
 * @param {string} opts.exp e.g. '1h', '3d', '7d', '30d', 'unlimited'
 * @param {boolean} opts.isPublic
 * @return {Promise<string>} UUID
 */
async function shareCookies({ encryptedData, title, domain, exp, isPublic }) {
  const resp = await fetch(`${API_BASE}/cookie/share`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cookie: encryptedData,
      title,
      domain,
      exp,
      is_public: isPublic,
    }),
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error(json.error || 'Share failed');
  return json.data.uuid;
}

/**
 * Fetches shared cookie metadata + encrypted payload from the server.
 * @param {string} uuid
 * @return {Promise<Object>} data object from API
 */
async function fetchSharedInfo(uuid) {
  const resp = await fetch(`${API_BASE}/cookie/${uuid}/info`, {
    credentials: 'include',
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error(json.error || 'Failed to fetch shared cookies');
  return json.data;
}

/**
 * Lists the current user's shared cookie links.
 * @param {number} page
 * @return {Promise<Array>}
 */
async function listSharedCookies(page = 1) {
  const resp = await fetch(`${API_BASE}/cookie/list?page=${page}`, {
    credentials: 'include',
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error(json.error || 'Failed to list shared cookies');
  return json.data.cookies;
}

/**
 * Deletes a shared cookie link.
 * @param {string} uuid
 */
async function deleteSharedCookie(uuid) {
  const resp = await fetch(`${API_BASE}/cookie/${uuid}/delete`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!resp.ok) {
    const json = await resp.json();
    throw new Error(json.error || 'Failed to delete shared cookie');
  }
}

/**
 * Builds the full shareable URL from a UUID and fragment (key or pw:<salt>).
 * @param {string} uuid
 * @param {string} fragment keyBase64 or 'pw:<saltBase64>'
 * @return {string}
 */
function buildShareUrl(uuid, fragment) {
  return `${SHARE_BASE}/${uuid}#${fragment}`;
}

/**
 * Parses a share URL.
 * Returns {uuid, keyBase64} for unprotected links, or
 * {uuid, saltBase64, passwordProtected: true} for password-protected links.
 * Returns null if the URL does not match.
 * @param {string} url
 * @return {Object|null}
 */
function parseShareUrl(url) {
  const match = url.trim().match(SHARE_URL_RE);
  if (!match) return null;
  const fragment = match[2];
  if (fragment.startsWith('pw:')) {
    return {
      uuid: match[1],
      saltBase64: fragment.slice(3),
      passwordProtected: true,
    };
  }
  return { uuid: match[1], keyBase64: fragment, passwordProtected: false };
}

/**
 * Converts a Uint8Array to a base64 string.
 * @param {Uint8Array} bytes
 * @return {string}
 */
function uint8ToBase64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Converts a base64 string to a Uint8Array.
 * @param {string} b64
 * @return {Uint8Array}
 */
function base64ToUint8(b64) {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

export {
  buildShareUrl,
  decryptCookies,
  decryptCookiesWithPassword,
  deleteSharedCookie,
  encryptCookies,
  encryptCookiesWithPassword,
  fetchSharedInfo,
  listSharedCookies,
  parseShareUrl,
  shareCookies,
};
