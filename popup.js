/**
 * popup.js – renders current tab-group info and wires the "Regroup" button.
 */

let navList  = [];
let navIndex = -1;
let currentActiveGroupId = null;

let currentWindowId = null;
let searchIndexedTabs = [];
let isMovingGroup = false;

const STORAGE_NO_MERGE_KEY = 'noMergeDomains';
const STORAGE_WORK_TITLE_KEY = 'workGroupTitle';
const DEFAULT_WORK_GROUP_TITLE = 'WORK';
const DEFAULT_GROUP_TITLE = '(unnamed)';
const DEFAULT_GROUP_COLOR = 'grey';

// Title of the manual group, kept in sync with background.js via storage.
let workGroupTitle = DEFAULT_WORK_GROUP_TITLE;

// ── Build a group / ungrouped row ────────────────────────────────────────────
function buildGroupItem(group, groupTabs) {
  const { id, title, color } = group;
  const isUngrouped = color === null;
  const count = groupTabs.length;
  const li = document.createElement('li');
  li.className = 'group-li' + (isUngrouped ? ' ungrouped-li' : '');

  // ── Group header (clickable to expand/collapse) ──────────────────
  const header = document.createElement('div');
  header.className = 'group-header';
  header.dataset.groupTitle = title;
  header.dataset.groupId = String(id);
  header.setAttribute('role', 'button');
  header.tabIndex = 0;
  header.setAttribute('aria-expanded', 'false');

  if (!isUngrouped) {
    const dot = document.createElement('span');
    dot.className = `dot color-${color}`;
    header.appendChild(dot);
  }

  const domain = document.createElement('span');
  domain.className = 'domain';
  domain.textContent = title;
  domain.title = title;

  const badge = document.createElement('span');
  badge.className = 'count';
  badge.textContent = `${count} tab${count !== 1 ? 's' : ''}`;

  const chevron = document.createElement('span');
  chevron.className = 'chevron';
  chevron.textContent = '▶';

  header.append(domain, badge, chevron);

  if (!isUngrouped) {
    const moveUpBtn = document.createElement('button');
    moveUpBtn.className = 'group-move';
    moveUpBtn.title = 'Move group up in the tab strip (Alt+↑)';
    moveUpBtn.setAttribute('aria-label', `Move ${title} group up in the tab strip`);
    moveUpBtn.textContent = '↑';
    moveUpBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await moveGroupInTabStrip(header, -1);
      } catch (err) {
        document.getElementById('status').textContent = 'Could not move group.';
        console.error('Failed to move group:', err);
      }
    });

    const moveDownBtn = document.createElement('button');
    moveDownBtn.className = 'group-move';
    moveDownBtn.title = 'Move group down in the tab strip (Alt+↓)';
    moveDownBtn.setAttribute('aria-label', `Move ${title} group down in the tab strip`);
    moveDownBtn.textContent = '↓';
    moveDownBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await moveGroupInTabStrip(header, 1);
      } catch (err) {
        document.getElementById('status').textContent = 'Could not move group.';
        console.error('Failed to move group:', err);
      }
    });

    const closeGroupBtn = document.createElement('button');
    closeGroupBtn.className = 'group-close';
    closeGroupBtn.textContent = '×';
    closeGroupBtn.title = `Close all ${count} tabs in this group`;
    closeGroupBtn.setAttribute('aria-label', `Close all ${count} tabs in ${title}`);
    closeGroupBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const tabWord = count === 1 ? 'tab' : 'tabs';
      if (!window.confirm(`Close all ${count} ${tabWord} in ${title}?`)) return;
      try {
        await chrome.tabs.remove(groupTabs.map(tab => tab.id));
        await renderGroups();
      } catch (err) {
        document.getElementById('status').textContent = 'Could not close group.';
        console.error('Failed to close group:', err);
      }
    });

    header.append(moveUpBtn, moveDownBtn, closeGroupBtn);
  }

  // ── Tabs list (hidden by default) ────────────────────────────────
  const tabsList = document.createElement('ul');
  tabsList.className = 'tabs-list';

  for (const [position, tab] of groupTabs.entries()) {
    const tabItem = document.createElement('li');
    // Original tab-strip position, so relevance sorting can be undone.
    tabItem.dataset.pos = String(position);
    tabItem.className = 'tab-item' + (tab.active ? ' active-tab' : '');
    tabItem.dataset.tabTitle = tab.title || tab.url || '';
    tabItem.dataset.tabUrl = tab.url || '';

    const favicon = document.createElement('img');
    favicon.className = 'tab-favicon';
    favicon.src = tab.favIconUrl || '';
    favicon.alt = '';
    favicon.onerror = () => { favicon.style.visibility = 'hidden'; };

    const titleEl = document.createElement('span');
    titleEl.className = 'tab-title';
    titleEl.textContent = tab.title || tab.url || '(no title)';
    titleEl.title = tab.title || tab.url || '';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'tab-close';
    closeBtn.textContent = '×';
    closeBtn.title = 'Close tab';
    closeBtn.setAttribute('aria-label', `Close ${tab.title || tab.url || 'tab'}`);

    closeBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await chrome.tabs.remove(tab.id);
        tabItem.remove();
        const remaining = tabsList.querySelectorAll('.tab-item').length;
        badge.textContent = `${remaining} tab${remaining !== 1 ? 's' : ''}`;
        if (remaining === 0) li.remove();
        buildNavList();
      } catch (err) {
        console.error('Failed to close tab:', err);
      }
    });

    tabItem.append(favicon, titleEl, closeBtn);

    tabItem.addEventListener('click', async (e) => {
      e.stopPropagation();
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      window.close();
    });

    tabsList.appendChild(tabItem);
  }

  // ── Toggle expand/collapse on header click ───────────────────────
  header.addEventListener('click', () => {
    setGroupExpanded(li, !tabsList.classList.contains('open'));
    buildNavList();
  });
  header.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      header.click();
    } else if (isGroupMoveShortcut(event)) {
      event.preventDefault();
      moveGroupInTabStrip(header, event.key === 'ArrowUp' ? -1 : 1)
        .catch(err => {
          document.getElementById('status').textContent = 'Could not move group.';
          console.error('Failed to move group:', err);
        });
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      setGroupExpanded(li, true);
      buildNavList();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setGroupExpanded(li, false);
      buildNavList();
    }
  });

  li.append(header, tabsList);
  return li;
}

