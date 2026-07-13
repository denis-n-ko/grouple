/**
 * Auto Tab Groups – background service worker
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
 * Strips subdomains from a hostname, returning the registrable base domain
 * (mail.google.com → google.com). IP addresses and single-label hosts
 * (localhost) are returned unchanged.
 */
function getBaseDomain(hostname) {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return hostname;
  const parts = hostname.split('.');
  if (parts.length <= 2) return hostname;
  const lastTwo = parts.slice(-2).join('.');
  return parts.slice(MULTI_PART_TLDS.has(lastTwo) ? -3 : -2).join('.');
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
 *     tabs entirely (they are never grouped and never counted for the ≥ 2
 *     threshold).
 *  2. Ungroup any tab whose URL doesn't have an http/https domain, and any
 *     tab that is the sole tab for its domain (groups need ≥ 2 tabs).
 *  3. For each domain that has ≥ 2 tabs:
 *       – Re-use an existing group whose title matches the domain, or
 *       – Create a new group, then set its title and colour.
 */
async function regroupTabsInWindow(windowId) {
  const tabs = await chrome.tabs.query({ windowId });

  // ── 1. Categorise tabs ──────────────────────────────────────────────────
  const domainToTabIds = new Map();
  const noGroupTabIds = [];

  for (const tab of tabs) {
    if (tab.pinned) continue; // pinned tabs are left exactly as the user put them

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
    existingGroups.filter(g => g.title).map(g => [g.title, g.id])
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

// ── Debounced regroup ────────────────────────────────────────────────────────
// Many tab events can fire in rapid succession (e.g. on startup).
// We coalesce them into a single call per window with a small delay.
const pendingWindows = new Set();
let debounceTimer = null;

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
  }
});

// ── Message listener (from popup) ───────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'regroupAll') {
    scheduleRegroup(null);
    sendResponse({ ok: true });
  }
  return false;
});

// ── Initial grouping ─────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  scheduleRegroup(null);
});

chrome.runtime.onStartup.addListener(() => {
  scheduleRegroup(null);
});
