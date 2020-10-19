import lodashIsEqual from 'lodash/isEqual';
import lodashIsUndefined from 'lodash/isUndefined';
import lodashCloneDeep from 'lodash/cloneDeep';
import {getSync, initStorage, removeLocal, removeSync, setLocal, setSync} from './storage';
import {clearContextMenu, createContextMenu, updateContextMenu} from './context-menu';
import {setBrowserAction} from './browser-action';

const MAX_PROFILES_IN_CLOUD = 50;
const CHROME_VERSION = getChromeVersion();
let chromeLocal = {
  isPaused: true,
};
let selectedActiveProfile;
let activeProfiles = [];

/**
 * Check whether the current request url pass the given list of filters.
 */
function passFilters_(url, type, filters) {
  if (!filters) {
    return true;
  }
  let allowUrls = undefined;
  let hasUrlFilters = false;
  let allowTypes = false;
  let hasResourceTypeFilters = false;
  for (let filter of filters) {
    if (filter.enabled) {
      switch (filter.type) {
        case 'urls':
          hasUrlFilters = true;
          if (allowUrls === undefined) {
            allowUrls = false;
          }
          try{
            if (new RegExp(filter.urlRegex).test(url)) {
              allowUrls = true;
            }
          }catch{
            allowUrls = false;
          }
          break;
        case 'excludeUrls':
          hasUrlFilters = true;
          if (allowUrls === undefined) {
            allowUrls = true;
          }
          try{
            if (new RegExp(filter.urlRegex).test(url)) {
              allowUrls = false;
            }
          }catch{
            allowUrls = true;
          }
          break;
        case 'types':
          hasResourceTypeFilters = true;
          if (filter.resourceType.indexOf(type) >= 0) {
            allowTypes = true;
          }
          break;
      }
    }
  }
  return (
    (!hasUrlFilters || allowUrls) && (!hasResourceTypeFilters || allowTypes)
  );
}

function filterEnabled_(rows) {
  let output = [];
  if (rows) {
    for (let row of rows) {
      // Overrides the header if it is enabled and its name is not empty.
      if (row.enabled && row.name) {
        output.push({ name: row.name, value: row.value });
      }
    }
  }
  return output;
}

function loadActiveProfiles() {
  activeProfiles = [];
  selectedActiveProfile = undefined;
  if (chromeLocal.profiles) {
    const profiles = chromeLocal.profiles;
    for (const [i, value] of profiles.entries()) {
      if (i !== chromeLocal.selectedProfile && !value.alwaysOn) {
        continue;
      }
      const profile = lodashCloneDeep(value);
      profile.headers = filterEnabled_(profile.headers);
      profile.respHeaders = filterEnabled_(profile.respHeaders);
      profile.urlReplacements = filterEnabled_(profile.urlReplacements);
      if (i === chromeLocal.selectedProfile) {
        selectedActiveProfile = value;
      }
      activeProfiles.push(profile);
    }
  }
}

function evaluateValue(value, url, oldValue) {
  if (value && value.startsWith('function')) {
    try {
      const arg = JSON.stringify({ url, oldValue });
      return (eval(`(${value})(${arg})`) || '').toString();
    } catch (err) {
      console.error(err);
    }
  }
  return value;
}

function replaceUrls(urlReplacements, url) {
  if (urlReplacements) {
    for (const replacement of urlReplacements) {
      // Avoid infinite replacement
      const replacementValue = evaluateValue(replacement.value, url, url);
      if (!url.includes(replacementValue)) {
        url = url.replace(replacement.name, replacementValue);
      }
    }
  }
  return url;
}

function modifyHeader(url, currentProfile, source, dest) {
  if (!source.length) {
    return;
  }
  // Create an index map so that we can more efficiently override
  // existing header.
  const indexMap = {};
  for (let index = 0; index < dest.length; index++) {
    const header = dest[index];
    indexMap[header.name.toLowerCase()] = index;
  }
  for (const header of source) {
    const normalizedHeaderName = header.name.toLowerCase();
    const index = indexMap[normalizedHeaderName];
    const headerValue = evaluateValue(header.value, url, index !== undefined ? dest[index].value : undefined);
    if (index !== undefined) {
      if (!currentProfile.appendMode || currentProfile.appendMode === 'false') {
        dest[index].value = headerValue;
      } else if (currentProfile.appendMode === 'comma') {
        if (dest[index].value) {
          dest[index].value += ',';
        }
        dest[index].value += headerValue;
      } else {
        dest[index].value += headerValue;
      }
    } else {
      dest.push({ name: header.name, value: headerValue });
      indexMap[normalizedHeaderName] = dest.length - 1;
    }
  }
}