// ── Main render ──────────────────────────────────────────────────────────────
async function renderGroups() {
  const statusEl = document.getElementById('status');
  const listEl   = document.getElementById('groups-list');
  const searchEl = document.getElementById('search');
  const searchQuery = searchEl.value;
  const expandedGroupIds = new Set(
    [...listEl.querySelectorAll('.group-header')]
      .filter(header => header.closest('.group-li').querySelector('.tabs-list').classList.contains('open'))
      .map(header => header.dataset.groupId)
  );
  listEl.innerHTML = '';
  navList  = [];
  navIndex = -1;
  currentActiveGroupId = null;

  try {
    const currentWindow = await chrome.windows.getCurrent();
    const windowId = currentWindow.id;
    currentWindowId = windowId;

    const [tabs, groups] = await Promise.all([
      chrome.tabs.query({ windowId }),
      chrome.tabGroups.query({ windowId }),
    ]);

    // Map groupId → tabs[]  /  collect ungrouped tabs
    const groupTabsMap = new Map();
    const ungroupedTabs = [];
    for (const tab of tabs) {
      if (tab.groupId !== -1) {
        if (!groupTabsMap.has(tab.groupId)) groupTabsMap.set(tab.groupId, []);
        groupTabsMap.get(tab.groupId).push(tab);
      } else {
        ungroupedTabs.push(tab);
      }
    }

    const activeGroups = groups.filter(g => groupTabsMap.has(g.id));
    updateReleaseButton(activeGroups.some(g => g.title === workGroupTitle));
    const activeTab = tabs.find(tab => tab.active);
    currentActiveGroupId = activeTab ? activeTab.groupId : null;
    const totalTabs    = tabs.length;

    if (activeGroups.length === 0 && ungroupedTabs.length === 0) {
      listEl.innerHTML = '<p class="empty">No tabs found.</p>';
      statusEl.textContent = '0 tabs';
    } else {
      statusEl.textContent = activeGroups.length > 0
        ? `${totalTabs} tab${totalTabs !== 1 ? 's' : ''} · ${activeGroups.length} group${activeGroups.length !== 1 ? 's' : ''}`
        : `${totalTabs} tab${totalTabs !== 1 ? 's' : ''} – no groups`;

      // Match the browser's left-to-right tab-strip order.
      const orderedGroups = [...activeGroups].sort((a, b) =>
        Math.min(...groupTabsMap.get(a.id).map(tab => tab.index))
        - Math.min(...groupTabsMap.get(b.id).map(tab => tab.index))
      );

      for (const group of orderedGroups) {
        listEl.appendChild(buildGroupItem({
          id: group.id,
          title: group.title || DEFAULT_GROUP_TITLE,
          color: group.color || DEFAULT_GROUP_COLOR,
        }, groupTabsMap.get(group.id) || []));
      }

      // Ungrouped tabs at the bottom
      if (ungroupedTabs.length > 0) {
        listEl.appendChild(buildGroupItem({ id: -1, title: 'Ungrouped', color: null }, ungroupedTabs));
      }

      [...listEl.querySelectorAll('li.group-li')]
        .forEach((li, position) => { li.dataset.pos = String(position); });

      for (const header of listEl.querySelectorAll('.group-header')) {
        if (expandedGroupIds.has(header.dataset.groupId)) {
          setGroupExpanded(header.closest('.group-li'), true);
        }
      }
    }
  } catch (err) {
    statusEl.textContent = 'Error loading groups.';
    console.error(err);
  }

  if (searchQuery) {
    filterList(searchQuery);
  } else {
    buildNavList();
  }
}

