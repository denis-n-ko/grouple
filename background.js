/**
 * Grouple – background service worker
 *
 * Groups all open tabs in each window by their base domain, so tabs from
 * different subdomains of the same site land in one group.
 * Tabs without an http/https URL (new-tab, chrome://, etc.) are left ungrouped.
 */

const TAB_GROUP_ID_NONE = -1;

/** Group-colour palette used when creating new groups. */
const COLORS = [
  'blue', 'red', 'yellow', 'green',
  'pink', 'purple', 'cyan', 'orange',
];

/**
 * Deterministic colour for a domain so the same domain always gets the
 * same colour regardless of the order tabs are opened.
 */
function getColorForDomain(domain) {
  let hash = 0;
  for (let i = 0; i < domain.length; i++) {
    hash = (hash * 31 + domain.charCodeAt(i)) & 0xffffffff;
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}

/**
 * Common two-part public suffixes so e.g. foo.co.uk collapses to foo.co.uk,
 * not co.uk. Not the full Public Suffix List — just the frequent cases.
 */
const MULTI_PART_TLDS = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'net.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.nz', 'net.nz', 'org.nz',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp',
  'com.br', 'net.br', 'org.br',
  'co.in', 'net.in', 'org.in',
  'com.mx', 'com.ar', 'com.tr', 'com.cn', 'com.tw', 'com.sg', 'com.hk',
  'co.za', 'co.kr', 'com.ua', 'co.il', 'com.pl',
]);

/**
 * User-configured domains (set via the popup) that should behave like an
 * entry in MULTI_PART_TLDS: subdomains under them keep one extra label
 * instead of collapsing together, so e.g. gitlab.inbit.org and
 * privatebin.inbit.org stay in separate groups rather than merging into
 * inbit.org. Populated from chrome.storage.local; see settingsReady below.
 */
let customNoMergeDomains = new Set();
const STORAGE_NO_MERGE_KEY = 'noMergeDomains';

function normalizeNoMergeList(list) {
  return Array.isArray(list) ? list.map(d => String(d).trim().toLowerCase()).filter(Boolean) : [];
}

/**
 * The manual group: the one group the user fills by hand (Cmd/Ctrl+Alt+click a
 * link, the link context menu, or the toggle-tab-work-group command) to keep
 * everything for one task together. Domain regrouping never touches its tabs.
 * Like every other group here it is identified by its title, which the user
 * can rename from the popup's settings panel.
 */
const STORAGE_WORK_TITLE_KEY = 'workGroupTitle';
const DEFAULT_WORK_GROUP_TITLE = 'WORK';
/** Grey is absent from COLORS, so the manual group never looks like a domain group. */
const WORK_GROUP_COLOR = 'grey';
let workGroupTitle = DEFAULT_WORK_GROUP_TITLE;

function normalizeWorkTitle(value) {
  const title = typeof value === 'string' ? value.trim() : '';
  return title || DEFAULT_WORK_GROUP_TITLE;
}

const settingsReady = chrome.storage.local.get({
  [STORAGE_NO_MERGE_KEY]: [],
  [STORAGE_WORK_TITLE_KEY]: DEFAULT_WORK_GROUP_TITLE,
}).then((data) => {
  customNoMergeDomains = new Set(normalizeNoMergeList(data[STORAGE_NO_MERGE_KEY]));
  workGroupTitle = normalizeWorkTitle(data[STORAGE_WORK_TITLE_KEY]);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;

  if (changes[STORAGE_NO_MERGE_KEY]) {
    customNoMergeDomains = new Set(normalizeNoMergeList(changes[STORAGE_NO_MERGE_KEY].newValue));
    scheduleRegroup(null);
  }

  if (changes[STORAGE_WORK_TITLE_KEY]) {
    // oldValue rather than the in-memory title: a just-woken service worker
    // may not have finished loading settings yet.
    const previousTitle = normalizeWorkTitle(changes[STORAGE_WORK_TITLE_KEY].oldValue);
    workGroupTitle = normalizeWorkTitle(changes[STORAGE_WORK_TITLE_KEY].newValue);
    // Retitle groups that are already open, otherwise they would stop being
    // recognised as the manual group and get pulled back into domain grouping.
    renameWorkGroups(previousTitle).catch(console.error);
    updateWorkContextMenu();
  }
});

