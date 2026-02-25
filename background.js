/**
 * Auto Tab Groups – background service worker
 *
 * Groups all open tabs in each window by their hostname.
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
 * Returns the hostname for a URL string, or null if the URL is not
 * a regular http/https page (new-tab, chrome://, etc.).
 */
function getDomain(url) {
  if (!url) return null;
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== 'http:' && protocol !== 'https:') return null;
    return hostname || null;
  } catch {
    return null;
  }
}

/**
 * Re-groups all tabs in the given window by domain.
 *
 * Algorithm:
 *  1. Build a domain → tabIds map from the current tab list.
 *  2. Ungroup any tab whose URL doesn't have an http/https domain.
 *  3. For each domain that has ≥ 1 tab:
 *       – Re-use an existing group whose title matches the domain, or
 *       – Create a new group, then set its title and colour.
 */
async function regroupTabsInWindow(windowId) {
  const tabs = await chrome.tabs.query({ windowId });

  // ── 1. Categorise tabs ──────────────────────────────────────────────────
  const domainToTabIds = new Map();
  const noGroupTabIds = [];

  for (const tab of tabs) {
    const domain = getDomain(tab.url || tab.pendingUrl);
    if (domain) {
      if (!domainToTabIds.has(domain)) domainToTabIds.set(domain, []);
      domainToTabIds.get(domain).push(tab.id);
    } else {
      noGroupTabIds.push(tab);
    }
  }

  // ── 2. Ungroup non-http tabs that ended up in a group ───────────────────
  for (const tab of noGroupTabIds) {
    if (tab.groupId !== TAB_GROUP_ID_NONE) {
      await chrome.tabs.ungroup([tab.id]);
    }
  }

  // ── 3. Group tabs by domain ─────────────────────────────────────────────
  // Build a title → groupId map for groups that already exist in this window.
  const existingGroups = await chrome.tabGroups.query({ windowId });
  const titleToGroupId = new Map(
    existingGroups.filter(g => g.title).map(g => [g.title, g.id])
  );

  for (const [domain, tabIds] of domainToTabIds) {
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
  // Re-group when the URL changes or the page finishes loading.
  if (changeInfo.url !== undefined || changeInfo.status === 'complete') {
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
