/**
 * popup.js – renders current tab-group info and wires the "Regroup" button.
 */

async function renderGroups() {
  const statusEl = document.getElementById('status');
  const listEl   = document.getElementById('groups-list');
  listEl.innerHTML = '';

  try {
    const currentWindow = await chrome.windows.getCurrent();
    const windowId = currentWindow.id;

    const [tabs, groups] = await Promise.all([
      chrome.tabs.query({ windowId }),
      chrome.tabGroups.query({ windowId }),
    ]);

    // Map groupId → group info
    const groupMap = new Map(groups.map(g => [g.id, g]));

    // Map groupId → tabs[]
    const groupTabsMap = new Map();
    for (const tab of tabs) {
      if (tab.groupId !== -1) {
        if (!groupTabsMap.has(tab.groupId)) groupTabsMap.set(tab.groupId, []);
        groupTabsMap.get(tab.groupId).push(tab);
      }
    }

    const activeGroups = groups.filter(g => groupTabsMap.has(g.id));

    if (activeGroups.length === 0) {
      listEl.innerHTML = '<p class="empty">No tab groups yet.<br>Open multiple tabs on the same domain.</p>';
      statusEl.textContent = `${tabs.length} tab${tabs.length !== 1 ? 's' : ''} – no groups`;
    } else {
      const totalTabs = tabs.length;
      statusEl.textContent =
        `${totalTabs} tab${totalTabs !== 1 ? 's' : ''} · ${activeGroups.length} group${activeGroups.length !== 1 ? 's' : ''}`;

      // Sort by tab count desc
      activeGroups.sort((a, b) => (groupTabsMap.get(b.id) || []).length - (groupTabsMap.get(a.id) || []).length);

      for (const group of activeGroups) {
        const groupTabs = groupTabsMap.get(group.id) || [];
        const count = groupTabs.length;
        const li = document.createElement('li');

        // ── Group header (clickable to expand/collapse) ──────────────────
        const header = document.createElement('div');
        header.className = 'group-header';

        const dot = document.createElement('span');
        dot.className = `dot color-${group.color || 'grey'}`;

        const domain = document.createElement('span');
        domain.className = 'domain';
        domain.textContent = group.title || '(unnamed)';
        domain.title = group.title || '';

        const badge = document.createElement('span');
        badge.className = 'count';
        badge.textContent = `${count} tab${count !== 1 ? 's' : ''}`;

        const chevron = document.createElement('span');
        chevron.className = 'chevron';
        chevron.textContent = '▶';

        header.append(dot, domain, badge, chevron);

        // ── Tabs list (hidden by default) ────────────────────────────────
        const tabsList = document.createElement('ul');
        tabsList.className = 'tabs-list';

        for (const tab of groupTabs) {
          const tabItem = document.createElement('li');
          tabItem.className = 'tab-item' + (tab.active ? ' active-tab' : '');

          const favicon = document.createElement('img');
          favicon.className = 'tab-favicon';
          favicon.src = tab.favIconUrl || '';
          favicon.alt = '';
          favicon.onerror = () => { favicon.style.visibility = 'hidden'; };

          const title = document.createElement('span');
          title.className = 'tab-title';
          title.textContent = tab.title || tab.url || '(no title)';
          title.title = tab.title || tab.url || '';

          tabItem.append(favicon, title);

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
        });

        li.append(header, tabsList);
        listEl.appendChild(li);
      }
    }
  } catch (err) {
    statusEl.textContent = 'Error loading groups.';
    console.error(err);
  }
}

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

// Render on open
renderGroups();