/**
 * Strips subdomains from a hostname, returning the registrable base domain
 * (mail.google.com → google.com). IP addresses and single-label hosts
 * (localhost) are returned unchanged. Domains in MULTI_PART_TLDS or the
 * user's custom no-merge list keep one extra label instead of collapsing.
 */
function getBaseDomain(hostname) {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return hostname;
  const parts = hostname.split('.');
  if (parts.length <= 2) return hostname;
  const lastTwo = parts.slice(-2).join('.');
  const keepExtra = MULTI_PART_TLDS.has(lastTwo) || customNoMergeDomains.has(lastTwo);
  return parts.slice(keepExtra ? -3 : -2).join('.');
}

/**
 * Returns the base domain for a URL string, or null if the URL is not
 * a regular http/https page (new-tab, chrome://, etc.).
 */
function getDomain(url) {
  if (!url) return null;
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== 'http:' && protocol !== 'https:') return null;
    return hostname ? getBaseDomain(hostname) : null;
  } catch {
    return null;
  }
}

/**
 * Re-groups all tabs in the given window by domain.
 *
 * Algorithm:
 *  1. Build a domain → tabIds map from the current tab list, ignoring pinned
 *     tabs and tabs in the manual group entirely (they are never grouped and
 *     never counted for the ≥ 2 threshold).
 *  2. Ungroup any tab whose URL doesn't have an http/https domain, and any
 *     tab that is the sole tab for its domain (groups need ≥ 2 tabs).
 *  3. For each domain that has ≥ 2 tabs:
 *       – Re-use an existing group whose title matches the domain, or
 *       – Create a new group, then set its title and colour.
 */
async function regroupTabsInWindow(windowId) {
  await settingsReady;
  const [tabs, groupsBeforeRegroup] = await Promise.all([
    chrome.tabs.query({ windowId }),
    chrome.tabGroups.query({ windowId }),
  ]);

  // Tabs the user deliberately put in the manual group are off-limits: they
  // stay there regardless of their domain until the user takes them out.
  const workGroupIds = new Set(
    groupsBeforeRegroup.filter(g => g.title === workGroupTitle).map(g => g.id)
  );

  // ── 1. Categorise tabs ──────────────────────────────────────────────────
  const domainToTabIds = new Map();
  const noGroupTabIds = [];

  for (const tab of tabs) {
    if (tab.pinned) continue; // pinned tabs are left exactly as the user put them
    if (workGroupIds.has(tab.groupId)) continue; // manually collected, never regrouped

    const domain = getDomain(tab.pendingUrl || tab.url);
    if (domain) {
      if (!domainToTabIds.has(domain)) domainToTabIds.set(domain, []);
      domainToTabIds.get(domain).push(tab.id);
    } else {
      noGroupTabIds.push(tab);
    }
  }

  // Build a quick tabId → current groupId lookup from the already-fetched tabs.
  const tabGroupMap = new Map(tabs.map(t => [t.id, t.groupId]));

  // ── 2. Ungroup non-http tabs and sole-tab domains ───────────────────────
  for (const tab of noGroupTabIds) {
    if (tab.groupId !== TAB_GROUP_ID_NONE) {
      await chrome.tabs.ungroup([tab.id]);
    }
  }

  for (const [, tabIds] of domainToTabIds) {
    if (tabIds.length < 2) {
      const tabId = tabIds[0];
      if (tabGroupMap.get(tabId) !== TAB_GROUP_ID_NONE) {
        await chrome.tabs.ungroup([tabId]);
      }
    }
  }

  // ── 3. Group tabs by domain (≥ 2 tabs only) ─────────────────────────────
  // Build a title → groupId map for groups that already exist in this window.
  const existingGroups = await chrome.tabGroups.query({ windowId });
  const titleToGroupId = new Map(
    existingGroups
      .filter(g => g.title && g.title !== workGroupTitle)
      .map(g => [g.title, g.id])
  );

  for (const [domain, tabIds] of domainToTabIds) {
    if (tabIds.length < 2) continue; // single tab – leave ungrouped

    if (titleToGroupId.has(domain)) {
      // Add all domain tabs to the pre-existing group.
      await chrome.tabs.group({ groupId: titleToGroupId.get(domain), tabIds });
    } else {
      // Create a new group, then label and colour it.
      const groupId = await chrome.tabs.group({ tabIds });
      await chrome.tabGroups.update(groupId, {
        title: domain,
        color: getColorForDomain(domain),
      });
      titleToGroupId.set(domain, groupId);
    }
  }
}