// ── Search / filter ──────────────────────────────────────────────────────────
function setTabIndex(tabItem, index) {
  let badge = tabItem.querySelector('.tab-index');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'tab-index';
    tabItem.insertBefore(badge, tabItem.firstChild);
  }
  if (index <= 9) {
    badge.textContent = String(index);
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }
}

// A query is split on whitespace; every token must match at least one field of
// a tab (its title, its URL, or its group's title). A token matches either as a
// plain substring or, failing that, as a fuzzy subsequence — so "git hello"
// finds the tab titled "Hello Kitty Project" living on git.inbit.dev.
const BOUNDARY_CHARS = /[\s\-_./:?=&#@+~,|]/;

function isBoundary(hay, i) {
  return i === 0 || BOUNDARY_CHARS.test(hay[i - 1]);
}

// Score one token against one string. Higher is better; -1 means no match.
// Substring hits always outrank fuzzy ones, and both prefer early, word-start
// positions.
function scoreToken(needle, hay) {
  if (!hay) return -1;

  const idx = hay.indexOf(needle);
  if (idx !== -1) {
    return 1000
      - Math.min(idx, 100)
      + (isBoundary(hay, idx) ? 200 : 0)
      + Math.round((needle.length / hay.length) * 100);
  }

  // Single characters are too noisy to match as a subsequence.
  if (needle.length < 2) return -1;

  let hi = 0;
  let score = 0;
  let streak = 0;
  let first = -1;
  let prev = -1;

  for (const ch of needle) {
    let found = -1;
    while (hi < hay.length) {
      if (hay[hi] === ch) { found = hi++; break; }
      hi++;
    }
    if (found === -1) return -1;

    if (first === -1) first = found;
    if (found === prev + 1) {
      streak++;
      score += 15 + streak * 5;
    } else {
      streak = 0;
      score += isBoundary(hay, found) ? 12 : 3;
    }
    prev = found;
  }

  // Penalise matches that start late or are spread thin across the string.
  const spread = prev - first + 1 - needle.length;
  return Math.max(1, score - Math.round(first * 0.3) - Math.round(spread * 0.5));
}

// Every token must hit some field; the total is the sum of each token's best
// weighted field score. Returns -1 when any token misses everywhere.
function scoreFields(tokens, fields) {
  let total = 0;
  for (const token of tokens) {
    let best = -1;
    for (const { text, weight } of fields) {
      const score = scoreToken(token, text);
      if (score >= 0) best = Math.max(best, score * weight);
    }
    if (best < 0) return -1;
    total += best;
  }
  return total;
}

const byPos = (a, b) => Number(a.dataset.pos || 0) - Number(b.dataset.pos || 0);

// Best matches first; ties fall back to the original tab-strip order.
function byRelevance(a, b) {
  return b.score - a.score || byPos(a.el, b.el);
}

// Put a list of rows back in tab-strip order and clear every search badge.
function resetOrder(listEl) {
  for (const li of [...listEl.querySelectorAll('li.group-li')].sort(byPos)) {
    const tabsList = li.querySelector('.tabs-list');
    li.style.display = '';
    if (tabsList) {
      for (const t of [...tabsList.querySelectorAll('.tab-item')].sort(byPos)) {
        t.style.display = '';
        const badge = t.querySelector('.tab-index');
        if (badge) badge.style.display = 'none';
        tabsList.appendChild(t);
      }
    }
    listEl.appendChild(li);
  }
}

function filterList(query) {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const listEl = document.getElementById('groups-list');
  searchIndexedTabs = [];

  if (tokens.length === 0) {
    resetOrder(listEl);
    buildNavList();
    return;
  }

  const ranked = [];

  for (const li of listEl.querySelectorAll('li.group-li')) {
    const header     = li.querySelector('.group-header');
    const groupTitle = (header.dataset.groupTitle || '').toLowerCase();
    const tabsList   = li.querySelector('.tabs-list');
    const tabItems   = tabsList ? [...tabsList.querySelectorAll('.tab-item')] : [];

    // A group whose own title matches every token shows all of its tabs.
    const groupScore = scoreFields(tokens, [{ text: groupTitle, weight: 1 }]);

    const hits = [];
    const misses = [];
    for (const el of tabItems) {
      const tabScore = scoreFields(tokens, [
        { text: (el.dataset.tabTitle || '').toLowerCase(), weight: 1 },
        { text: (el.dataset.tabUrl   || '').toLowerCase(), weight: 0.9 },
        { text: groupTitle,                                weight: 0.8 },
      ]);
      const score = Math.max(tabScore, groupScore);
      if (score >= 0) hits.push({ el, score });
      else misses.push(el);
    }

    hits.sort(byRelevance);
    ranked.push({
      el: li,
      tabsList,
      hits,
      misses,
      score: hits.length ? hits[0].score : -1,
    });
  }

  ranked.sort(byRelevance);

  for (const group of ranked) {
    const { el: li, tabsList, hits, misses } = group;

    for (const { el } of hits) {
      el.style.display = '';
      searchIndexedTabs.push(el);
      setTabIndex(el, searchIndexedTabs.length);
      tabsList.appendChild(el);
    }
    for (const el of misses.sort(byPos)) {
      el.style.display = 'none';
      const badge = el.querySelector('.tab-index');
      if (badge) badge.style.display = 'none';
      tabsList.appendChild(el);
    }

    li.style.display = hits.length ? '' : 'none';
    // Auto-expand so the matching tabs are visible.
    if (hits.length && tabsList) {
      tabsList.classList.add('open');
      li.querySelector('.chevron').classList.add('open');
    }
    listEl.appendChild(li);
  }

  buildNavList();
}

// ── Keyboard navigation ──────────────────────────────────────────────────────
function buildNavList() {
  // Remove visual focus from the currently tracked item
  if (navIndex >= 0 && navIndex < navList.length) {
    navList[navIndex].el.classList.remove('nav-focus');
  }
  navList  = [];
  navIndex = -1;

  const listEl = document.getElementById('groups-list');
  for (const li of listEl.querySelectorAll('li.group-li')) {
    if (li.style.display === 'none') continue;
    const header = li.querySelector('.group-header');
    navList.push({ el: header, type: 'group', li });
    const tabsList = li.querySelector('.tabs-list');
    if (tabsList && tabsList.classList.contains('open')) {
      for (const tab of tabsList.querySelectorAll('.tab-item')) {
        if (tab.style.display === 'none') continue;
        navList.push({ el: tab, type: 'tab', li });
      }
    }
  }
}

function navMoveTo(idx) {
  if (navList.length === 0) return;
  if (navIndex >= 0 && navIndex < navList.length) {
    navList[navIndex].el.classList.remove('nav-focus');
  }
  navIndex = Math.max(0, Math.min(idx, navList.length - 1));
  navList[navIndex].el.classList.add('nav-focus');
  navList[navIndex].el.scrollIntoView({ block: 'nearest' });
}

function navClear() {
  if (navIndex >= 0 && navIndex < navList.length) {
    navList[navIndex].el.classList.remove('nav-focus');
  }
  navIndex = -1;
}

// Re-apply nav focus to a specific element after a nav rebuild triggered by
// an internal click handler (which calls buildNavList and resets navIndex).
function navRefocus(el) {
  const idx = navList.findIndex(n => n.el === el);
  if (idx >= 0) {
    navIndex = idx;
    navList[idx].el.classList.add('nav-focus');
  }
}

function hasFocusedGroupNavTarget() {
  return navIndex >= 0 && navIndex < navList.length && navList[navIndex].type === 'group';
}

function setGroupExpanded(li, expanded) {
  const tabsList = li.querySelector('.tabs-list');
  if (!tabsList) return;
  const chevron = li.querySelector('.chevron');
  tabsList.classList.toggle('open', expanded);
  chevron.classList.toggle('open', expanded);
  li.querySelector('.group-header').setAttribute('aria-expanded', String(expanded));
}

function expandCollapseAll(expand) {
  const listEl = document.getElementById('groups-list');
  for (const li of listEl.querySelectorAll('li.group-li')) {
    if (li.style.display === 'none') continue;
    setGroupExpanded(li, expand);
  }
  buildNavList();
}

async function moveGroupInTabStrip(groupHeader, offset) {
  if (currentWindowId === null || isMovingGroup) return false;
  const sourceGroupId = Number(groupHeader.dataset.groupId);
  if (!Number.isInteger(sourceGroupId) || sourceGroupId === -1) return false;

  isMovingGroup = true;
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'moveGroup',
      groupId: sourceGroupId,
      offset,
      windowId: currentWindowId,
    });
    if (!response.ok) throw new Error(response.error || 'Could not move group.');
    if (!response.moved) return false;

    await renderGroups();
    navRefocus([...document.querySelectorAll('.group-header')]
      .find(header => Number(header.dataset.groupId) === sourceGroupId));
    return true;
  } finally {
    isMovingGroup = false;
  }
}

