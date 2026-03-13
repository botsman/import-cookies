# Monetisation Implementation Plan

## Overview

Three phases, each independently shippable:

1. **Google Sign-In** — auth plumbing (extension + website + backend)
2. **Extension UI** — account state, share functionality, upgrade prompts
3. **Monetisation** — payment integration, tier enforcement

Backend base URL: `https://devtulz.com/import-cookies/api`
Extension project: `/Users/pavel/projects/import-cookies`
Website project: `/Users/pavel/projects/dev-tools`

---

## Phase 1 — Google Sign-In

### 1.1 Cloudflare infrastructure setup

Add `wrangler.toml` to the dev-tools project to configure D1 and KV bindings.

**D1 database** (`import_cookies_db`) — structured data:

```sql
-- users
CREATE TABLE users (
  id          TEXT PRIMARY KEY,          -- Google sub (stable user ID)
  email       TEXT UNIQUE NOT NULL,
  name        TEXT,
  avatar      TEXT,
  account_type INTEGER NOT NULL DEFAULT 1, -- 1=Free, 2=Premium, 3=NoAds
  expiry_date TEXT,                       -- ISO date, only for type 2
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- shared cookie links
CREATE TABLE cookie_links (
  uuid        TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  title       TEXT NOT NULL,
  cookie      TEXT NOT NULL,             -- AES-encrypted base64 ciphertext
  domain      TEXT NOT NULL,
  is_public   INTEGER NOT NULL DEFAULT 1,
  exp         TEXT,                      -- e.g. "1h", "3d", "unlimited"
  expires_at  TEXT,                      -- computed absolute datetime, NULL if unlimited
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**KV namespace** (`SESSIONS`) — session tokens:
- Key: random 32-byte hex session token
- Value: JSON `{ userId, createdAt }`
- TTL: 30 days

### 1.2 Backend functions (Cloudflare Pages Functions)

All under `functions/import-cookies/api/`.

#### `auth/google/callback.js` — handles Google OAuth redirect

```
GET /import-cookies/api/auth/google/callback?code=...&state=...
```

1. Exchange `code` for Google tokens using `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` (env vars)
2. Fetch user profile from Google (`sub`, `email`, `name`, `picture`)
3. Upsert user in D1 (create if first login, update name/avatar if returning)
4. Create session token, store in KV with 30-day TTL
5. Set `__session` cookie: `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`
6. Redirect to `next` param (or `/import-cookies/login?success=true`)

#### `auth/google/login.js` — initiates OAuth flow

```
GET /import-cookies/api/auth/google/login?next=...
```

Builds Google OAuth URL with scopes `openid email profile`, stores `state` + `next` in KV (5-min TTL), redirects.

#### `auth/info.js`

```
POST /import-cookies/api/auth/info
```

Reads `__session` cookie → KV lookup → D1 user lookup.

Response:
```json
{
  "data": {
    "user": {
      "name": "...", "email": "...", "avatar": "...",
      "account_type": 1, "created_at": "...", "expiry_date": null
    }
  }
}
```
Returns `{ "data": { "user": null } }` if not authenticated (always 200).

#### `auth/logout.js`

```
GET /import-cookies/api/auth/logout
```

Deletes session from KV, clears cookie, redirects to `/import-cookies/login`.

#### `cookie/share.js`

```
POST /import-cookies/api/cookie/share
```

Auth required (403 if not), Premium required (402 if account_type ≠ 2).

Body:
```json
{
  "cookie": "<AES ciphertext>",
  "exp": "1h",
  "domain": "https://example.com",
  "is_public": true,
  "title": "My session"
}
```

Generates UUID v4, computes `expires_at` from `exp` string, inserts into D1.
Returns `200` on success, `400` on validation error.

#### `cookie/list.js`

```
GET /import-cookies/api/cookie/list?page=1
```

Auth required. Returns up to 100 records per page, ordered by `created_at DESC`.

Response:
```json
{
  "data": {
    "cookies": [
      { "uuid": "...", "domain": "...", "title": "...", "exp": "...", "is_unlimited_exp": false }
    ]
  }
}
```

#### `cookie/[uuid]/info.js`

```
GET /import-cookies/api/cookie/:uuid/info
```

No auth required for public links. Auth required for private links (403 if not owner).

Checks `expires_at` → 410 if expired.
Returns full cookie record including the encrypted `cookie` field, `owner` (user name).

#### `cookie/[uuid]/delete.js`

```
POST /import-cookies/api/cookie/:uuid/delete
```

Auth required, must own the link.

### 1.3 Website — login page

Add `src/import-cookies/login.html` — a simple page with:
- "Sign in with Google" button → `GET /import-cookies/api/auth/google/login?next=...`
- Shown after redirect from extension or payment flow

No session state needed on this page itself — it's just a landing/redirect page.

### 1.4 Extension — auth integration

**`background.js` changes:**
- On install: update `chrome.runtime.setUninstallURL` to `https://devtulz.com/import-cookies/uninstall`
- Add `onMessageExternal` case `"check_install"` (already needed if website wants to detect extension)
- Intercept `https://devtulz.com/import-cookies/cookie/link/*` → rewrite to `chrome-extension://<id>/pages/import.html?cookie_id=<uuid>`

**New module `interface/lib/accountHandler.js`:**
- Wraps `POST /import-cookies/api/auth/info`
- Caches result in `chrome.storage.session` (cleared on browser close)
- Exposes `getAccount()`, `clearAccount()`, `isLoggedIn()`, `isPremium()`
- Broadcasts `accountChanged` message to all extension contexts