// ── Manual "WORK" group ──────────────────────────────────────────────────────
// Filled by Cmd/Ctrl+Alt+click on a link (see content.js), the link context
// menu, or the toggle-tab-work-group command. regroupTabsInWindow skips every
// tab in it, so a task's links stay together instead of scattering by domain.

/** The manual group in a window, or null if it doesn't exist there yet. */
async function findWorkGroup(windowId) {
  const groups = await chrome.tabGroups.query({ windowId });
  return groups.find(g => g.title === workGroupTitle) || null;
}

/**
 * Moves tabs into the window's manual group, creating and labelling the group
 * when this is the first tab to land in it. Returns the group id.
 */
async function addTabsToWorkGroup(tabIds, windowId) {
  await settingsReady;

  const existing = await findWorkGroup(windowId);
  if (existing) {
    await chrome.tabs.group({ groupId: existing.id, tabIds });
    return existing.id;
  }

  const groupId = await chrome.tabs.group({ createProperties: { windowId }, tabIds });
  await chrome.tabGroups.update(groupId, {
    title: workGroupTitle,
    color: WORK_GROUP_COLOR,
  });
  return groupId;
}

/**
 * Opens a URL in a background tab next to the tab it came from and puts it in
 * the manual group straight away — before the debounced regroup can run, so the
 * tab is never briefly grouped by domain.
 *
 * The URL arrives from a content script, i.e. from a web page, so it is
 * re-checked here rather than trusted.
 */
async function openInWorkGroup(url, sourceTab) {
  if (!/^https?:\/\//i.test(url || '')) {
    throw new Error('Only http/https links can be opened in the manual group.');
  }

  const windowId = sourceTab ? sourceTab.windowId : (await chrome.windows.getCurrent()).id;
  const createProperties = { url, windowId, active: false };
  if (sourceTab) {
    createProperties.index = sourceTab.index + 1;
    createProperties.openerTabId = sourceTab.id;
  }

  const tab = await chrome.tabs.create(createProperties);
  await addTabsToWorkGroup([tab.id], windowId);
  return tab.id;
}

/** Adds the active tab to the manual group, or takes it out if it's already in. */
async function toggleActiveTabInWorkGroup() {
  await settingsReady;

  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) return;

  const workGroup = await findWorkGroup(tab.windowId);
  if (workGroup && tab.groupId === workGroup.id) {
    await chrome.tabs.ungroup([tab.id]);
    scheduleRegroup(tab.windowId); // hand it back to domain grouping
    return;
  }

  await addTabsToWorkGroup([tab.id], tab.windowId);
}

/**
 * Empties the manual group in a window — the "task finished" reset. Its tabs
 * become ordinary tabs again and the next regroup files them by domain.
 */
async function releaseWorkGroup(windowId) {
  await settingsReady;

  const workGroup = await findWorkGroup(windowId);
  if (!workGroup) return false;

  const tabs = await chrome.tabs.query({ windowId, groupId: workGroup.id });
  if (tabs.length > 0) {
    await chrome.tabs.ungroup(tabs.map(t => t.id));
  }
  scheduleRegroup(windowId);
  return true;
}

