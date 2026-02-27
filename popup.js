/**
 * popup.js – renders current tab-group info and wires the "Regroup" button.
 */

let navList  = [];
let navIndex = -1;

// ── Build a group / ungrouped row ────────────────────────────────────────────
function buildGroupItem(title, color, groupTabs) {
  const isUngrouped = color === null;
  const count = groupTabs.length;
  const li = document.createElement('li');
  li.className = 'group-li' + (isUngrouped ? ' ungrouped-li' : '');

  // ── Group header (clickable to expand/collapse) ──────────────────
  const header = document.createElement('div');
  header.className = 'group-header';
  header.dataset.groupTitle = title;

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

  // ── Tabs list (hidden by default) ────────────────────────────────
  const tabsList = document.createElement('ul');
  tabsList.className = 'tabs-list';

  for (const tab of groupTabs) {
    const tabItem = document.createElement('li');
    tabItem.className = 'tab-item' + (tab.active ? ' active-tab' : '');
    tabItem.dataset.tabTitle = tab.title || tab.url || '';

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
    const isOpen = tabsList.classList.toggle('open');
    chevron.classList.toggle('open', isOpen);
    buildNavList();
  });

  li.append(header, tabsList);
  return li;
}

// ── Main render ──────────────────────────────────────────────────────────────
async function renderGroups() {
  const statusEl = document.getElementById('status');
  const listEl   = document.getElementById('groups-list');
  listEl.innerHTML = '';
  navList  = [];
  navIndex = -1;

  try {
    const currentWindow = await chrome.windows.getCurrent();
    const windowId = currentWindow.id;

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
    const totalTabs    = tabs.length;

    if (activeGroups.length === 0 && ungroupedTabs.length === 0) {
      listEl.innerHTML = '<p class="empty">No tabs found.</p>';
      statusEl.textContent = '0 tabs';
    } else {
      statusEl.textContent = activeGroups.length > 0
        ? `${totalTabs} tab${totalTabs !== 1 ? 's' : ''} · ${activeGroups.length} group${activeGroups.length !== 1 ? 's' : ''}`
        : `${totalTabs} tab${totalTabs !== 1 ? 's' : ''} – no groups`;

      // Sort groups by tab count desc
      activeGroups.sort((a, b) => (groupTabsMap.get(b.id) || []).length - (groupTabsMap.get(a.id) || []).length);

      for (const group of activeGroups) {
        listEl.appendChild(buildGroupItem(group.title || '(unnamed)', group.color || 'grey', groupTabsMap.get(group.id) || []));
      }

      // Ungrouped tabs at the bottom
      if (ungroupedTabs.length > 0) {
        listEl.appendChild(buildGroupItem('Ungrouped', null, ungroupedTabs));
      }
    }
  } catch (err) {
    statusEl.textContent = 'Error loading groups.';
    console.error(err);
  }

  buildNavList();
}

// ── Search / filter ──────────────────────────────────────────────────────────
function filterList(query) {
  const q      = query.trim().toLowerCase();
  const listEl = document.getElementById('groups-list');

  for (const li of listEl.querySelectorAll('li.group-li')) {
    const header    = li.querySelector('.group-header');
    const groupTitle = (header.dataset.groupTitle || '').toLowerCase();
    const tabsList  = li.querySelector('.tabs-list');
    const tabItems  = tabsList ? [...tabsList.querySelectorAll('.tab-item')] : [];

    if (!q) {
      li.style.display = '';
      tabItems.forEach(t => { t.style.display = ''; });
    } else if (groupTitle.includes(q)) {
      li.style.display = '';
      tabItems.forEach(t => { t.style.display = ''; });
    } else {
      let anyMatch = false;
      tabItems.forEach(t => {
        const match = (t.dataset.tabTitle || '').toLowerCase().includes(q);
        t.style.display = match ? '' : 'none';
        if (match) anyMatch = true;
      });
      li.style.display = anyMatch ? '' : 'none';
      if (anyMatch && tabsList) {
        // Auto-expand group to reveal matching tabs
        tabsList.classList.add('open');
        li.querySelector('.chevron').classList.add('open');
      }
    }
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

document.addEventListener('keydown', (e) => {
  const searchEl = document.getElementById('search');
  const onSearch = document.activeElement === searchEl;

  if (e.key === 'Escape') {
    navClear();
    searchEl.focus();
    return;
  }

  if (onSearch) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (navList.length > 0) navMoveTo(0);
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
  btn.disabled = true;
  btn.textContent = 'Regrouping…';
  try {
    // Send a message to the background service worker (it will do the work).
    await chrome.runtime.sendMessage({ action: 'regroupAll' });
    await new Promise(r => setTimeout(r, 600)); // brief pause for UX
    await renderGroups();
  } catch (err) {
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Regroup Tabs Now';
  }
});

document.getElementById('search').addEventListener('input', (e) => {
  filterList(e.target.value);
});

// Render on open, then focus search bar
renderGroups();
document.getElementById('search').focus();
