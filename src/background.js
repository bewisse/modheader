const browser = chrome;
const SPECIAL_CHARS = '^$&+?.()|{}[]/'.split('');
const MAX_PROFILES_IN_CLOUD = 50;
const CHROME_VERSION = getChromeVersion();
let currentProfile;
let tabUrls = {};

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
          if (url.search(filter.urlRegex) == 0) {
            allowUrls = true;
          }
          break;
        case 'excludeUrls':
          hasUrlFilters = true;
          if (allowUrls === undefined) {
            allowUrls = true;
          }
          if (url.search(filter.urlRegex) == 0) {
            allowUrls = false;
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

function loadSelectedProfile_() {
  let appendMode = false;
  let headers = [];
  let respHeaders = [];
  let filters = [];
  let urlReplacements = [];
  if (localStorage.profiles) {
    const profiles = JSON.parse(localStorage.profiles);
    if (!localStorage.selectedProfile) {
      localStorage.selectedProfile = 0;
    }
    const selectedProfile = profiles[localStorage.selectedProfile];

    function filterEnabled_(rows) {
      let output = [];
      for (let row of rows) {
        // Overrides the header if it is enabled and its name is not empty.
        if (row.enabled && row.name) {
          output.push({ name: row.name, value: row.value });
        }
      }
      return output;
    }
    for (let filter of selectedProfile.filters) {
      if (filter.urlPattern) {
        const urlPattern = filter.urlPattern;
        const joiner = [];
        for (let i = 0; i < urlPattern.length; ++i) {
          let c = urlPattern.charAt(i);
          if (SPECIAL_CHARS.indexOf(c) >= 0) {
            c = '\\' + c;
          } else if (c == '\\') {
            c = '\\\\';
          } else if (c == '*') {
            c = '.*';
          }
          joiner.push(c);
        }
        filter.urlRegex = joiner.join('');
      }
      filters.push(filter);
    }
    appendMode = selectedProfile.appendMode;
    headers = filterEnabled_(selectedProfile.headers);
    respHeaders = filterEnabled_(selectedProfile.respHeaders);
    urlReplacements = filterEnabled_(selectedProfile.urlReplacements);
  }
  return {
    appendMode,
    headers,
    respHeaders,
    urlReplacements,
    filters
  };
}

function replaceUrls(urlReplacements, url) {
  if (urlReplacements) {
    for (const replacement of urlReplacements) {
      url = url.replace(replacement.name, replacement.value);
    }
  }
  return url;
}

function modifyHeader(source, dest) {
  if (!source.length) {
    return;
  }
  // Create an index map so that we can more efficiently override
  // existing header.
  const indexMap = {};
  for (const index in dest) {
    const header = dest[index];
    indexMap[header.name.toLowerCase()] = index;
  }
  for (let header of source) {
    const index = indexMap[header.name.toLowerCase()];
    if (index !== undefined) {
      if (!currentProfile.appendMode || currentProfile.appendMode === 'false') {
        dest[index].value = header.value;
      } else if (currentProfile.appendMode == 'comma') {
        if (dest[index].value) {
          dest[index].value += ',';
        }
        dest[index].value += header.value;
      } else {
        dest[index].value += header.value;
      }
    } else {
      dest.push({ name: header.name, value: header.value });
      indexMap[header.name.toLowerCase()] = dest.length - 1;
    }
  }
}

function modifyRequestHandler_(details) {
  if (localStorage.isPaused) {
    return {};
  }
  if (details.type == 'main_frame' && details.url && details.tabId >= 0) {
    tabUrls[details.tabId] = details.url;
    localStorage.activeTabId = details.tabId;
    browser.tabs.get(details.tabId, onTabUpdated);
  }
  if (!localStorage.lockedTabId || localStorage.lockedTabId == details.tabId) {
    if (
      currentProfile &&
      passFilters_(details.url, details.type, currentProfile.filters)
    ) {
      const newUrl = replaceUrls(currentProfile.urlReplacements, details.url);
      if (newUrl !== details.url) {
        return { redirectUrl: newUrl };
      }
    }
  }
  return {};
}

function modifyRequestHeaderHandler_(details) {
  if (localStorage.isPaused) {
    return {};
  }
  if (!localStorage.lockedTabId || localStorage.lockedTabId == details.tabId) {
    if (
      currentProfile &&
      passFilters_(details.url, details.type, currentProfile.filters)
    ) {
      modifyHeader(currentProfile.headers, details.requestHeaders);
    }
  }
  return { requestHeaders: details.requestHeaders };
}

function modifyResponseHeaderHandler_(details) {
  if (localStorage.isPaused) {
    return {};
  }
  if (!localStorage.lockedTabId || localStorage.lockedTabId == details.tabId) {
    if (
      currentProfile &&
      passFilters_(details.url, details.type, currentProfile.filters)
    ) {
      const serializedOriginalResponseHeaders = JSON.stringify(
        details.responseHeaders
      );
      const responseHeaders = JSON.parse(serializedOriginalResponseHeaders);
      modifyHeader(currentProfile.respHeaders, responseHeaders);
      if (
        JSON.stringify(responseHeaders) != serializedOriginalResponseHeaders
      ) {
        return {
          responseHeaders: responseHeaders
        };
      }
    }
  }
}

function getChromeVersion() {
  let pieces = navigator.userAgent.match(
    /Chrom(?:e|ium)\/([0-9]+)\.([0-9]+)\.([0-9]+)\.([0-9]+)/
  );
  if (pieces == null || pieces.length != 5) {
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
  browser.webRequest.onBeforeRequest.removeListener(modifyRequestHandler_);
  browser.webRequest.onBeforeSendHeaders.removeListener(
    modifyRequestHeaderHandler_
  );
  browser.webRequest.onHeadersReceived.removeListener(
    modifyResponseHeaderHandler_
  );

  // Chrome 72+ requires 'extraHeaders' to be added for some headers to be modifiable.
  // Older versions break with it.
  if (currentProfile.headers.length > 0) {
    let requiresExtraRequestHeaders = false;
    if (CHROME_VERSION.major >= 72) {
      requiresExtraRequestHeaders = true;
    }
    browser.webRequest.onBeforeSendHeaders.addListener(
      modifyRequestHeaderHandler_,
      { urls: ['<all_urls>'] },
      requiresExtraRequestHeaders
        ? ['requestHeaders', 'blocking', 'extraHeaders']
        : ['requestHeaders', 'blocking']
    );
  }
  if (currentProfile.respHeaders.length > 0) {
    let requiresExtraResponseHeaders = false;
    if (CHROME_VERSION.major >= 72) {
      requiresExtraResponseHeaders = true;
    }
    browser.webRequest.onHeadersReceived.addListener(
      modifyResponseHeaderHandler_,
      { urls: ['<all_urls>'] },
      requiresExtraResponseHeaders
        ? ['responseHeaders', 'blocking', 'extraHeaders']
        : ['responseHeaders', 'blocking']
    );
  }

  browser.webRequest.onBeforeRequest.addListener(
    modifyRequestHandler_,
    { urls: ['<all_urls>'] },
    ['blocking']
  );
}

function onTabUpdated(tab) {
  if (tab.active) {
    delete localStorage.currentTabUrl;
    // Since we don't have access to the "tabs" permission, we may not have
    // access to the url property all the time. So, match it against the URL
    // found during request modification.
    let url = tab.url;
    if (url) {
      tabUrls[tab.id] = url;
    } else {
      url = tabUrls[tab.id];
    }
    localStorage.activeTabId = tab.id;

    // Only set the currentTabUrl property if the tab is active and the window
    // is in focus.
    browser.windows.get(tab.windowId, {}, win => {
      if (win.focused) {
        localStorage.currentTabUrl = url;
      }
    });
    if (!url) {
      return;
    }
    resetBadgeAndContextMenu();
  }
}

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  onTabUpdated(tab);
});

