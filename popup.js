/**
 * popup.js – renders current tab-group info and wires the "Regroup" button.
 */

async function renderGroups() {
  const statusEl = document.getElementById('status');
  const listEl   = document.getElementById('groups-list');
  listEl.innerHTML = '';

  try {
    const [currentWindow] = await Promise.all([
      chrome.windows.getCurrent(),
    ]);
    const windowId = currentWindow.id;

    const [tabs, groups] = await Promise.all([
      chrome.tabs.query({ windowId }),
      chrome.tabGroups.query({ windowId }),
    ]);

    // Map groupId → group info
    const groupMap = new Map(groups.map(g => [g.id, g]));

    // Count tabs per groupId
    const groupTabCount = new Map();
    for (const tab of tabs) {
      if (tab.groupId !== -1) {
        groupTabCount.set(tab.groupId, (groupTabCount.get(tab.groupId) || 0) + 1);
      }
    }

    const activeGroups = groups.filter(g => groupTabCount.has(g.id));

    if (activeGroups.length === 0) {
      listEl.innerHTML = '<p class="empty">No tab groups yet.<br>Open multiple tabs on the same domain.</p>';
      statusEl.textContent = `${tabs.length} tab${tabs.length !== 1 ? 's' : ''} – no groups`;
    } else {
      statusEl.textContent =
        `${tabs.length} tab${tabs.length !== 1 ? 's' : ''} · ${activeGroups.length} group${activeGroups.length !== 1 ? 's' : ''}`;

      // Sort by tab count desc
      activeGroups.sort((a, b) => (groupTabCount.get(b.id) || 0) - (groupTabCount.get(a.id) || 0));

      for (const group of activeGroups) {
        const count = groupTabCount.get(group.id) || 0;
        const li = document.createElement('li');

        const dot = document.createElement('span');
        dot.className = `dot color-${group.color || 'grey'}`;

        const domain = document.createElement('span');
        domain.className = 'domain';
        domain.textContent = group.title || '(unnamed)';
        domain.title = group.title || '';

        const badge = document.createElement('span');
        badge.className = 'count';
        badge.textContent = `${count} tab${count !== 1 ? 's' : ''}`;

        li.append(dot, domain, badge);
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