function modifyRequestHandler_(details) {
  if (chromeLocal.isPaused) {
    return {};
  }
  let newUrl = details.url;
  if (!chromeLocal.lockedTabId || chromeLocal.lockedTabId === details.tabId) {
    for (const currentProfile of activeProfiles) {
      if (passFilters_(newUrl, details.type, currentProfile.filters)) {
        newUrl = replaceUrls(currentProfile.urlReplacements, newUrl);
      }
    }
  }
  if (newUrl !== details.url) {
    return { redirectUrl: newUrl };
  }
  return {};
}

function modifyRequestHeaderHandler_(details) {
  if (chromeLocal.isPaused) {
    return {};
  }
  if (!chromeLocal.lockedTabId || chromeLocal.lockedTabId === details.tabId) {
    for (const currentProfile of activeProfiles) {
      if (passFilters_(details.url, details.type, currentProfile.filters)) {
        modifyHeader(details.url, currentProfile, currentProfile.headers, details.requestHeaders);
      }
    }
  }
  return { requestHeaders: details.requestHeaders.filter(entry => !!entry.value) };
}

function modifyResponseHeaderHandler_(details) {
  if (chromeLocal.isPaused) {
    return {};
  }
  const responseHeaders = lodashCloneDeep(details.responseHeaders);
  if (!chromeLocal.lockedTabId || chromeLocal.lockedTabId === details.tabId) {
    for (const currentProfile of activeProfiles) {
      if (passFilters_(details.url, details.type, currentProfile.filters)) {
        modifyHeader(details.url, currentProfile, currentProfile.respHeaders, responseHeaders);
      }
    }
  }
  if (!lodashIsEqual(responseHeaders, details.responseHeaders)) {
    return {
      responseHeaders: responseHeaders.filter(entry => !!entry.value)
    };
  }
}

function getChromeVersion() {
  let pieces = navigator.userAgent.match(
    /Chrom(?:e|ium)\/([0-9]+)\.([0-9]+)\.([0-9]+)\.([0-9]+)/
  );
  if (pieces == null || pieces.length !== 5) {
    return {};
  }
  pieces = pieces.map(piece => parseInt(piece, 10));
  return {
    major: pieces[1],
    minor: pieces[2],
    build: pieces[3],
    patch: pieces[4]
  };
}

function setupHeaderModListener() {
  chrome.webRequest.onBeforeRequest.removeListener(modifyRequestHandler_);
  chrome.webRequest.onBeforeSendHeaders.removeListener(
    modifyRequestHeaderHandler_
  );
  chrome.webRequest.onHeadersReceived.removeListener(
    modifyResponseHeaderHandler_
  );

  // Chrome 72+ requires 'extraHeaders' to be added for some headers to be modifiable.
  // Older versions break with it.
  let hasRequestHeadersModification = false;
  let hasResponseHeadersModification = false;
  let hasUrlReplacement = false;
  for (const currentProfile of activeProfiles) {
    if (currentProfile.headers.length > 0) {
      hasRequestHeadersModification = true;
    }
    if (currentProfile.respHeaders.length > 0) {
      hasResponseHeadersModification = true;
    }
    if (currentProfile.urlReplacements.length > 0) {
      hasUrlReplacement = true;
    }
  }
  if (hasRequestHeadersModification) {
    let requiresExtraRequestHeaders = false;
    if (CHROME_VERSION.major >= 72) {
      requiresExtraRequestHeaders = true;
    }
    chrome.webRequest.onBeforeSendHeaders.addListener(
      modifyRequestHeaderHandler_,
      { urls: ['<all_urls>'] },
      requiresExtraRequestHeaders
        ? ['requestHeaders', 'blocking', 'extraHeaders']
        : ['requestHeaders', 'blocking']
    );
  }
  if (hasResponseHeadersModification) {
    let requiresExtraResponseHeaders = false;
    if (CHROME_VERSION.major >= 72) {
      requiresExtraResponseHeaders = true;
    }
    chrome.webRequest.onHeadersReceived.addListener(
      modifyResponseHeaderHandler_,
      { urls: ['<all_urls>'] },
      requiresExtraResponseHeaders
        ? ['responseHeaders', 'blocking', 'extraHeaders']
        : ['responseHeaders', 'blocking']
    );
  }

  if (hasUrlReplacement) {
    chrome.webRequest.onBeforeRequest.addListener(
      modifyRequestHandler_,
      { urls: ['<all_urls>'] },
      ['blocking']
    );
  }
}