browser.tabs.onActivated.addListener(activeInfo => {
  browser.tabs.get(activeInfo.tabId, onTabUpdated);
});

browser.windows.onFocusChanged.addListener(windowId => {
  if (windowId == browser.windows.WINDOW_ID_NONE) {
    return;
  }
  browser.windows.get(windowId, { populate: true }, win => {
    for (let tab of win.tabs) {
      onTabUpdated(tab);
    }
  });
});

function saveStorageToCloud() {
  browser.storage.sync.get(null, items => {
    const keys = items ? Object.keys(items) : [];
    keys.sort();
    if (
      keys.length == 0 ||
      items[keys[keys.length - 1]] != localStorage.profiles
    ) {
      const data = {};
      data[Date.now()] = localStorage.profiles;
      browser.storage.sync.set(data);
      localStorage.savedToCloud = true;
    }
    if (keys.length >= MAX_PROFILES_IN_CLOUD) {
      browser.storage.sync.remove(
        keys.slice(0, keys.length - MAX_PROFILES_IN_CLOUD)
      );
    }
  });
}

function createContextMenu() {
  if (localStorage.isPaused) {
    browser.contextMenus.update('pause', {
      title: 'Unpause ModHeader',
      contexts: ['browser_action'],
      onclick: () => {
        localStorage.removeItem('isPaused');
        resetBadgeAndContextMenu();
      }
    });
  } else {
    browser.contextMenus.update('pause', {
      title: 'Pause ModHeader',
      contexts: ['browser_action'],
      onclick: () => {
        localStorage.isPaused = true;
        resetBadgeAndContextMenu();
      }
    });
  }
  if (localStorage.lockedTabId) {
    browser.contextMenus.update('lock', {
      title: 'Unlock to all tabs',
      contexts: ['browser_action'],
      onclick: () => {
        localStorage.removeItem('lockedTabId');
        resetBadgeAndContextMenu();
      }
    });
  } else {
    browser.contextMenus.update('lock', {
      title: 'Lock to this tab',
      contexts: ['browser_action'],
      onclick: () => {
        localStorage.lockedTabId = localStorage.activeTabId;
        resetBadgeAndContextMenu();
      }
    });
  }
}

