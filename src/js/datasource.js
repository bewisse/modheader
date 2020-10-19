import { writable, derived, get } from 'svelte/store';
import lodashCloneDeep from 'lodash/cloneDeep';
import lodashIsEqual from 'lodash/isEqual';
import lodashOrderBy from 'lodash/orderBy';
import lodashLast from 'lodash/last';
import lodashIsUndefined from 'lodash/isUndefined';
import lodashOmitBy from 'lodash/omitBy';
import lodashIsEmpty from 'lodash/isEmpty';
import { showMessage, hideMessage } from './toast';
import { getLocal, setLocal, removeLocal, fixProfiles } from './storage';
import { getActiveTab } from './tabs';
import { createHeader, takeRight, generateBackgroundColor, generateTextColor } from './utils';

export const profiles = writable([]);
let latestProfiles = [];
export const selectedProfileIndex = writable(0);
let latestSelectedProfileIndex = 0;
export const selectedProfile = derived(
  [
    profiles,
    selectedProfileIndex
  ],
  ([$profiles, $selectedProfileIndex]) => $profiles[$selectedProfileIndex],
  {},
);
export const isPaused = writable(false);
export const isLocked = writable(false);

export const changesStack = writable([]);
let ignoringChangeStack = true;
let isInitialized = false;
profiles.subscribe($profiles => {
  latestProfiles = $profiles;
  if (!ignoringChangeStack) {
    const changes = get(changesStack);
    const profilesCopy = lodashCloneDeep($profiles);
    if (changes.length === 0 || !lodashIsEqual(lodashLast(changes).profiles, profilesCopy)) {
      changes.push({profiles: profilesCopy});
      changesStack.set(changes);
    }
  }
});
selectedProfileIndex.subscribe($selectedProfileIndex => {
  latestSelectedProfileIndex = $selectedProfileIndex;
  if (!ignoringChangeStack) {
    const changes = get(changesStack);
    if (changes.length === 0 || lodashLast(changes).selectedProfileIndex !== $selectedProfileIndex) {
      changes.push({selectedProfileIndex: $selectedProfileIndex});
      changesStack.set(changes);
    }
  }
});
isPaused.subscribe($isPaused => {
  if (!ignoringChangeStack) {
    const changes = get(changesStack);
    if (changes.length === 0 || lodashLast(changes).isPaused !== $isPaused) {
      changes.push({isPaused: $isPaused});
      changesStack.set(changes);
    }
  }
});
isLocked.subscribe($isLocked => {
  if (!ignoringChangeStack) {
    const changes = get(changesStack);
    if (changes.length === 0 || lodashLast(changes).isLocked !== $isLocked) {
      changes.push({isLocked: $isLocked});
      changesStack.set(changes);
    }
  }
});
ignoringChangeStack = false;


function isExistingProfileTitle_(title) {
  for (const profile of latestProfiles) {
    if (profile.title === title) {
      return true;
    }
  }
  return false;
}

export function save() {
  if (process.env.BROWSER !== 'firefox') {
    const background = chrome.extension.getBackgroundPage();
    background.saveToStorage({
      profiles: latestProfiles,
      selectedProfile: latestSelectedProfileIndex
    });
  } else {
    // Firefox's private session cannot access background page, so just set
    // directly to the browser storage.
    browser.storage.local.set({
      profiles: latestProfiles,
      selectedProfile: latestSelectedProfileIndex
    });
  }
}

