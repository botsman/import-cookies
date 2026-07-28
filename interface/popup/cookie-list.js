import { CookieHandlerDevtools } from '../devtools/cookieHandlerDevtools.js';
import { AccountHandler } from '../lib/accountHandler.js';
import { Animate } from '../lib/animate.js';
import { BrowserDetector } from '../lib/browserDetector.js';
import { Cookie } from '../lib/cookie.js';
import {
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
} from '../lib/cookieShare.js';
import { GenericStorageHandler } from '../lib/genericStorageHandler.js';
import { HeaderstringFormat } from '../lib/headerstringFormat.js';
import { JsonFormat } from '../lib/jsonFormat.js';
import { NetscapeFormat } from '../lib/netscapeFormat.js';
import { ExportFormats } from '../lib/options/exportFormats.js';
import { OptionsHandler } from '../lib/optionsHandler.js';
import { PermissionHandler } from '../lib/permissionHandler.js';
import { ThemeHandler } from '../lib/themeHandler.js';
import { CookieHandlerPopup } from './cookieHandlerPopup.js';

(function () {
  ('use strict');

  let containerCookie;
  let cookiesListHtml;
  let pageTitleContainer;
  let notificationElement;
  let loadedCookies = {};
  let disableButtons = false;

  const notificationQueue = [];
  let notificationTimeout;

  const browserDetector = new BrowserDetector();
  const permissionHandler = new PermissionHandler(browserDetector);
  const storageHandler = new GenericStorageHandler(browserDetector);
  const optionHandler = new OptionsHandler(browserDetector, storageHandler);
  const themeHandler = new ThemeHandler(optionHandler);
  const accountHandler = new AccountHandler(browserDetector);
  const cookieHandler = window.isDevtools
    ? new CookieHandlerDevtools(browserDetector)
    : new CookieHandlerPopup(browserDetector);

  document.addEventListener('DOMContentLoaded', async function () {
    containerCookie = document.getElementById('cookie-container');
    notificationElement = document.getElementById('notification');
    pageTitleContainer = document.getElementById('pageTitle');

    await initWindow();

    /**
     * Expands the HTML cookie element.
     * @param {element} e Element to expand.
     */
    function expandCookie(e) {
      const parent = e.target.closest('li');
      const header = parent.querySelector('.header');
      const expando = parent.querySelector('.expando');

      Animate.toggleSlide(expando);
      header.classList.toggle('active');
      header.ariaExpanded = header.classList.contains('active');
      expando.ariaHidden = !header.classList.contains('active');
    }

    /**
     * Handles clicks on the delete button of a cookie.
     * @param {Element} e Delete button element.
     * @return {false} returns false to prevent click event propagation.
     */
    function deleteButton(e) {
      e.preventDefault();
      console.log('removing cookie...');
      const listElement = e.target.closest('li');
      removeCookie(listElement.dataset.name);
      return false;
    }

    /**
     * Handles saving a cookie from a form.
     * @param {element} form Form element that contains the cookie fields.
     * @return {false} returns false to prevent click event propagation.
     */
    function saveCookieForm(form) {
      const isCreateForm = form.classList.contains('create');

      const id = form.dataset.id;
      const name = form.querySelector('input[name="name"]').value;
      const value = form.querySelector('textarea[name="value"]').value;

      let domain;
      let path;
      let expiration;
      let sameSite;
      let hostOnly;
      let session;
      let secure;
      let httpOnly;

      if (!isCreateForm) {
        domain = form.querySelector('input[name="domain"]').value;
        path = form.querySelector('input[name="path"]').value;
        expiration = form.querySelector('input[name="expiration"]').value;
        sameSite = form.querySelector('select[name="sameSite"]').value;
        hostOnly = form.querySelector('input[name="hostOnly"]').checked;
        session = form.querySelector('input[name="session"]').checked;
        secure = form.querySelector('input[name="secure"]').checked;
        httpOnly = form.querySelector('input[name="httpOnly"]').checked;
      }
      saveCookie(
        id,
        name,
        value,
        domain,
        path,
        expiration,
        sameSite,
        hostOnly,
        session,
        secure,
        httpOnly
      );

      if (form.classList.contains('create')) {
        showCookiesForTab();
      }

      return false;
    }

    /**
     * Creates or saves changes to a cookie.
     * @param {string} id HTML ID assigned to the cookie.
     * @param {string} name Name of the cookie.
     * @param {string} value Value of the cookie.
     * @param {string} domain
     * @param {string} path
     * @param {string} expiration
     * @param {string} sameSite
     * @param {boolean} hostOnly
     * @param {boolean} session
     * @param {boolean} secure
     * @param {boolean} httpOnly
     */
    function saveCookie(
      id,
      name,
      value,
      domain,
      path,
      expiration,
      sameSite,
      hostOnly,
      session,
      secure,
      httpOnly
    ) {
      console.log('saving cookie...');

      const cookieContainer = loadedCookies[id];
      let cookie = cookieContainer ? cookieContainer.cookie : null;
      let oldName;
      let oldHostOnly;

      if (cookie) {
        oldName = cookie.name;
        oldHostOnly = cookie.hostOnly;
      } else {
        cookie = {};
        oldName = name;
        oldHostOnly = hostOnly;
      }

      cookie.name = name;
      cookie.value = value;

      if (domain !== undefined) {
        cookie.domain = domain;
      }
      if (path !== undefined) {
        cookie.path = path;
      }
      if (sameSite !== undefined) {
        cookie.sameSite = sameSite;
      }
      if (hostOnly !== undefined) {
        cookie.hostOnly = hostOnly;
      }
      if (session !== undefined) {
        cookie.session = session;
      }
      if (secure !== undefined) {
        cookie.secure = secure;
      }
      if (httpOnly !== undefined) {
        cookie.httpOnly = httpOnly;
      }

      if (cookie.session) {
        cookie.expirationDate = null;
      } else {
        cookie.expirationDate = new Date(expiration).getTime() / 1000;
        if (!cookie.expirationDate) {
          // Reset it to null because on safari it is NaN and causes failures.
          cookie.expirationDate = null;
          cookie.session = true;
        }
      }

      if (oldName !== name || oldHostOnly !== hostOnly) {
        cookieHandler.removeCookie(oldName, getCurrentTabUrl(), function () {
          cookieHandler.saveCookie(
            cookie,
            getCurrentTabUrl(),
            function (error, cookie) {
              if (error) {
                sendNotification(error);
                return;
              }
              if (browserDetector.isSafari()) {
                onCookiesChanged();
              }
              if (cookieContainer) {
                cookieContainer.showSuccessAnimation();
              }
            }
          );
        });
      } else {
        // Should probably put in a function to prevent duplication
        cookieHandler.saveCookie(
          cookie,
          getCurrentTabUrl(),
          function (error, cookie) {
            if (error) {
              sendNotification(error);
              return;
            }
            if (browserDetector.isSafari()) {
              onCookiesChanged();
            }

            if (cookieContainer) {
              cookieContainer.showSuccessAnimation();
            }
          }
        );
      }
    }

    if (containerCookie) {
      containerCookie.addEventListener('click', e => {
        let target = e.target;
        if (target.nodeName === 'path') {
          target = target.parentNode;
        }
        if (target.nodeName === 'svg') {
          target = target.parentNode;
        }

        if (
          target.classList.contains('header') ||
          target.classList.contains('header-name') ||
          target.classList.contains('header-extra-info')
        ) {
          return expandCookie(e);
        }
        if (target.classList.contains('delete')) {
          return deleteButton(e);
        }
        if (target.classList.contains('save')) {
          return saveCookieForm(e.target.closest('li').querySelector('form'));
        }
      });
      document.addEventListener('keydown', e => {
        if (e.code === 'Space' || e.code === 'Enter') {
          const target = e.target;
          if (target.classList.contains('header')) {
            e.preventDefault();
            return expandCookie(e);
          }
        }
      });
    }

    document.getElementById('create-cookie').addEventListener('click', () => {
      if (disableButtons) {
        return;
      }

      setPageTitle('Import Cookies - Add a Cookie');

      disableButtons = true;
      console.log('strart transition');
      Animate.transitionPage(
        containerCookie,
        containerCookie.firstChild,
        createHtmlFormCookie(),
        'left',
        () => {
          disableButtons = false;
        },
        optionHandler.getAnimationsEnabled()
      );
      console.log('after transition');

      document.getElementById('button-bar-default').classList.remove('active');
      document.getElementById('button-bar-add').classList.add('active');
      document.getElementById('name-create').focus();
      return false;
    });

    document
      .getElementById('delete-all-cookies')
      .addEventListener('click', () => {
        const buttonIcon = document
          .getElementById('delete-all-cookies')
          .querySelector('use');
        if (buttonIcon.getAttribute('href') === '../sprites/solid.svg#check') {
          return;
        }
        if (!loadedCookies || !Object.keys(loadedCookies).length) {
          return;
        }
        if (optionHandler.getDeleteAllConfirm()) {
          showDeleteAllConfirmDialog(() => {
            executeDeleteAll(buttonIcon);
          });
        } else {
          executeDeleteAll(buttonIcon);
        }
      });

    /**
     * Deletes all cookies for the current tab and updates the button icon.
     * @param {Element} buttonIcon The SVGUseElement inside the delete-all button.
     */
    function executeDeleteAll(buttonIcon) {
      for (const cookieId in loadedCookies) {
        if (Object.prototype.hasOwnProperty.call(loadedCookies, cookieId)) {
          removeCookie(loadedCookies[cookieId].cookie.name);
        }
      }
      sendNotification('All cookies were deleted');
      buttonIcon.setAttribute('href', '../sprites/solid.svg#check');
      setTimeout(() => {
        buttonIcon.setAttribute('href', '../sprites/solid.svg#trash');
      }, 1500);
    }

    /**
     * Shows a confirmation dialog before deleting all cookies.
     * Calls onConfirm if the user confirms. If the user checks "Don't ask
     * again", the deleteAllConfirm option is set to false.
     * @param {function} onConfirm Callback invoked when the user confirms.
     */
    function showDeleteAllConfirmDialog(onConfirm) {
      const template = document.importNode(
        document.getElementById('tmp-confirm-delete-all').content,
        true
      );
      const overlay = template.getElementById('confirm-delete-all-overlay');
      document.body.appendChild(overlay);

      document
        .getElementById('confirm-delete-all-cancel')
        .addEventListener('click', () => {
          document.body.removeChild(
            document.getElementById('confirm-delete-all-overlay')
          );
        });

      document
        .getElementById('confirm-delete-all-confirm')
        .addEventListener('click', () => {
          const dontAskAgain = document.getElementById(
            'confirm-delete-all-dont-ask'
          ).checked;
          if (dontAskAgain) {
            optionHandler.setDeleteAllConfirm(false);
          }
          document.body.removeChild(
            document.getElementById('confirm-delete-all-overlay')
          );
          onConfirm();
        });

      document.getElementById('confirm-delete-all-cancel').focus();
    }

    document.getElementById('export-cookies').addEventListener('click', () => {
      if (disableButtons) {
        hideExportMenu();
        return;
      }
      handleExportButtonClick();
    });

    document.getElementById('import-cookies').addEventListener('click', () => {
      if (disableButtons) {
        return;
      }

      setPageTitle('Import Cookies - Import');

      disableButtons = true;
      Animate.transitionPage(
        containerCookie,
        containerCookie.firstChild,
        createHtmlFormImport(),
        'left',
        () => {
          disableButtons = false;
        },
        optionHandler.getAnimationsEnabled()
      );

      document.getElementById('button-bar-default').classList.remove('active');
      document.getElementById('button-bar-import').classList.add('active');

      document.getElementById('content-import').focus();
      return false;
    });

    document.getElementById('share-cookies').addEventListener('click', () => {
      if (disableButtons) {
        return;
      }
      if (!loadedCookies || !Object.keys(loadedCookies).length) {
        sendNotification('No cookies to share on this page.');
        return;
      }

      setPageTitle('Import Cookies - Share');

      disableButtons = true;
      Animate.transitionPage(
        containerCookie,
        containerCookie.firstChild,
        createHtmlFormShare(),
        'left',
        () => {
          disableButtons = false;
        },
        optionHandler.getAnimationsEnabled()
      );

      document.getElementById('button-bar-default').classList.remove('active');
      document.getElementById('button-bar-share').classList.add('active');

      document.getElementById('share-title').focus();
      return false;
    });

    document.getElementById('return-list-add').addEventListener('click', () => {
      showCookiesForTab();
    });
    document
      .getElementById('return-list-import')
      .addEventListener('click', () => {
        showCookiesForTab();
      });
    document
      .getElementById('return-list-share')
      .addEventListener('click', () => {
        showCookiesForTab();
      });

    containerCookie.addEventListener('submit', e => {
      e.preventDefault();
      saveCookieForm(e.target);
      return false;
    });

    document
      .getElementById('save-create-cookie')
      .addEventListener('click', () => {
        saveCookieForm(document.querySelector('form'));
      });

    document
      .getElementById('save-import-cookie')
      .addEventListener('click', async e => {
        const buttonIcon = document
          .getElementById('save-import-cookie')
          .querySelector('use');
        if (
          buttonIcon.getAttribute('href') !== '../sprites/solid.svg#file-import'
        ) {
          return;
        }

        const text = document.querySelector('textarea').value;
        if (!text) {
          return;
        }

        // Check if the input is a share URL
        const parsed = parseShareUrl(text);
        if (parsed) {
          if (parsed.passwordProtected) {
            const password = prompt(
              'This link is password protected. Enter the password:'
            );
            if (!password) return;
            buttonIcon.setAttribute('href', '../sprites/solid.svg#spinner');
            try {
              const info = await fetchSharedInfo(parsed.uuid);
              const cookies = await decryptCookiesWithPassword(
                info.cookie,
                password,
                parsed.saltBase64
              );
              importCookiesArray(cookies);
              sendNotification('Cookies were imported from share link.');
              showCookiesForTab();
            } catch (err) {
              sendNotification('Wrong password or corrupted link.');
              buttonIcon.setAttribute('href', '../sprites/solid.svg#times');
              setTimeout(() => {
                buttonIcon.setAttribute(
                  'href',
                  '../sprites/solid.svg#file-import'
                );
              }, 1500);
            }
          } else {
            buttonIcon.setAttribute('href', '../sprites/solid.svg#spinner');
            try {
              const info = await fetchSharedInfo(parsed.uuid);
              const cookies = await decryptCookies(
                info.cookie,
                parsed.keyBase64
              );
              importCookiesArray(cookies);
              sendNotification('Cookies were imported from share link.');
              showCookiesForTab();
            } catch (err) {
              sendNotification(
                err.message || 'Failed to import from share link.'
              );
              buttonIcon.setAttribute('href', '../sprites/solid.svg#times');
              setTimeout(() => {
                buttonIcon.setAttribute(
                  'href',
                  '../sprites/solid.svg#file-import'
                );
              }, 1500);
            }
          }
          return;
        }

        let cookies;
        try {
          cookies = JsonFormat.parse(text);
        } catch (error) {
          console.warn(error);
          try {
            cookies = HeaderstringFormat.parse(text);
          } catch (error) {
            console.warn(error);
            try {
              cookies = NetscapeFormat.parse(text);
            } catch (error) {
              console.warn("Couldn't parse Data", error);
              sendNotification('The input is not in a valid format.');
              buttonIcon.setAttribute('href', '../sprites/solid.svg#times');
              setTimeout(() => {
                buttonIcon.setAttribute(
                  'href',
                  '../sprites/solid.svg#file-import'
                );
              }, 1500);
              return;
            }
          }
        }

        if (!isArray(cookies) || cookies.length === 0) {
          console.log('No cookies were imported.');
          sendNotification('No cookies were imported. Verify your input.');
          buttonIcon.setAttribute('href', '../sprites/solid.svg#times');
          setTimeout(() => {
            buttonIcon.setAttribute('href', '../sprites/solid.svg#file-import');
          }, 1500);
          return;
        }

        importCookiesArray(cookies);
        sendNotification(`Cookies were imported`);
        showCookiesForTab();
      });

    document
      .getElementById('save-share-cookie')
      .addEventListener('click', async () => {
        const btn = document.getElementById('save-share-cookie');
        const btnIcon = btn.querySelector('use');
        if (btnIcon.getAttribute('href') !== '../sprites/solid.svg#share-alt') {
          return;
        }

        const user = await accountHandler.getAccount();
        if (!user) {
          window.open('https://devtulz.com/import-cookies/login', '_blank');
          return;
        }

        const premium = await accountHandler.isPremium();
        if (!premium) {
          showSubscribeModal();
          return;
        }

        const titleInput = document.getElementById('share-title');
        const expSelect = document.getElementById('share-exp');
        const publicCheck = document.getElementById('share-public');
        const passwordInput = document.getElementById('share-password');

        const domain = getDomainFromUrl(getCurrentTabUrl()) || 'unknown';
        const title = (titleInput?.value || '').trim() || domain;
        const exp = expSelect?.value || '7d';
        const isPublic = publicCheck?.checked ?? true;
        const password = passwordInput?.value || '';

        const cookiesArray = Object.values(loadedCookies).map(c => c.cookie);

        btnIcon.setAttribute('href', '../sprites/solid.svg#spinner');
        btn.disabled = true;

        try {
          let encryptedData;
          let fragment;
          if (password) {
            const result = await encryptCookiesWithPassword(
              cookiesArray,
              password
            );
            encryptedData = result.encryptedData;
            fragment = `pw:${result.saltBase64}`;
          } else {
            const result = await encryptCookies(cookiesArray);
            encryptedData = result.encryptedData;
            fragment = result.keyBase64;
          }

          const uuid = await shareCookies({
            encryptedData,
            title,
            domain,
            exp,
            isPublic,
          });

          // Persist fragment locally so My Shares can rebuild the full URL
          await storeShareKey(uuid, fragment);

          const shareUrl = buildShareUrl(uuid, fragment);
          showShareResult(shareUrl, Boolean(password));
        } catch (err) {
          sendNotification(err.message || 'Failed to share cookies.');
          btnIcon.setAttribute('href', '../sprites/solid.svg#share-alt');
          btn.disabled = false;
        }
      });

    const mainMenuContent = document.querySelector('#main-menu-content');
    document
      .querySelector('#main-menu-button')
      .addEventListener('click', function (e) {
        mainMenuContent.classList.toggle('visible');
      });

    document.addEventListener('click', function (e) {
      // Clicks in the main menu should not dismiss it.
      if (
        document.querySelector('#main-menu').contains(e.target) ||
        !mainMenuContent.classList.contains('visible')
      ) {
        return;
      }
      console.log('main menu blur');
      mainMenuContent.classList.remove('visible');
    });

    document.addEventListener('click', function (e) {
      const exportMenu = document.querySelector('#export-menu');
      // Clicks in the export menu should not dismiss it.
      if (!exportMenu || exportMenu.contains(e.target)) {
        return;
      }

      const exportButton = document.querySelector('#export-cookies');
      if (!exportButton || exportButton.contains(e.target)) {
        return;
      }

      console.log('export menu blur');
      hideExportMenu();
    });

    document
      .querySelector('#advanced-toggle-all')
      .addEventListener('change', function (e) {
        optionHandler.setCookieAdvanced(e.target.checked);
        showCookiesForTab();
      });

    document
      .querySelector('#menu-all-options')
      .addEventListener('click', function (e) {
        if (browserDetector.getApi().runtime.openOptionsPage) {
          browserDetector.getApi().runtime.openOptionsPage();
        } else {
          window.open(
            browserDetector
              .getApi()
              .runtime.getURL('interface/options/options.html')
          );
        }
      });

    document
      .querySelector('#sidebar-cookies')
      ?.addEventListener('click', () => switchPanel('cookies'));

    document
      .querySelector('#sidebar-settings')
      ?.addEventListener('click', () => switchPanel('settings'));

    document
      .querySelector('#sidebar-shares')
      ?.addEventListener('click', () => switchPanel('shares'));

    document
      .querySelector('#sidebar-account')
      ?.addEventListener('click', () => switchPanel('account'));

    initSettingsPanel();
    initAccountPanel();
    accountHandler.getAccount();

    notificationElement.addEventListener('animationend', e => {
      if (notificationElement.classList.contains('fadeInUp')) {
        return;
      }

      triggerNotification();
    });

    document
      .getElementById('notification-dismiss')
      .addEventListener('click', e => {
        hideNotification();
      });

    adjustWidthIfSmaller();

    if (chrome && chrome.runtime && chrome.runtime.getBrowserInfo) {
      chrome.runtime.getBrowserInfo(function (info) {
        const mainVersion = info.version.split('.')[0];
        if (mainVersion < 57) {
          containerCookie.style.height = '600px';
        }
      });
    }
  });

  // == End document ready == //

  /**
   * Switches the main panel between 'cookies' and 'settings'.
   * @param {string} panel 'cookies' or 'settings'
   */
  function switchPanel(panel) {
    const mainArea = document.getElementById('main-area');
    if (!mainArea) return;
    const cookiesBtn = document.getElementById('sidebar-cookies');
    const settingsBtn = document.getElementById('sidebar-settings');
    const sharesBtn = document.getElementById('sidebar-shares');
    const accountBtn = document.getElementById('sidebar-account');

    mainArea.classList.remove('show-settings', 'show-account', 'show-shares');
    cookiesBtn?.classList.remove('active');
    settingsBtn?.classList.remove('active');
    sharesBtn?.classList.remove('active');
    accountBtn?.classList.remove('active');

    const onCookiesPanel = panel === 'cookies' || !panel;
    document.querySelectorAll('.button-bar').forEach(bar => {
      bar.style.display = onCookiesPanel ? '' : 'none';
    });

    if (panel === 'settings') {
      mainArea.classList.add('show-settings');
      settingsBtn?.classList.add('active');
      updateSettingsPanelValues();
    } else if (panel === 'account') {
      mainArea.classList.add('show-account');
      accountBtn?.classList.add('active');
      renderAccountPanel();
    } else if (panel === 'shares') {
      mainArea.classList.add('show-shares');
      sharesBtn?.classList.add('active');
      renderSharesPanel();
    } else {
      cookiesBtn?.classList.add('active');
    }
  }

  /**
   * Renders the account panel based on current auth state.
   */
  async function renderAccountPanel() {
    const loading = document.getElementById('account-loading');
    const loggedOut = document.getElementById('account-logged-out');
    const loggedIn = document.getElementById('account-logged-in');

    loading.style.display = 'block';
    loggedOut.style.display = 'none';
    loggedIn.style.display = 'none';

    const user = await accountHandler.getAccount();

    loading.style.display = 'none';
    if (user) {
      loggedOut.style.display = 'none';
      loggedIn.style.display = 'block';
      document.getElementById('account-name').textContent =
        user.name || user.email;
      document.getElementById('account-avatar').src = user.avatar || '';
      const badge = document.getElementById('account-tier-badge');
      if (user.account_type === 2) {
        badge.textContent = 'Premium';
        badge.className = 'premium';
      } else {
        badge.textContent = 'Free';
        badge.className = '';
      }
    } else {
      loggedOut.style.display = 'block';
      loggedIn.style.display = 'none';
    }
  }

  /**
   * Wires up the account panel buttons — called once on DOMContentLoaded.
   */
  function initAccountPanel() {
    document
      .getElementById('account-login-btn')
      ?.addEventListener('click', () => {
        window.open('https://devtulz.com/import-cookies/login', '_blank');
      });

    document
      .getElementById('account-logout-btn')
      ?.addEventListener('click', async () => {
        window.open(
          'https://devtulz.com/import-cookies/api/auth/logout',
          '_blank'
        );
        await accountHandler.clearAccount();
        renderAccountPanel();
      });
  }

  /**
   * Wires up the settings panel form — called once on DOMContentLoaded.
   */
  function initSettingsPanel() {
    const advancedCookieInput = document.getElementById('sp-advanced-cookie');
    const devtoolShowInput = document.getElementById('sp-devtool-show');
    const animationsEnabledInput = document.getElementById(
      'sp-animations-enabled'
    );
    const exportFormatInput = document.getElementById('sp-export-format');
    const extraInfoInput = document.getElementById('sp-extra-info');
    const themeInput = document.getElementById('sp-theme');
    const deleteAllConfirmInput = document.getElementById(
      'sp-delete-all-confirm'
    );
    const buttonBarTopInput = document.getElementById('sp-button-bar-top');

    advancedCookieInput.addEventListener('change', e => {
      if (!e.isTrusted) return;
      optionHandler.setCookieAdvanced(advancedCookieInput.checked);
    });
    devtoolShowInput.addEventListener('change', e => {
      if (!e.isTrusted) return;
      optionHandler.setDevtoolsEnabled(devtoolShowInput.checked);
    });
    animationsEnabledInput.addEventListener('change', e => {
      if (!e.isTrusted) return;
      optionHandler.setAnimationsEnabled(animationsEnabledInput.checked);
    });
    exportFormatInput.addEventListener('change', e => {
      if (!e.isTrusted) return;
      optionHandler.setExportFormat(exportFormatInput.value);
    });
    extraInfoInput.addEventListener('change', e => {
      if (!e.isTrusted) return;
      optionHandler.setExtraInfo(extraInfoInput.value);
    });
    themeInput.addEventListener('change', e => {
      if (!e.isTrusted) return;
      optionHandler.setTheme(themeInput.value);
      themeHandler.updateTheme();
    });
    deleteAllConfirmInput.addEventListener('change', e => {
      if (!e.isTrusted) return;
      optionHandler.setDeleteAllConfirm(deleteAllConfirmInput.checked);
    });
    buttonBarTopInput.addEventListener('change', e => {
      if (!e.isTrusted) return;
      optionHandler.setButtonBarTop(buttonBarTopInput.checked);
      moveButtonBar();
    });

    document
      .getElementById('sp-export-all-json')
      .addEventListener('click', async () => {
        await spExportAllCookies('json');
      });

    document
      .getElementById('sp-export-all-netscape')
      .addEventListener('click', async () => {
        await spExportAllCookies('netscape');
      });

    document
      .getElementById('sp-delete-all')
      .addEventListener('click', async () => {
        const confirmed = confirm(
          'Are you sure you want to delete ALL your cookies?'
        );
        if (!confirmed) return;
        const cookies = await spGetAllCookies();
        for (const cookieId in cookies) {
          if (!Object.prototype.hasOwnProperty.call(cookies, cookieId)) {
            continue;
          }
          const exportedCookie = cookies[cookieId].cookie;
          const url = 'https://' + exportedCookie.domain + exportedCookie.path;
          cookieHandler.removeCookie(exportedCookie.name, url);
        }
        alert('All your cookies were deleted.');
      });
  }

  /**
   * Syncs the settings panel form values from the current options.
   */
  function updateSettingsPanelValues() {
    document.getElementById('sp-advanced-cookie').checked =
      optionHandler.getCookieAdvanced();
    document.getElementById('sp-devtool-show').checked =
      optionHandler.getDevtoolsEnabled();
    document.getElementById('sp-animations-enabled').checked =
      optionHandler.getAnimationsEnabled();
    document.getElementById('sp-export-format').value =
      optionHandler.getExportFormat();
    document.getElementById('sp-extra-info').value =
      optionHandler.getExtraInfo();
    document.getElementById('sp-theme').value = optionHandler.getTheme();
    document.getElementById('sp-delete-all-confirm').checked =
      optionHandler.getDeleteAllConfirm();
    document.getElementById('sp-button-bar-top').checked =
      optionHandler.getButtonBarTop();
  }

  /**
   * Gets all cookies in the browser (used by the settings panel).
   * @return {Promise<Object>}
   */
  async function spGetAllCookies() {
    const hasPermissions =
      await permissionHandler.checkPermissions('<all_urls>');
    if (!hasPermissions) {
      await permissionHandler.requestPermission('<all_urls>');
    }
    return new Promise(resolve => {
      cookieHandler.getAllCookiesInBrowser(function (rawCookies) {
        const result = [];
        for (const cookie of rawCookies) {
          const id = Cookie.hashCode(cookie);
          result[id] = new Cookie(id, cookie, optionHandler);
        }
        resolve(result);
      });
    });
  }

  /**
   * Exports all browser cookies to clipboard.
   * @param {string} format 'json' or 'netscape'
   */
  async function spExportAllCookies(format) {
    const cookies = await spGetAllCookies();
    const text =
      format === 'netscape'
        ? NetscapeFormat.format(cookies)
        : JsonFormat.format(cookies);
    const fakeText = document.createElement('textarea');
    fakeText.textContent = text;
    document.body.appendChild(fakeText);
    fakeText.focus();
    fakeText.select();
    document.execCommand('Copy');
    document.body.removeChild(fakeText);
    alert('Done!');
  }

  /**
   * Builds the HTML for the cookies of the current tab.
   * @return {Promise|null}
   */
  async function showCookiesForTab() {
    if (!cookieHandler.currentTab) {
      return;
    }
    if (disableButtons) {
      return;
    }

    console.log('showing cookies');

    setPageTitle('Import Cookies');
    document.getElementById('button-bar-add').classList.remove('active');
    document.getElementById('button-bar-import').classList.remove('active');
    document.getElementById('button-bar-share').classList.remove('active');
    document.getElementById('button-bar-default').classList.add('active');
    document.myThing = 'DarkSide';
    const domain = getDomainFromUrl(cookieHandler.currentTab.url);
    const subtitleLine = document.querySelector('.titles h2');
    if (subtitleLine) {
      subtitleLine.textContent = domain || cookieHandler.currentTab.url;
    }

    if (!permissionHandler.canHavePermissions(cookieHandler.currentTab.url)) {
      showPermissionImpossible();
      return;
    }
    // If devtools has not been fully init yet, we will wait for a signal.
    if (!cookieHandler.currentTab) {
      showNoCookies();
      return;
    }
    const hasPermissions = await permissionHandler.checkPermissions(
      cookieHandler.currentTab.url
    );
    if (!hasPermissions) {
      showNoPermission();
      return;
    }

    cookieHandler.getAllCookies(function (cookies) {
      cookies = cookies.sort(sortCookiesByName);

      loadedCookies = {};

      if (cookies.length === 0) {
        showNoCookies();
        return;
      }

      cookiesListHtml = document.createElement('ul');
      cookiesListHtml.appendChild(generateSearchBar());
      cookies.forEach(function (cookie) {
        const id = Cookie.hashCode(cookie);
        loadedCookies[id] = new Cookie(id, cookie, optionHandler);
        cookiesListHtml.appendChild(loadedCookies[id].html);
      });

      if (containerCookie.firstChild) {
        disableButtons = true;
        Animate.transitionPage(
          containerCookie,
          containerCookie.firstChild,
          cookiesListHtml,
          'right',
          () => {
            disableButtons = false;
          },
          optionHandler.getAnimationsEnabled()
        );
      } else {
        containerCookie.appendChild(cookiesListHtml);
      }
    });
  }

  /**
   * Displays a message to the user to let them know that no cookies are
   * available for the current page.
   */
  function showNoCookies() {
    if (disableButtons) {
      return;
    }
    // If on a different page (e.g: import page) - don't show the no-cookies message.
    const pageTitle =
      pageTitleContainer?.querySelector('h1')?.textContent ?? '';
    if (pageTitle !== 'Import Cookies') {
      return;
    }
    cookiesListHtml = null;
    const html = document
      .importNode(document.getElementById('tmp-empty').content, true)
      .querySelector('p');
    if (containerCookie.firstChild) {
      if (containerCookie.firstChild.id === 'no-cookie') {
        return;
      }
      disableButtons = true;
      Animate.transitionPage(
        containerCookie,
        containerCookie.firstChild,
        html,
        'right',
        () => {
          disableButtons = false;
        },
        optionHandler.getAnimationsEnabled()
      );
    } else {
      containerCookie.appendChild(html);
    }
  }

  /**
   * Displays a message to the user to let them know that the extension doesn't
   * have permission to access the cookies for this page.
   */
  function showNoPermission() {
    if (disableButtons) {
      return;
    }
    cookiesListHtml = null;
    const html = document
      .importNode(document.getElementById('tmp-no-permission').content, true)
      .querySelector('div');

    document.getElementById('button-bar-add').classList.remove('active');
    document.getElementById('button-bar-import').classList.remove('active');
    document.getElementById('button-bar-share').classList.remove('active');
    document.getElementById('button-bar-default').classList.remove('active');
    // Firefox can't request permissions from devTools due to
    // https://bugzilla.mozilla.org/show_bug.cgi?id=1796933
    if (
      browserDetector.isFirefox() &&
      typeof browserDetector.getApi().devtools !== 'undefined'
    ) {
      console.log('Firefox devtools permission display hack');
      html.querySelector('div').textContent =
        "Go to your settings (about:addons) or open the extension's popup to " +
        'adjust your permissions.';
    }

    if (containerCookie.firstChild) {
      if (containerCookie.firstChild.id === 'no-permission') {
        return;
      }
      disableButtons = true;
      Animate.transitionPage(
        containerCookie,
        containerCookie.firstChild,
        html,
        'right',
        () => {
          disableButtons = false;
        },
        optionHandler.getAnimationsEnabled()
      );
    } else {
      containerCookie.appendChild(html);
    }
    document.getElementById('request-permission').focus();
    document
      .getElementById('request-permission')
      .addEventListener('click', async event => {
        console.log('requesting permissions!');
        const isPermissionGranted = await permissionHandler.requestPermission(
          cookieHandler.currentTab.url
        );
        console.log('permission granted? ', isPermissionGranted);
        if (isPermissionGranted) {
          showCookiesForTab();
        }
      });
    document
      .getElementById('request-permission-all')
      .addEventListener('click', async event => {
        console.log('requesting all permissions!');
        const isPermissionGranted =
          await permissionHandler.requestPermission('<all_urls>');
        console.log('permission granted? ', isPermissionGranted);
        if (isPermissionGranted) {
          showCookiesForTab();
        }
      });
  }

  /**
   * Displays a message to the user to let them know that the extension can't
   * get permission to access the cookies for this page due to them being
   * internal pages.
   */
  function showPermissionImpossible() {
    if (disableButtons) {
      return;
    }
    cookiesListHtml = null;
    const html = document
      .importNode(
        document.getElementById('tmp-permission-impossible').content,
        true
      )
      .querySelector('div');

    document.getElementById('button-bar-add').classList.remove('active');
    document.getElementById('button-bar-import').classList.remove('active');
    document.getElementById('button-bar-share').classList.remove('active');
    document.getElementById('button-bar-default').classList.remove('active');
    if (containerCookie.firstChild) {
      if (containerCookie.firstChild.id === 'permission-impossible') {
        return;
      }
      disableButtons = true;
      Animate.transitionPage(
        containerCookie,
        containerCookie.firstChild,
        html,
        'right',
        () => {
          disableButtons = false;
        },
        optionHandler.getAnimationsEnabled()
      );
    } else {
      containerCookie.appendChild(html);
    }
  }

  /**
   * Shows the current version number in the interface.
   */
  function showVersion() {
    const version = browserDetector.getApi().runtime.getManifest().version;
    document.getElementById('version').textContent = 'v' + version;
  }

  /**
   * Enables or disables the animations based on the options.
   */
  function handleAnimationsEnabled() {
    if (optionHandler.getAnimationsEnabled()) {
      document.body.classList.remove('notransition');
    } else {
      document.body.classList.add('notransition');
    }
  }

  /**
   * Creates the HTML representation of a cookie.
   * @param {string} name Name of the cookie.
   * @param {string} value Value of the cookie.
   * @param {string} id HTML ID to use for the cookie.
   * @return {string} the HTML of the cookie.
   */
  function createHtmlForCookie(name, value, id) {
    const cookie = new Cookie(
      id,
      {
        name: name,
        value: value,
      },
      optionHandler
    );

    return cookie.html;
  }

  /**
   * Creates the HTML form to allow editing a cookie.
   * @return {string} The HTML for the form.
   */
  function createHtmlFormCookie() {
    const template = document.importNode(
      document.getElementById('tmp-create').content,
      true
    );
    return template.querySelector('form');
  }

  /**
   * Creates the HTML form to allow importing cookies.
   * @return {string} The HTML for the form.
   */
  function createHtmlFormImport() {
    const template = document.importNode(
      document.getElementById('tmp-import').content,
      true
    );
    return template.querySelector('form');
  }

  /**
   * Handles the logic of the export button, depending on user preferences.
   */
  function handleExportButtonClick() {
    const exportOption = optionHandler.getExportFormat();
    switch (exportOption) {
      case ExportFormats.Ask:
        toggleExportMenu();
        break;
      case ExportFormats.JSON:
        exportToJson();
        break;
      case ExportFormats.HeaderString:
        exportToHeaderstring();
        break;
      case ExportFormats.Netscape:
        exportToNetscape();
        break;
    }
  }

  /**
   * Toggles the visibility of the export menu.
   */
  function toggleExportMenu() {
    if (document.getElementById('export-menu')) {
      hideExportMenu();
    } else {
      showExportMenu();
    }
  }

  /**
   * Shows the export menu.
   */
  function showExportMenu() {
    const template = document.importNode(
      document.getElementById('tmp-export-options').content,
      true
    );
    containerCookie.appendChild(template.getElementById('export-menu'));

    document.getElementById('export-json').focus();
    document.getElementById('export-json').addEventListener('click', event => {
      exportToJson();
    });
    document
      .getElementById('export-headerstring')
      .addEventListener('click', event => {
        exportToHeaderstring();
      });
    document
      .getElementById('export-netscape')
      .addEventListener('click', event => {
        exportToNetscape();
      });
  }

  /**
   * Hides the export menu.
   */
  function hideExportMenu() {
    const exportMenu = document.getElementById('export-menu');
    if (exportMenu) {
      containerCookie.removeChild(exportMenu);
      document.activeElement.blur();
    }
  }

  if (typeof createHtmlFormCookie === 'undefined') {
    // This should not happen anyway ;)
    // eslint-disable-next-line no-func-assign
    createHtmlFormCookie = createHtmlForCookie;
  }

  /**
   * Exports all the cookies for the current tab in the JSON format.
   */
  function exportToJson() {
    hideExportMenu();
    const buttonIcon = document
      .getElementById('export-cookies')
      .querySelector('use');
    if (buttonIcon.getAttribute('href') === '../sprites/solid.svg#check') {
      return;
    }

    buttonIcon.setAttribute('href', '../sprites/solid.svg#check');
    copyText(JsonFormat.format(loadedCookies));

    sendNotification('Cookies exported to clipboard as JSON');
    setTimeout(() => {
      buttonIcon.setAttribute('href', '../sprites/solid.svg#file-export');
    }, 1500);
  }

  /**
   * Exports all the cookies for the current tab in the header string format.
   */
  function exportToHeaderstring() {
    hideExportMenu();
    const buttonIcon = document
      .getElementById('export-cookies')
      .querySelector('use');
    if (buttonIcon.getAttribute('href') === '../sprites/solid.svg#check') {
      return;
    }

    buttonIcon.setAttribute('href', '../sprites/solid.svg#check');
    copyText(HeaderstringFormat.format(loadedCookies));

    sendNotification('Cookies exported to clipboard as Header String');
    setTimeout(() => {
      buttonIcon.setAttribute('href', '../sprites/solid.svg#file-export');
    }, 1500);
  }

  /**
   * Exports all the cookies for the current tab in the Netscape format.
   */
  function exportToNetscape() {
    hideExportMenu();
    const buttonIcon = document
      .getElementById('export-cookies')
      .querySelector('use');
    if (buttonIcon.getAttribute('href') === '../sprites/solid.svg#check') {
      return;
    }

    buttonIcon.setAttribute('href', '../sprites/solid.svg#check');
    copyText(NetscapeFormat.format(loadedCookies));

    sendNotification('Cookies exported to clipboard as Netscape format');
    setTimeout(() => {
      buttonIcon.setAttribute('href', '../sprites/solid.svg#file-export');
    }, 1500);
  }

  /**
   * Removes a cookie from the current tab.
   * @param {string} name Name of the cookie to remove.
   * @param {string} url Url of the tab that contains the cookie.
   * @param {function} callback
   */
  function removeCookie(name, url, callback) {
    cookieHandler.removeCookie(name, url || getCurrentTabUrl(), function (e) {
      console.log('removed successfuly', e);
      if (callback) {
        callback();
      }
      if (browserDetector.isSafari()) {
        onCookiesChanged();
      }
    });
  }

  /**
   * Handles the CookiesChanged event and updates the interface.
   * @param {object} changeInfo
   */
  function onCookiesChanged(changeInfo) {
    if (!changeInfo) {
      showCookiesForTab();
      return;
    }

    console.log('Cookies have changed!', changeInfo.removed, changeInfo.cause);
    const id = Cookie.hashCode(changeInfo.cookie);

    if (changeInfo.cause === 'overwrite') {
      return;
    }

    if (changeInfo.removed) {
      if (loadedCookies[id]) {
        loadedCookies[id].removeHtml(() => {
          if (!Object.keys(loadedCookies).length) {
            showNoCookies();
          }
        });
        delete loadedCookies[id];
      }
      return;
    }

    if (loadedCookies[id]) {
      loadedCookies[id].updateHtml(changeInfo.cookie);
      return;
    }

    const newCookie = new Cookie(id, changeInfo.cookie, optionHandler);
    loadedCookies[id] = newCookie;

    if (!cookiesListHtml && document.getElementById('no-cookies')) {
      clearChildren(containerCookie);
      cookiesListHtml = document.createElement('ul');
      cookiesListHtml.appendChild(generateSearchBar());
      containerCookie.appendChild(cookiesListHtml);
    }

    if (cookiesListHtml) {
      cookiesListHtml.appendChild(newCookie.html);
    }
  }

  /**
   * Evaluates two cookies to determine which comes first when sorting them.
   * @param {object} a First cookie.
   * @param {object} b Second cookie.
   * @return {int} -1 if a should show first, 0 if they are equal, otherwise 1.
   */
  function sortCookiesByName(a, b) {
    const aName = a.name.toLowerCase();
    const bName = b.name.toLowerCase();
    return aName < bName ? -1 : aName > bName ? 1 : 0;
  }

  /**
   * Initialises the interface.
   * @param {object} _tab The current Tab.
   */
  async function initWindow(_tab) {
    await optionHandler.loadOptions();
    themeHandler.updateTheme();
    moveButtonBar();
    handleAnimationsEnabled();
    optionHandler.on('optionsChanged', onOptionsChanged);
    cookieHandler.on('cookiesChanged', onCookiesChanged);
    cookieHandler.on('ready', showCookiesForTab);
    document.querySelector('#advanced-toggle-all').checked =
      optionHandler.getCookieAdvanced();
    if (cookieHandler.isReady) {
      showCookiesForTab();
    }
    showVersion();
  }

  /**
   * Gets the URL of the current tab.
   * @return {string} The URL of the current tab, otherwise empty string if
   *     we can't get the current tab.
   */
  function getCurrentTabUrl() {
    if (cookieHandler.currentTab) {
      return cookieHandler.currentTab.url;
    }
    return '';
  }

  /**
   * Gets the domain of an URL.
   * @param {string} url URL to extract the domain from.
   * @return {string} The domain extracted.
   */
  function getDomainFromUrl(url) {
    const matches = url.match(/^https?:\/\/([^/?#]+)(?:[/?#]|$)/i);
    return matches && matches[1];
  }

  /**
   * Adds a notification to the notification queue.
   * @param {string} message Message to display in the notification.
   */
  function sendNotification(message) {
    notificationQueue.push(message);
    triggerNotification();
  }

  /**
   * Generates the HTML for the search bar.
   * @return {string} The HTML to display the search bar.
   */
  function generateSearchBar() {
    const searchBarContainer = document.importNode(
      document.getElementById('tmp-search-bar').content,
      true
    );
    searchBarContainer
      .getElementById('searchField')
      .addEventListener('keyup', e => filterCookies(e.target, e.target.value));
    return searchBarContainer;
  }

  /**
   * Starts displaying the next notification in the queue if there is one.
   * This will also make sure that wer are not already in the middle of
   * displaying a notification already.
   */
  function triggerNotification() {
    if (!notificationQueue || !notificationQueue.length) {
      return;
    }
    if (notificationTimeout) {
      return;
    }
    if (notificationElement.classList.contains('fadeInUp')) {
      return;
    }

    showNotification();
  }

  /**
   * Creates the HTML for a notification and animates it into view for a
   * specific amount of time. Then it will dismiss itself if the user doesn't
   * dismiss it manually.
   */
  function showNotification() {
    if (notificationTimeout) {
      return;
    }

    notificationElement.parentElement.style.display = 'block';
    notificationElement.querySelector('#notification-dismiss').style.display =
      'block';
    notificationElement.querySelector('span').textContent =
      notificationQueue.shift();
    notificationElement.querySelector('span').setAttribute('role', 'alert');
    notificationElement.classList.add('fadeInUp');
    notificationElement.classList.remove('fadeOutDown');

    notificationTimeout = setTimeout(() => {
      hideNotification();
    }, 2500);
  }

  /**
   * Hides a notification.
   */
  function hideNotification() {
    if (notificationTimeout) {
      clearTimeout(notificationTimeout);
      notificationTimeout = null;
    }

    notificationElement.querySelector('span').setAttribute('role', '');
    notificationElement.classList.remove('fadeInUp');
    notificationElement.classList.add('fadeOutDown');
    notificationElement.querySelector('#notification-dismiss').style.display =
      'none';
  }

  /**
   * Sets the page title.
   * @param {string} title Title to display.
   */
  function setPageTitle(title) {
    if (!pageTitleContainer) {
      return;
    }

    pageTitleContainer.querySelector('h1').textContent = title;
  }

  /**
   * Copy some text to the user's clipboard.
   * @param {string} text Text to copy.
   */
  function copyText(text) {
    const fakeText = document.createElement('textarea');
    fakeText.classList.add('clipboardCopier');
    fakeText.textContent = text;
    document.body.appendChild(fakeText);
    fakeText.focus();
    fakeText.select();
    // TODO: switch to clipboard API.
    document.execCommand('Copy');
    document.body.removeChild(fakeText);
  }

  /**
   * Checks if a value is an arary.
   * @param {any} value Value to evaluate.
   * @return {boolean} true if the value is an array, otherwise false.
   */
  function isArray(value) {
    return value && typeof value === 'object' && value.constructor === Array;
  }

  /**
   * Clears all the children of an element.
   * @param {element} element Element to clear its children.
   */
  function clearChildren(element) {
    while (element.firstChild) {
      element.removeChild(element.firstChild);
    }
  }

  /**
   * Adjusts the width of the interface if the container it's in is smaller than
   * a specific size.
   */
  function adjustWidthIfSmaller() {
    const realWidth = document.documentElement.clientWidth;
    if (realWidth < 500) {
      console.log('Editor is smaller than 500px!');
      document.body.style.minWidth = '100%';
      document.body.style.width = realWidth + 'px';
    }
  }

  /**
   * Filters the cookies based on keywords. Used for searching.
   * @param {element} target The searchbox.
   * @param {*} filterText The text to search for.
   */
  function filterCookies(target, filterText) {
    const cookies = cookiesListHtml.querySelectorAll('.cookie');
    filterText = filterText.toLowerCase();

    if (filterText) {
      target.classList.add('content');
    } else {
      target.classList.remove('content');
    }

    for (let i = 0; i < cookies.length; i++) {
      const cookieElement = cookies[i];
      const cookieName = cookieElement.children[0]
        .getElementsByTagName('span')[0]
        .textContent.toLocaleLowerCase();
      if (!filterText || cookieName.indexOf(filterText) > -1) {
        cookieElement.classList.remove('hide');
      } else {
        cookieElement.classList.add('hide');
      }
    }
  }

  /**
   * Handles the changes required to the interface when the options are changed
   * by an external source.
   * @param {Option} oldOptions the options before changes.
   */
  function onOptionsChanged(oldOptions) {
    handleAnimationsEnabled();
    moveButtonBar();
    if (oldOptions.advancedCookies != optionHandler.getCookieAdvanced()) {
      document.querySelector('#advanced-toggle-all').checked =
        optionHandler.getCookieAdvanced();
      showCookiesForTab();
    }

    if (oldOptions.extraInfo != optionHandler.getExtraInfo()) {
      showCookiesForTab();
    }
  }

  /**
   * Imports an array of cookie objects into the current tab.
   * @param {Array} cookies
   */
  function importCookiesArray(cookies) {
    for (const cookie of cookies) {
      cookie.storeId = cookieHandler.currentTab.cookieStoreId;
      if (cookie.sameSite && cookie.sameSite === 'unspecified') {
        cookie.sameSite = null;
      }
      try {
        cookieHandler.saveCookie(cookie, getCurrentTabUrl(), function (error) {
          if (error) {
            sendNotification(error);
          }
        });
      } catch (error) {
        console.error(error);
        sendNotification(error);
      }
    }
  }

  /**
   * Creates the HTML form for sharing cookies.
   * @return {Element}
   */
  function createHtmlFormShare() {
    const template = document.importNode(
      document.getElementById('tmp-share').content,
      true
    );
    const form = template.querySelector('form');
    const domain = getDomainFromUrl(getCurrentTabUrl()) || '';
    const titleInput = form.querySelector('#share-title');
    if (titleInput && domain) {
      titleInput.value = domain;
    }
    return form;
  }

  /**
   * Shows the subscription modal overlay.
   */
  function showSubscribeModal() {
    const existing = document.getElementById('subscribe-overlay');
    if (existing) return;

    const overlay = document
      .importNode(document.getElementById('tmp-subscribe-modal').content, true)
      .querySelector('#subscribe-overlay');

    document.body.appendChild(overlay);

    document
      .getElementById('subscribe-close')
      .addEventListener('click', closeSubscribeModal);
    overlay.addEventListener('click', e => {
      if (e.target === overlay) closeSubscribeModal();
    });
    document
      .getElementById('subscribe-monthly')
      .addEventListener('click', () => {
        window.open(
          'https://devtulz.com/import-cookies/subscribe?plan=monthly',
          '_blank'
        );
        closeSubscribeModal();
      });
    document
      .getElementById('subscribe-yearly')
      .addEventListener('click', () => {
        window.open(
          'https://devtulz.com/import-cookies/subscribe?plan=yearly',
          '_blank'
        );
        closeSubscribeModal();
      });
  }

  /**
   * Removes the subscription modal overlay.
   */
  function closeSubscribeModal() {
    document.getElementById('subscribe-overlay')?.remove();
  }

  /**
   * Replaces the share form in containerCookie with the share result view.
   * @param {string} shareUrl
   * @param {boolean} passwordProtected
   */
  function showShareResult(shareUrl, passwordProtected) {
    const template = document.importNode(
      document.getElementById('tmp-share-result').content,
      true
    );
    const div = template.querySelector('div');
    const urlInput = div.querySelector('.share-url-input');
    const copyBtn = div.querySelector('.share-url-copy');
    const hint = div.querySelector('.share-result-hint');

    urlInput.value = shareUrl;
    copyBtn.addEventListener('click', () => {
      copyText(shareUrl);
      copyBtn.textContent = 'Copied!';
      setTimeout(() => {
        copyBtn.textContent = 'Copy';
      }, 1500);
    });

    if (hint) {
      hint.textContent = passwordProtected
        ? 'Password-protected. Share the link and password separately.'
        : 'The link includes the decryption key. Keep it safe.';
    }

    // Replace current content
    clearChildren(containerCookie);
    containerCookie.appendChild(div);

    // Restore button bar state — keep share bar visible but reset icon
    const btn = document.getElementById('save-share-cookie');
    const btnIcon = btn?.querySelector('use');
    if (btnIcon) {
      btnIcon.setAttribute('href', '../sprites/solid.svg#share-alt');
    }
    if (btn) btn.disabled = false;
  }

  /**
   * Persists the AES key for a share UUID in local storage,
   * so the user can reconstruct the full URL from My Shares.
   * @param {string} uuid
   * @param {string} keyBase64
   */
  async function storeShareKey(uuid, keyBase64) {
    const keys = (await storageHandler.getLocal('share_keys')) || {};
    keys[uuid] = keyBase64;
    await storageHandler.setLocal('share_keys', keys);
  }

  /**
   * Returns the stored key for a UUID, or null.
   * @param {string} uuid
   * @return {Promise<string|null>}
   */
  async function getShareKey(uuid) {
    const keys = (await storageHandler.getLocal('share_keys')) || {};
    return keys[uuid] || null;
  }

  /**
   * Removes a stored share key.
   * @param {string} uuid
   */
  async function removeShareKey(uuid) {
    const keys = (await storageHandler.getLocal('share_keys')) || {};
    delete keys[uuid];
    await storageHandler.setLocal('share_keys', keys);
  }

  /**
   * Renders the shares panel based on current auth state.
   */
  async function renderSharesPanel() {
    const loading = document.getElementById('shares-loading');
    const loggedOut = document.getElementById('shares-logged-out');
    const loggedIn = document.getElementById('shares-logged-in');

    if (loading) loading.style.display = 'block';
    if (loggedOut) loggedOut.style.display = 'none';
    if (loggedIn) loggedIn.style.display = 'none';

    const user = await accountHandler.getAccount();

    if (loading) loading.style.display = 'none';
    if (user) {
      if (loggedIn) loggedIn.style.display = 'block';
      renderMyShares();
    } else {
      if (loggedOut) loggedOut.style.display = 'block';
    }
  }

  /**
   * Loads and renders the My Shares list inside the shares panel.
   */
  async function renderMyShares() {
    const spinner = document.getElementById('my-shares-spinner');
    const list = document.getElementById('my-shares-list');
    if (!list) return;

    clearChildren(list);
    if (spinner) spinner.style.display = 'inline-block';

    let shares;
    try {
      shares = await listSharedCookies();
    } catch {
      if (spinner) spinner.style.display = 'none';
      return;
    }
    if (spinner) spinner.style.display = 'none';

    if (!shares || !shares.length) {
      const empty = document.createElement('li');
      empty.className = 'share-item-empty';
      empty.textContent = 'No shared links yet.';
      list.appendChild(empty);
      return;
    }

    for (const share of shares) {
      const template = document.importNode(
        document.getElementById('tmp-share-item').content,
        true
      );
      const li = template.querySelector('li');
      li.querySelector('.share-item-title').textContent =
        share.title || share.domain;
      li.querySelector('.share-item-meta').textContent =
        share.domain +
        (share.is_unlimited_exp ? ' · never expires' : ' · ' + share.exp);

      const copyBtn = li.querySelector('.share-item-copy');
      copyBtn.addEventListener('click', async () => {
        const fragment = await getShareKey(share.uuid);
        if (fragment) {
          copyText(buildShareUrl(share.uuid, fragment));
          const isPasswordProtected = fragment.startsWith('pw:');
          sendNotification(
            isPasswordProtected
              ? 'Link copied. Share the password separately.'
              : 'Share link copied.'
          );
        } else {
          sendNotification('Key not found — share again to get the link.');
        }
      });

      const deleteBtn = li.querySelector('.share-item-delete');
      deleteBtn.addEventListener('click', async () => {
        deleteBtn.disabled = true;
        try {
          await deleteSharedCookie(share.uuid);
          await removeShareKey(share.uuid);
          li.remove();
          sendNotification('Share deleted.');
        } catch (err) {
          sendNotification(err.message || 'Failed to delete share.');
          deleteBtn.disabled = false;
        }
      });

      list.appendChild(li);
    }
  }

  /**
   * Moves the button bar to the top or bottom depending on the user preference
   */
  function moveButtonBar() {
    const siblingElement = optionHandler.getButtonBarTop()
      ? document.getElementById('pageTitle').nextSibling
      : document.body.lastChild;
    document.querySelectorAll('.button-bar').forEach(bar => {
      siblingElement.parentNode.insertBefore(bar, siblingElement);
      if (optionHandler.getButtonBarTop()) {
        document.body.classList.add('button-bar-top');
      } else {
        document.body.classList.remove('button-bar-top');
      }
    });
  }
})();