function resetBadgeAndContextMenu() {
  if (localStorage.isPaused) {
    browser.browserAction.setIcon({ path: 'icon_bw.png' });
    browser.browserAction.setBadgeText({ text: '\u275A\u275A' });
    browser.browserAction.setBadgeBackgroundColor({ color: '#666' });
  } else {
    const numHeaders =
      currentProfile.headers.length + currentProfile.respHeaders.length;
    if (numHeaders == 0) {
      browser.browserAction.setBadgeText({ text: '' });
      browser.browserAction.setIcon({ path: 'icon_bw.png' });
    } else if (
      localStorage.lockedTabId &&
      localStorage.lockedTabId != localStorage.activeTabId
    ) {
      browser.browserAction.setIcon({ path: 'icon_bw.png' });
      browser.browserAction.setBadgeText({ text: '\uD83D\uDD12' });
      browser.browserAction.setBadgeBackgroundColor({ color: '#ff8e8e' });
    } else {
      browser.browserAction.setIcon({ path: 'icon.png' });
      browser.browserAction.setBadgeText({ text: numHeaders.toString() });
      browser.browserAction.setBadgeBackgroundColor({ color: '#db4343' });
    }
  }
  createContextMenu();
}

function initializeStorage() {
  currentProfile = loadSelectedProfile_();
  setupHeaderModListener();

  window.addEventListener('storage', function(e) {
    currentProfile = loadSelectedProfile_();
    setupHeaderModListener();
    resetBadgeAndContextMenu();
    if (e.key == 'profiles') {
      saveStorageToCloud();
    }
  });

  // Async initialization.
  setTimeout(() => {
    if (localStorage.profiles && !localStorage.savedToCloud) {
      saveStorageToCloud();
    }

    if (!localStorage.profiles) {
      browser.storage.sync.get(null, items => {
        const keys = items ? Object.keys(items) : [];
        keys.sort();
        if (keys.length > 0) {
          localStorage.profiles = items[keys[keys.length - 1]];
          localStorage.savedToCloud = true;
        }
      });
    }
  }, 100);
}
browser.contextMenus.create({
  id: 'pause',
  title: 'Pause',
  contexts: ['browser_action']
});
browser.contextMenus.create({
  id: 'lock',
  title: 'Lock',
  contexts: ['browser_action']
});
initializeStorage();
resetBadgeAndContextMenu();

//chrome.runtime.onInstalled.addListener(details => {
//  if (details.reason === 'install') {
//    chrome.tabs.create({ url: 'https://r.bewisse.com/modheader/postinstall' });
//  }
//});