**Login flow:**
- User clicks login button → `window.open('https://devtulz.com/import-cookies/login', '_blank')`
- When they return to the extension (popup re-focus / sidepanel tab activation) → re-call `getAccount()`

---

## Phase 2 — Extension UI

### 2.1 Account state in existing UI

The extension already has a popup and sidepanel. Add account awareness:

- **Login button**: shown when not logged in → opens login page
- **Account button**: shown when logged in → shows name, tier badge, logout
- **Tier badge**: "Free" / "Premium" (styled differently, like the sample)

This can be added to the existing options page or as a small widget in the popup footer.

### 2.2 Share button + form

Add a "Share" button to the popup and/or sidepanel toolbar (alongside existing Import/Export).

**Share form** (new page or modal — `interface/popup/share.html` or inline panel):
- Title (required)
- Password (required, ≥ 8 chars) — used as AES key, never sent to server
- Expiry: 1h / custom / unlimited
- Public/private toggle
- Cancel + Share buttons

**Gate logic:**
- Not logged in → show "Login to share cookies" prompt with login button
- Logged in but Free → show upgrade prompt
- Premium → show share form

### 2.3 Import page

New extension page: `interface/import/import.html` + `import.js`

- Reads `?cookie_id=` from URL
- Calls `GET /import-cookies/api/cookie/:uuid/info`
- Shows metadata: owner, domain, title, expiry
- Password input → decrypt → `chrome.cookies.set()` for each cookie → redirect to domain
- Handles error states: 404 (not found), 403 (private), 410 (expired), wrong password

### 2.4 Shared links list

New tab in the sidepanel (or section in popup): "My Links"

- Calls `GET /import-cookies/api/cookie/list?page=1`
- Lists shared links with domain favicon, title, expiry
- Copy-to-clipboard button: copies `https://devtulz.com/import-cookies/cookie/link/<uuid>`
- Delete button → `POST /api/cookie/:uuid/delete`
- "Load more" pagination (100 per page)

### 2.5 Upgrade prompt

A simple inline panel/modal shown when a Free user tries to share:
- Feature list (what Premium unlocks)
- Pricing: $3/month, $27/year
- "Upgrade" button → opens checkout URL (see Phase 3)
- No Ads tier: $1 one-off

---

## Phase 3 — Monetisation

### 3.1 Payment processor

Use **Stripe** (or LemonSqueezy as lighter alternative).

Three products:
| ID | Name | Price | Sets `account_type` |
|---|---|---|---|
| `month` | Premium Monthly | $3/mo recurring | 2 |
| `year` | Premium Yearly | $27/yr recurring | 2 |
| `no-ads` | No Ads | $1 one-off | 3 |

### 3.2 Backend functions

#### `payment/checkout/[type].js`

```
GET /import-cookies/api/payment/checkout/:type
```

Auth required (redirects to login if not).

Creates a Stripe Checkout Session:
- `success_url`: `/import-cookies/login?payment=success`
- `cancel_url`: `/import-cookies/login?payment=cancelled`
- `client_reference_id`: user ID (to match webhook)
- `customer_email`: user's email

Redirects to Stripe-hosted checkout page.

#### `payment/webhook.js`

```
POST /import-cookies/api/payment/webhook
```

Verifies Stripe webhook signature (`STRIPE_WEBHOOK_SECRET` env var).

On `checkout.session.completed`:
- Look up user by `client_reference_id`
- Update `account_type` and `expiry_date` in D1

On `customer.subscription.deleted` (for recurring):
- Downgrade `account_type` back to 1

### 3.3 Extension checkout flow

```js
// Logged in:
window.open(`https://devtulz.com/import-cookies/api/payment/checkout/${type}`, '_blank');

// Not logged in:
window.open(`https://devtulz.com/import-cookies/login?next=.../checkout/${type}`, '_blank');
```

After returning from payment, extension re-calls `getAccount()` to refresh tier.

### 3.4 Ads (Free tier)

Only needed if you want to show ads to Free users. If so:
- `accountHandler.isAdsEnabled()` returns `true` when `account_type === 1` or not logged in
- Add an ads slot in the popup/sidepanel footer (e.g. Google AdSense or a house ad)

---

## Implementation Order

```
Phase 1
  1. wrangler.toml + D1 schema + KV namespace (infrastructure)
  2. auth/google/login.js + auth/google/callback.js
  3. auth/info.js + auth/logout.js
  4. Login page (devtulz.com/import-cookies/login)
  5. accountHandler.js in extension + login/logout UI

Phase 2
  6. Share form + encryption (form_share equivalent)
  7. Import page in extension
  8. cookie/share.js + cookie/[uuid]/info.js backend
  9. cookie/list.js + cookie/[uuid]/delete.js backend
 10. Shared links list UI in extension
 11. Upgrade prompt UI

Phase 3
 12. Stripe products + webhook setup
 13. payment/checkout/[type].js + payment/webhook.js
 14. Upgrade buttons wired to checkout
 15. Subscription expiry handling
```

---

## Key Design Decisions

- **Session auth**: `HttpOnly` cookie on `devtulz.com` — extension uses `credentials: "include"`, no token storage needed in extension
- **Zero-knowledge encryption**: password never leaves the device; server only stores AES ciphertext
- **No login UI in extension**: always opens `devtulz.com/import-cookies/login` in a new tab
- **URL interception**: background script rewrites share links to internal import page (same pattern as sample)
- **Tier enforcement**: both client-side (UX) and server-side (`/api/cookie/share` rejects non-premium)
- **Cloudflare-only stack**: D1 (SQLite) for structured data, KV for sessions — no external DB needed