export async function addFilter() {
  let urlRegex = '';
  const tab = await getActiveTab();
  if (tab && !lodashIsEmpty(tab.url)) {
    const origin = new URL(tab.url).origin;
    if (!lodashIsEmpty(origin) && origin !== 'null') {
      urlRegex = origin.replace(/\//g,'\\/');
    }
  }
  const filters = latestProfiles[latestSelectedProfileIndex].filters;
  commitChange({
    filters: [
      ...filters,
      {
        enabled: true,
        type: 'urls',
        urlRegex: urlRegex,
        comment: '',
        resourceType: []
      }
    ]
  });
}

export function addHeader(headers) {
  return [...headers, createHeader()];
}

export async function addUrlReplacement(replacements) {
  let domain = '';
  const tab = await getActiveTab();
  if (tab && !lodashIsEmpty(tab.url)) {
    const origin = new URL(tab.url).origin;
    if (!lodashIsEmpty(origin) && origin !== 'null') {
      domain = origin;
    }
  }
  return [...replacements, {
    enabled: true,
    name: domain,
    value: domain,
    comment: ''
  }];
}

export function removeFilter(filterIndex) {
  const filters = lodashCloneDeep(latestProfiles[latestSelectedProfileIndex].filters);
  filters.splice(filterIndex, 1);
  commitChange({ filters });
}

export function removeHeader(headers, headerIndex) {
  headers = lodashCloneDeep(headers)
  headers.splice(headerIndex, 1);
  return headers;
}

export function removeUrlReplacement(urlReplacements, replacementIndex) {
  urlReplacements = lodashCloneDeep(urlReplacements);
  urlReplacements.splice(replacementIndex, 1);
  return urlReplacements;
}

export function commitChange(change, index = -1) {
  if (index === -1) {
    index = latestSelectedProfileIndex;
  }
  const copy = lodashCloneDeep(latestProfiles[index]);
  Object.assign(copy, change);
  if (!lodashIsEqual(latestProfiles[index], copy)) {
    latestProfiles[index] = copy;
    setProfilesAndIndex(latestProfiles, index);
  }
}

export function undo() {
  const changes = get(changesStack);
  if (changes.length === 0) {
    return;
  }
  let lastChange;
  const currentProfiles = latestProfiles;
  const currentSelectedProfileIndex = latestSelectedProfileIndex;
  const currentIsLocked = get(isLocked);
  const currentIsPaused = get(isPaused);
  while (changes.length > 0) {
    lastChange = changes.pop();
    if (!lodashIsUndefined(lastChange.profiles) &&
        !lodashIsEqual(lastChange.profiles, currentProfiles)) {
      break;
    }
    if (!lodashIsUndefined(lastChange.selectedProfileIndex) &&
        lastChange.selectedProfileIndex !== currentSelectedProfileIndex) {
      break;
    }
    if (!lodashIsUndefined(lastChange.isLocked) &&
        lastChange.isLocked !== currentIsLocked) {
      break;
    }
    if (!lodashIsUndefined(lastChange.isPaused) &&
        lastChange.isPaused !== currentIsPaused) {
      break;
    }
  }
  changesStack.set(changes);
  setProfilesAndIndex(
      lastChange.profiles || currentProfiles,
      lastChange.selectedProfileIndex || currentSelectedProfileIndex,
      { newIsLocked: lastChange.isLocked, newIsPaused: lastChange.isPaused });
  hideMessage();
}

export async function pause() {
  isPaused.set(true);
  await setLocal({ isPaused: true });
}

export async function play() {
  isPaused.set(false);
  await removeLocal('isPaused');
}

export async function lockToTab() {
  isLocked.set(true);
  if (isInitialized) {
    const { activeTabId } = await getLocal('activeTabId');
    await setLocal({ lockedTabId: activeTabId });
  }
}

export async function unlockAllTab() {
  isLocked.set(false);
  await removeLocal('lockedTabId');
}

export function createProfile() {
  let index = 1;
  while (isExistingProfileTitle_('Profile ' + index)) {
    ++index;
  }
  const profile = {
    title: 'Profile ' + index,
    hideComment: true,
    headers: [createHeader()],
    respHeaders: [],
    filters: [],
    urlReplacements: [],
    appendMode: false,
    backgroundColor: generateBackgroundColor(),
    textColor: generateTextColor(),
    shortTitle: takeRight(index),
  };
  return profile;
};

function setProfilesAndIndex(newProfiles, newIndex, { newIsLocked, newIsPaused } = {}) {
  ignoringChangeStack = true;
  newIndex = Math.max(0, Math.min(newProfiles.length - 1, newIndex));
  if (lodashIsUndefined(newIsLocked)) {
    newIsLocked = get(isLocked);
  }
  if (lodashIsUndefined(newIsPaused)) {
    newIsPaused = get(isPaused);
  }
  profiles.set(newProfiles);
  selectedProfileIndex.set(newIndex);
  if (newIsLocked) {
    lockToTab();
  } else {
    unlockAllTab();
  }
  if (newIsPaused) {
    pause();
  } else {
    play();
  }
  const changes = get(changesStack);
  changes.push({
    profiles: lodashCloneDeep(newProfiles),
    selectedProfileIndex: newIndex,
    isLocked: newIsLocked,
    isPaused: newIsPaused,
  });

  changesStack.set(changes);
  ignoringChangeStack = false;
}

export function importProfiles(importProfiles) {
  fixProfiles(importProfiles);
  const innerProfiles = latestProfiles.concat(importProfiles);
  setProfilesAndIndex(innerProfiles, innerProfiles.length - 1);
  showMessage(`Imported profiles: ${importProfiles.map(p => p.title).join(", ")}`, { canUndo: true });
}

export function addProfile() {
  const newProfile = createProfile();
  latestProfiles.push(newProfile);
  setProfilesAndIndex(latestProfiles, latestProfiles.length - 1);
}

export function selectProfile(profileIndex) {
  selectedProfileIndex.set(profileIndex);
}

export function removeProfile(profile) {
  latestProfiles.splice(latestProfiles.indexOf(profile), 1);
  if (latestProfiles.length == 0) {
    latestProfiles = [createProfile()];
  }
  setProfilesAndIndex(latestProfiles, latestProfiles.length - 1);
  showMessage('Profile deleted', { canUndo: true });
}

export function cloneProfile(profile) {
  const newProfile = lodashCloneDeep(profile);
  newProfile.title = 'Copy of ' + newProfile.title;
  latestProfiles.push(newProfile);
  setProfilesAndIndex(latestProfiles, latestProfiles.length - 1);
  showMessage('Profile cloned', { canUndo: true });
}

export function restoreToProfiles(profilesToRestore) {
  fixProfiles(profilesToRestore);
  setProfilesAndIndex(profilesToRestore, 0);
  showMessage('Profiles restored', { canUndo: true });
}

export function sortProfiles(sortOrder) {
  profiles.set(lodashOrderBy(latestProfiles, ['title'], [sortOrder]));
  if (sortOrder === 'asc') {
    showMessage('Profiles sorted in ascending order', { canUndo: true });
  } else {
    showMessage('Profiles sorted in descending order', { canUndo: true });
  }
}

export async function init() {
  const chromeLocal = await getLocal([
    'profiles', 'selectedProfile', 'lockedTabId', 'isPaused']);
  setProfilesAndIndex(chromeLocal.profiles,
    chromeLocal.selectedProfile,
    { newIsLocked: !!chromeLocal.lockedTabId,
      newIsPaused: !!chromeLocal.isPaused });
  isInitialized = true;
}