function focusCurrentTabGroup() {
  if (currentActiveGroupId === null) return false;
  const listEl = document.getElementById('groups-list');
  let header = [...listEl.querySelectorAll('.group-header')]
    .find(el => el.dataset.groupId === String(currentActiveGroupId));
  if (!header && currentActiveGroupId === -1) {
    header = listEl.querySelector('.ungrouped-li .group-header');
  }
  if (!header) return false;

  const groupLi = header.closest('li.group-li');
  if (groupLi.style.display === 'none') {
    const searchEl = document.getElementById('search');
    searchEl.value = '';
    filterList('');
  }
  setGroupExpanded(groupLi, true);
  buildNavList();
  const idx = navList.findIndex(item => item.el === header);
  if (idx >= 0) {
    navMoveTo(idx);
    return true;
  }
  return false;
}

function isGroupMoveShortcut(event) {
  return !event.ctrlKey
    && !event.shiftKey
    && (event.altKey || event.metaKey)
    && (event.key === 'ArrowUp' || event.key === 'ArrowDown');
}

document.addEventListener('keydown', (e) => {
  const searchEl = document.getElementById('search');
  const onSearch = document.activeElement === searchEl;

  if (e.ctrlKey && e.shiftKey && e.code === 'BracketLeft') {
    e.preventDefault();
    expandCollapseAll(false);
    return;
  }

  if (e.ctrlKey && e.shiftKey && e.code === 'BracketRight') {
    e.preventDefault();
    expandCollapseAll(true);
    return;
  }

  if (e.ctrlKey && e.shiftKey && e.code === 'KeyG') {
    e.preventDefault();
    if (currentWindowId !== null) chrome.windows.update(currentWindowId, { focused: true });
    window.close();
    return;
  }

  if (isGroupMoveShortcut(e) && hasFocusedGroupNavTarget()) {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveGroupInTabStrip(navList[navIndex].el, -1)
        .catch(err => {
          document.getElementById('status').textContent = 'Could not move group.';
          console.error('Failed to move group:', err);
        });
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveGroupInTabStrip(navList[navIndex].el, 1)
        .catch(err => {
          document.getElementById('status').textContent = 'Could not move group.';
          console.error('Failed to move group:', err);
        });
      return;
    }
  }

  if (e.key === 'Escape') {
    navClear();
    searchEl.focus();
    return;
  }

  if (onSearch) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (navList.length > 0) navMoveTo(0);
      return;
    }
    if (!e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && e.key >= '1' && e.key <= '9') {
      const tabEl = searchIndexedTabs[parseInt(e.key, 10) - 1];
      if (tabEl) {
        e.preventDefault();
        tabEl.click();
      }
      return;
    }
    return;
  }

  if (navIndex === -1) return;
  const item = navList[navIndex];

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    navMoveTo(navIndex + 1);

  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (navIndex === 0) {
      navClear();
      searchEl.focus();
    } else {
      navMoveTo(navIndex - 1);
    }

  } else if (e.key === 'Enter') {
    e.preventDefault();
    const el = item.el;
    if (item.type === 'group') {
      el.click(); // toggle; buildNavList called inside
      navRefocus(el);
    } else {
      el.click(); // activate tab and close popup
    }

  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    if (item.type === 'group') {
      const tabsList = item.li.querySelector('.tabs-list');
      if (!tabsList.classList.contains('open')) {
        item.el.click(); // expand; buildNavList called inside
        navRefocus(item.el);
      } else {
        // Move focus to first tab in this group
        const next = navList[navIndex + 1];
        // No-op when already on the last tab of the group or group has no tabs
        if (next && next.type === 'tab' && next.li === item.li) navMoveTo(navIndex + 1);
      }
    }

  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    if (item.type === 'group') {
      const tabsList = item.li.querySelector('.tabs-list');
      if (tabsList.classList.contains('open')) {
        item.el.click(); // collapse; buildNavList called inside
        navRefocus(item.el);
      }
    } else if (item.type === 'tab') {
      // Collapse the parent group and move focus to its header
      const groupHeader = item.li.querySelector('.group-header');
      groupHeader.click(); // collapses + calls buildNavList
      navRefocus(groupHeader);
    }
  }
});