async function onTabUpdated(tab) {
  await setLocal({activeTabId: tab.id});
  await resetBadge();
  await resetContextMenu();
}

chrome.tabs.onActivated.addListener(activeInfo => {
  chrome.tabs.get(activeInfo.tabId, onTabUpdated);
});

chrome.windows.onFocusChanged.addListener(windowId => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    return;
  }
  chrome.windows.get(windowId, { populate: true }, async win => {
    for (const tab of win.tabs) {
      if (tab.active) {
        await onTabUpdated(tab);
        break;
      }
    }
  });
});

async function saveStorageToCloud() {
  const items = await getSync();
  const keys = items ? Object.keys(items) : [];
  keys.sort();
  if (
      keys.length === 0 ||
      items[keys[keys.length - 1]] !== chromeLocal.profiles
  ) {
    const data = {};
    data[Date.now()] = chromeLocal.profiles;
    await Promise.all([setSync(data), setLocal({savedToCloud: true})]);
  }
  if (keys.length >= MAX_PROFILES_IN_CLOUD) {
    await removeSync(keys.slice(0, keys.length - MAX_PROFILES_IN_CLOUD));
  }
}

async function resetContextMenu() {
  if (chromeLocal.isPaused) {
    await updateContextMenu('pause', {
      title: 'Unpause ModHeader',
      contexts: ['browser_action'],
      onclick: async () => {
        await removeLocal('isPaused');
      }
    });
  } else {
    await updateContextMenu('pause', {
      title: 'Pause ModHeader',
      contexts: ['browser_action'],
      onclick: async () => {
        await setLocal({isPaused: true});
      }
    });
  }
  if (chromeLocal.lockedTabId) {
    await updateContextMenu('lock', {
      title: 'Unlock to all tabs',
      contexts: ['browser_action'],
      onclick: async () => {
        await removeLocal('lockedTabId');
      }
    });
  } else {
    await updateContextMenu('lock', {
      title: 'Lock to this tab',
      contexts: ['browser_action'],
      onclick: async () => {
        await setLocal({ lockedTabId: chromeLocal.activeTabId });
      }
    });
  }
}

async function resetBadge() {
  if (chromeLocal.isPaused) {
    await setBrowserAction({
      icon: 'images/icon_bw.png',
      text: '\u275A\u275A',
      color: '#666'
    });
  } else {
    let numHeaders = 0;
    for (const currentProfile of activeProfiles) {
      numHeaders += currentProfile.headers.length + currentProfile.respHeaders.length + currentProfile.urlReplacements.length;
    }
    if (numHeaders === 0) {
      await setBrowserAction({
        icon: 'images/icon_bw.png',
        text: '',
        color: '#ffffff'
      });
    } else if (
        chromeLocal.lockedTabId &&
        chromeLocal.lockedTabId !== chromeLocal.activeTabId
    ) {
      await setBrowserAction({
        icon: 'images/icon_bw.png',
        text: '\uD83D\uDD12',
        color: '#ff8e8e'
      });
    } else {
      await setBrowserAction({
        icon: 'images/icon.png',
        text: numHeaders.toString(),
        color: selectedActiveProfile.backgroundColor
      });
    }
  }
}

async function initialize() {
  await clearContextMenu();
  await createContextMenu({
    id: 'pause',
    title: 'Pause',
    contexts: ['browser_action']
  });
  await createContextMenu({
    id: 'lock',
    title: 'Lock',
    contexts: ['browser_action']
  });
  chromeLocal = await initStorage();
  loadActiveProfiles();
  setupHeaderModListener();
  await resetBadge();
  await resetContextMenu();

  chrome.storage.onChanged.addListener(async (changes, areaName) => {
    if (areaName !== 'local') {
      return;
    }
    const profilesUpdated = !lodashIsUndefined(changes.profiles)
        && !lodashIsEqual(chromeLocal.profiles, changes.profiles.newValue);
    const selectedProfileUpdated = !lodashIsUndefined(changes.selectedProfile)
        && !lodashIsEqual(chromeLocal.selectedProfile, changes.selectedProfile.newValue);
    for (const [key, value] of Object.entries(changes)) {
      chromeLocal[key] = value.newValue;
    }
    if (profilesUpdated || selectedProfileUpdated) {
      loadActiveProfiles();
      saveStorageToCloud();
      setupHeaderModListener();
    }
    await resetBadge();
    await resetContextMenu();
  });
}
initialize();

chrome.runtime.onInstalled.addListener(details => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: 'https://r.bewisse.com/modheader/postinstall' });
  }
});

window.saveToStorage = function(items) {
  return setLocal(items);
};