/** Retitles open manual groups after the user renames the group in settings. */
async function renameWorkGroups(previousTitle) {
  if (!previousTitle || previousTitle === workGroupTitle) return;

  const groups = await chrome.tabGroups.query({});
  for (const group of groups.filter(g => g.title === previousTitle)) {
    await chrome.tabGroups.update(group.id, { title: workGroupTitle }).catch(console.error);
  }
}

// ── Link context menu ────────────────────────────────────────────────────────
// Same destination as the click shortcut, but it also works where content
// scripts can't run (the Web Store, PDF viewer, pages open since before the
// extension was loaded).

const WORK_MENU_ID = 'grouple-open-link-in-work-group';

function workMenuTitle() {
  return `Open link in "${workGroupTitle}" group`;
}

async function createWorkContextMenu() {
  await settingsReady;
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: WORK_MENU_ID,
    title: workMenuTitle(),
    contexts: ['link'],
  });
}

function updateWorkContextMenu() {
  chrome.contextMenus.update(WORK_MENU_ID, { title: workMenuTitle() }).catch(() => {});
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== WORK_MENU_ID || !info.linkUrl) return;
  openInWorkGroup(info.linkUrl, tab).catch(console.error);
});

// ── Debounced regroup ────────────────────────────────────────────────────────
// Many tab events can fire in rapid succession (e.g. on startup).
// We coalesce them into a single call per window with a small delay.
const pendingWindows = new Set();
let debounceTimer = null;
const windowsWithGroupMoveInProgress = new Set();

function scheduleRegroup(windowId) {
  if (windowId != null) {
    pendingWindows.add(windowId);
  } else {
    // null means "all windows"
    pendingWindows.add('all');
  }

  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    debounceTimer = null;
    const toProcess = new Set(pendingWindows);
    pendingWindows.clear();

    if (toProcess.has('all')) {
      const windows = await chrome.windows.getAll();
      for (const win of windows) {
        await regroupTabsInWindow(win.id).catch(console.error);
      }
    } else {
      for (const wid of toProcess) {
        await regroupTabsInWindow(wid).catch(console.error);
      }
    }
  }, 400);
}

// ── Tab event listeners ──────────────────────────────────────────────────────

chrome.tabs.onCreated.addListener((tab) => {
  scheduleRegroup(tab.windowId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Re-group when the URL changes, the page finishes loading, or the tab is
  // pinned/unpinned (pinned tabs are excluded from grouping, so toggling it
  // changes whether the tab's domain still has ≥ 2 groupable tabs).
  if (changeInfo.url !== undefined
    || changeInfo.status === 'complete'
    || changeInfo.pinned !== undefined) {
    scheduleRegroup(tab.windowId);
  }
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  if (!removeInfo.isWindowClosing) {
    scheduleRegroup(removeInfo.windowId);
  }
});

chrome.tabs.onMoved.addListener((tabId, moveInfo) => {
  if (windowsWithGroupMoveInProgress.has(moveInfo.windowId)) return;
  scheduleRegroup(moveInfo.windowId);
});

chrome.tabs.onAttached.addListener((tabId, attachInfo) => {
  scheduleRegroup(attachInfo.newWindowId);
});

chrome.tabs.onDetached.addListener((tabId, detachInfo) => {
  scheduleRegroup(detachInfo.oldWindowId);
});

// ── Global keyboard commands ─────────────────────────────────────────────────
// Bound in manifest.json "commands"; users can rebind at brave://extensions/shortcuts.

/**
 * Collapses or expands every tab group in the last-focused window.
 * When collapsing, the group holding the active tab is handled last so the
 * browser only has to re-activate a tab once; if that final collapse is
 * rejected (e.g. no other tab to activate), the group is left open.
 */
async function setAllGroupsCollapsed(collapsed) {
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!activeTab) return;

  const groups = await chrome.tabGroups.query({ windowId: activeTab.windowId });
  const ordered = collapsed
    ? [...groups.filter(g => g.id !== activeTab.groupId),
       ...groups.filter(g => g.id === activeTab.groupId)]
    : groups;

  for (const group of ordered) {
    if (group.collapsed === collapsed) continue;
    await chrome.tabGroups.update(group.id, { collapsed }).catch(console.error);
  }
}