document.getElementById('regroup-btn').addEventListener('click', async () => {
  const btn = document.getElementById('regroup-btn');
  const label = document.getElementById('regroup-label');
  btn.disabled = true;
  label.textContent = 'Grouping…';
  try {
    // Send a message to the background service worker (it will do the work).
    await chrome.runtime.sendMessage({ action: 'regroupAll' });
    await new Promise(r => setTimeout(r, 600)); // brief pause for UX
    await renderGroups();
  } catch (err) {
    console.error(err);
  } finally {
    btn.disabled = false;
    label.textContent = 'Regroup';
  }
});

document.getElementById('search').addEventListener('input', (e) => {
  filterList(e.target.value);
});

// ── Manual group ─────────────────────────────────────────────────────────────
// The Release button only appears while the manual group exists in this window,
// so the toolbar stays as compact as it is the rest of the time.
function updateReleaseButton(hasWorkGroup) {
  const btn = document.getElementById('release-work-btn');
  btn.hidden = !hasWorkGroup;
  document.getElementById('release-work-label').textContent = `Release ${workGroupTitle}`;
  document.getElementById('shortcut-work-name').textContent = workGroupTitle;
}

document.getElementById('release-work-btn').addEventListener('click', async (event) => {
  const btn = event.currentTarget;
  btn.disabled = true;
  try {
    await chrome.runtime.sendMessage({ action: 'releaseWorkGroup', windowId: currentWindowId });
    await renderGroups();
  } finally {
    btn.disabled = false;
  }
});

