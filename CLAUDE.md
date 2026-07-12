# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

A Manifest V3 Chrome/Brave extension that automatically groups open tabs by domain name. It has no build step, no dependencies, and no test suite — it is plain HTML/CSS/JS loaded directly by the browser.

## How to load and test the extension

There is no build or lint command. The only way to run the extension is to load it unpacked:

1. Open `brave://extensions` or `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the repo root
4. After any code change, click the **↺ refresh** button on the extension card (background.js changes require this; popup.html/popup.js changes take effect automatically on the next popup open)

To inspect the background service worker: click **Inspect views: service worker** on the extension card.  
To inspect the popup: right-click the toolbar icon → **Inspect**.

## Architecture

The extension has two independent execution contexts that communicate via `chrome.runtime.sendMessage`:

**`background.js` (service worker)**  
Owns all grouping logic. Listens to six tab events (`onCreated`, `onUpdated`, `onRemoved`, `onMoved`, `onAttached`, `onDetached`). Each event calls `scheduleRegroup(windowId)`, which debounces 400 ms before running `regroupTabsInWindow`. That function: builds a `domain → tabIds[]` map, ungroups lone tabs and non-http tabs, then for each domain with ≥ 2 tabs either reuses an existing group (matched by title) or creates a new one. Colours are assigned deterministically via a hash of the domain string. The popup triggers a regroup via the `regroupAll` message action. Also handles the global keyboard commands declared in `manifest.json` (`fold-all-groups`, `unfold-all-groups`, `focus-active-group`) via `chrome.commands.onCommand`, collapsing/expanding real tab-strip groups with `chrome.tabGroups.update`.

**`popup.html` + `popup.js` (toolbar popup)**  
Renders the current tab/group state on open. Reads from `chrome.tabs` and `chrome.tabGroups` directly — it does not talk to the background worker for display data. Group display order is persisted in `chrome.storage.local` under the key `groupOrder` as an array of group-key strings (each key is `JSON.stringify([title, color])`). The popup supports keyboard navigation (arrow keys, Enter, Escape) and search filtering; both are wired entirely inside `popup.js` with no external libraries.

## Key constraints

- **Groups require ≥ 2 tabs**: a domain with only one tab is always left ungrouped. This is intentional.
- **Non-http tabs are never grouped**: `chrome://`, `about:blank`, `file://`, etc. are always ungrouped.
- **Group identity is title-based**: `regroupTabsInWindow` matches existing groups by their `title` string. Renaming a group in the browser will cause a new duplicate group to be created on the next regroup.
- **Service worker lifecycle**: MV3 service workers can be terminated by the browser when idle. The debounce timer (`debounceTimer`) and `pendingWindows` set are in-memory and will be reset if the worker is killed mid-debounce — this is an accepted trade-off.
- **No CSS framework**: all styles are inline in `popup.html` using CSS custom properties (`--bg`, `--surface`, `--accent`, etc.) defined in `:root`. The dark theme is the default; there is no light/dark toggle.
- **Tabs list expand animation**: uses `max-height` transition (0 → 800px) rather than `display` toggling. The JS only adds/removes the `.open` class; it never sets `style.display` on `.tabs-list` elements.