/** Expands the active tab's group and collapses all other groups in its window. */
async function focusActiveTabGroup() {
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!activeTab) return;

  const groups = await chrome.tabGroups.query({ windowId: activeTab.windowId });
  for (const group of groups) {
    const shouldCollapse = group.id !== activeTab.groupId;
    if (group.collapsed === shouldCollapse) continue;
    await chrome.tabGroups.update(group.id, { collapsed: shouldCollapse }).catch(console.error);
  }
}

chrome.commands.onCommand.addListener((command) => {
  if (command === 'fold-all-groups') {
    setAllGroupsCollapsed(true).catch(console.error);
  } else if (command === 'unfold-all-groups') {
    setAllGroupsCollapsed(false).catch(console.error);
  } else if (command === 'focus-active-group') {
    focusActiveTabGroup().catch(console.error);
  } else if (command === 'toggle-tab-work-group') {
    toggleActiveTabInWorkGroup().catch(console.error);
  }
});

// ── Message listener (from popup) ───────────────────────────────────────────

async function moveGroupInWindow(groupId, offset, windowId) {
  if (offset !== -1 && offset !== 1) {
    throw new Error('Group move direction must be -1 or 1.');
  }

  const tabs = (await chrome.tabs.query({ windowId })).sort((a, b) => a.index - b.index);
  const tabsByGroupId = new Map();
  for (const tab of tabs) {
    if (tab.groupId === TAB_GROUP_ID_NONE) continue;
    if (!tabsByGroupId.has(tab.groupId)) tabsByGroupId.set(tab.groupId, []);
    tabsByGroupId.get(tab.groupId).push(tab);
  }

  const orderedGroupIds = [...tabsByGroupId.keys()].sort((a, b) =>
    tabsByGroupId.get(a)[0].index - tabsByGroupId.get(b)[0].index
  );
  const sourceIndex = orderedGroupIds.indexOf(groupId);
  const targetIndex = sourceIndex + offset;
  if (sourceIndex === -1 || targetIndex < 0 || targetIndex >= orderedGroupIds.length) {
    return false;
  }

  // chrome.tabGroups.move rejects any destination index that lands in the
  // middle of another group in the current tab strip, so we can only ever
  // target a group's first-tab index (a valid boundary). Moving a group down
  // past the next group is equivalent to moving that next group up past this
  // one, which lets both directions use a first-tab index.
  const movingGroupId = offset < 0 ? groupId : orderedGroupIds[targetIndex];
  const anchorGroupId = offset < 0 ? orderedGroupIds[targetIndex] : groupId;
  const destinationIndex = tabsByGroupId.get(anchorGroupId)[0].index;

  windowsWithGroupMoveInProgress.add(windowId);
  try {
    try {
      await chrome.tabGroups.move(movingGroupId, { index: destinationIndex });
    } catch (error) {
      if (!String(error.message || error).includes('Tabs cannot be edited right now')) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
      await chrome.tabGroups.move(movingGroupId, { index: destinationIndex });
    }
  } finally {
    setTimeout(() => windowsWithGroupMoveInProgress.delete(windowId), 100);
  }

  return true;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'regroupAll') {
    scheduleRegroup(null);
    sendResponse({ ok: true });
  } else if (message.action === 'moveGroup') {
    moveGroupInWindow(message.groupId, message.offset, message.windowId)
      .then(moved => sendResponse({ ok: true, moved }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  } else if (message.action === 'openInWorkGroup') {
    // sender.tab is the page that was clicked; absent when the popup asks.
    openInWorkGroup(message.url, sender.tab)
      .then(tabId => sendResponse({ ok: true, tabId }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  } else if (message.action === 'releaseWorkGroup') {
    releaseWorkGroup(message.windowId)
      .then(released => sendResponse({ ok: true, released }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  return false;
});

// ── Initial grouping ─────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  createWorkContextMenu().catch(console.error);
  scheduleRegroup(null);
});

chrome.runtime.onStartup.addListener(() => {
  createWorkContextMenu().catch(console.error);
  scheduleRegroup(null);
});