// ── Settings panel ───────────────────────────────────────────────────────────
async function loadSettings() {
  const data = await chrome.storage.local.get({
    [STORAGE_NO_MERGE_KEY]: [],
    [STORAGE_WORK_TITLE_KEY]: DEFAULT_WORK_GROUP_TITLE,
  });

  const domains = Array.isArray(data[STORAGE_NO_MERGE_KEY]) ? data[STORAGE_NO_MERGE_KEY] : [];
  document.getElementById('no-merge-domains').value = domains.join('\n');

  workGroupTitle = normalizeWorkTitle(data[STORAGE_WORK_TITLE_KEY]);
  document.getElementById('work-group-name').value = workGroupTitle;
  document.getElementById('shortcut-work-name').textContent = workGroupTitle;
}

function normalizeWorkTitle(value) {
  const title = typeof value === 'string' ? value.trim() : '';
  return title || DEFAULT_WORK_GROUP_TITLE;
}

document.getElementById('settings-btn').addEventListener('click', () => {
  const panel = document.getElementById('settings-panel');
  const isOpen = panel.classList.toggle('open');
  document.getElementById('settings-btn').setAttribute('aria-expanded', String(isOpen));
});

document.getElementById('save-settings-btn').addEventListener('click', async () => {
  const raw = document.getElementById('no-merge-domains').value;
  const domains = raw.split('\n').map(d => d.trim().toLowerCase()).filter(Boolean);

  workGroupTitle = normalizeWorkTitle(document.getElementById('work-group-name').value);
  document.getElementById('work-group-name').value = workGroupTitle;

  await chrome.storage.local.set({
    [STORAGE_NO_MERGE_KEY]: domains,
    [STORAGE_WORK_TITLE_KEY]: workGroupTitle,
  });
  // background.js retitles any open manual group in response to that storage
  // change, so give it a moment before re-reading the groups.
  setTimeout(renderGroups, 200);

  const btn = document.getElementById('save-settings-btn');
  const original = btn.textContent;
  btn.textContent = 'Saved ✓';
  btn.disabled = true;
  setTimeout(() => {
    btn.textContent = original;
    btn.disabled = false;
  }, 1200);
});

// Load settings first — renderGroups needs the manual group's title to know
// whether to offer the Release button — then render and focus the search bar.
(async () => {
  await loadSettings();
  await renderGroups();
  document.getElementById('search').focus();
})();
