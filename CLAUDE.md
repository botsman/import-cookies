# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # Install dependencies
grunt                # Build the extension (lint + clean + copy + compress to dist/)
npm run lint         # Run ESLint only
npm run lint:fix     # Run ESLint with auto-fix
```

The `grunt` default task: syncs version from `package.json` into `manifest.chrome.json`, lints, cleans `build/chrome/`, copies source files, replaces the `@@browser_name` placeholder in `env.js`, strips console.log calls, then zips to `dist/<version>/import-cookies-chrome-<version>.zip`.

## Architecture

This is a **Manifest V3 browser extension** targeting Chrome (and cross-browser via runtime detection).

### Entry Points
- **Background service worker**: `import-cookies.js` — handles browser API calls on behalf of other contexts, manages connections via `chrome.runtime.onConnect` / `onMessage`.
- **Popup**: `interface/popup/cookie-list.html` — standard toolbar popup.
- **Side panel**: `interface/sidepanel/cookie-list.html` — Chrome side panel.
- **DevTools panel**: `interface/devtools/devtool.html` + `devtools.js` — embedded in browser devtools.
- **Options page**: `interface/options/options.html`.
- **Mobile popup**: `interface/popup-mobile/cookie-list.html` — used on Firefox for Android and Safari for iOS (switched at runtime by the background script).

### Key Design Patterns

**Browser abstraction**: `BrowserDetector` (`interface/lib/browserDetector.js`) wraps the `chrome`/`browser` namespace and exposes `supportsPromises()`, `supportsSidePanel()`, `isSafari()`, etc. All browser API calls should go through `browserDetector.getApi()` to support both callback-based and promise-based APIs.

**Build-time browser injection**: `interface/lib/env.js` contains `Env.browserName = '@@browser_name'`. The Grunt build replaces `@@browser_name` with the target browser name (e.g., `chrome`). The `BrowserDetector` constructor falls back to Chrome if the placeholder wasn't replaced (i.e., in source, outside a build).

**Cookie handler hierarchy**:
- `GenericCookieHandler` (extends `EventEmitter`) — shared CRUD logic for cookies.
- `CookieHandlerPopup` — direct browser API access; listens to `tabs.onUpdated`, `tabs.onActivated`, `cookies.onChanged`.
- `CookieHandlerDevtools` — routes all API calls through the background script via `runtime.sendMessage`, because devtools pages lack direct access to tabs/cookies APIs.

**Options**: `OptionsHandler` (extends `EventEmitter`) stores settings via `GenericStorageHandler`. Options are kept in `chrome.storage.local` under the key `all_options`. Multiple open panels stay in sync via the background script broadcasting `optionsChanged` messages.

**EventEmitter**: Custom `EventEmitter` in `interface/lib/eventEmitter.js` used as the base for cookie/options handlers; UI layers subscribe to `ready`, `cookiesChanged`, `optionsChanged` events.

### Import/Export Formats
Supported formats are in `interface/lib/`: `jsonFormat.js`, `netscapeFormat.js`, `headerstringFormat.js`. The active format is controlled by `ExportFormats` option.

### Localization
All user-facing strings use `__MSG_<key>__` references resolved from `_locales/<locale>/messages.json`. The default locale is `en`.

### Linting
ESLint is configured in `eslint.config.mjs` using Google style + Prettier. Imports must be sorted (`eslint-plugin-simple-import-sort`). The `dist/`, `build/`, and `safari/` directories are excluded from linting.
