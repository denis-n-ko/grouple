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

The extension has three independent execution contexts that communicate via `chrome.runtime.sendMessage`:

**`background.js` (service worker)**  
Owns all grouping logic. Listens to six tab events (`onCreated`, `onUpdated`, `onRemoved`, `onMoved`, `onAttached`, `onDetached`). Each event calls `scheduleRegroup(windowId)`, which debounces 400 ms before running `regroupTabsInWindow`. That function: builds a `domain → tabIds[]` map, ungroups lone tabs and non-http tabs, then for each domain with ≥ 2 tabs either reuses an existing group (matched by title) or creates a new one. Colours are assigned deterministically via a hash of the domain string. The popup triggers a regroup via the `regroupAll` message action. Also handles the global keyboard commands declared in `manifest.json` (`fold-all-groups`, `unfold-all-groups`, `focus-active-group`, `toggle-tab-work-group`) via `chrome.commands.onCommand`, collapsing/expanding real tab-strip groups with `chrome.tabGroups.update`.

**`content.js` (content script, all http/https pages, all frames)**  
Runs at `document_start` and listens for `click` in the capture phase. On `Cmd`+`Alt`+click (`Ctrl`+`Alt`+click elsewhere) over an anchor it cancels the navigation and sends `openInWorkGroup` with the resolved URL to the service worker. It touches nothing else — no other modifier combination, no non-anchor click, no non-http href. This is the only way to react to a modified link click; the browser's own `Cmd`+click handling is not hookable from an extension.

**`popup.html` + `popup.js` (toolbar popup)**  
Renders the current tab/group state on open and reads display data from `chrome.tabs` and `chrome.tabGroups` directly. Groups appear in their left-to-right browser tab-strip order. The popup asks the background worker to move an entire group with `chrome.tabGroups.move`, so every tab stays in that group and the worker can suppress its own regrouping reaction to the resulting tab-move events. The popup supports keyboard navigation (arrow keys, Enter, Escape) and search filtering; both are wired entirely inside `popup.js` with no external libraries. The gear icon opens a settings panel for editing the `noMergeDomains` list and the WORK group's title (see below). The toolbar's **Release** button is rendered `hidden` and only unhidden by `renderGroups` when a group titled `workGroupTitle` exists in the current window.

## The manual "WORK" group

A second, opt-in grouping mode that sits alongside domain grouping: tabs the user collects by hand for one task.

- **Filled three ways**: `Cmd`/`Ctrl`+`Alt`+click a link (`content.js` → `openInWorkGroup` message), the `Open link in "…" group` link context menu (`contextMenus` permission), or the `toggle-tab-work-group` command (declared without a `suggested_key` — Chrome allows only four suggested keys per extension and the existing four are taken).
- **Exempt from regrouping**: `regroupTabsInWindow` queries `chrome.tabGroups` up front, collects the ids of groups titled `workGroupTitle` into `workGroupIds`, and `continue`s past any tab in one — so those tabs are neither domain-mapped nor ungrouped, and don't count toward the ≥ 2 threshold for their domain. The title is also filtered out of `titleToGroupId` so a domain can never claim the group.
- **Identified by title**, like every other group here. The title lives in `chrome.storage.local` under `workGroupTitle` (default `WORK`); renaming it via the popup fires `chrome.storage.onChanged`, which calls `renameWorkGroups(previousTitle)` to retitle open groups so they aren't orphaned into domain grouping. `previousTitle` comes from the change record's `oldValue`, not the in-memory variable, which may be stale on a just-woken service worker.
- **Coloured grey** (`WORK_GROUP_COLOR`), a colour absent from `COLORS`, so it never looks like a domain group.
- **`openInWorkGroup` re-validates the URL** against `^https?://` — it arrives from a content script, i.e. from a web page.
- **Released** via `releaseWorkGroup(windowId)`: ungroups every tab in the group and schedules a regroup.

## Key constraints

- **Groups require ≥ 2 tabs**: a domain with only one tab is always left ungrouped. This is intentional.
- **Non-http tabs are never grouped**: `chrome://`, `about:blank`, `file://`, etc. are always ungrouped.
- **Pinned tabs are ignored**: `regroupTabsInWindow` skips them entirely — they are never grouped, never ungrouped, and don't count toward the ≥ 2 threshold for their domain.
- **Subdomains merge into their base domain by default** (`mail.google.com` and `docs.google.com` both group under `google.com`), except for hardcoded multi-part TLDs (`co.uk`, `com.au`, etc.) and user-configured entries in `chrome.storage.local` under the key `noMergeDomains` (array of lowercase domain strings, editable from the popup's settings panel). Both act the same way in `getBaseDomain`: they keep one extra label instead of collapsing, so `gitlab.inbit.org` and `privatebin.inbit.org` stay in separate groups rather than merging into `inbit.org`. `background.js` loads this list once per service-worker wake (`settingsReady`) and re-applies it live via `chrome.storage.onChanged`.
- **The WORK group is never touched by regrouping**: its tabs stay put regardless of domain. A consequence is that pulling a tab into WORK can leave its domain with one tab, which then gets ungrouped.
- **Group identity is title-based**: `regroupTabsInWindow` matches existing groups by their `title` string. Renaming a group in the browser will cause a new duplicate group to be created on the next regroup.
- **Service worker lifecycle**: MV3 service workers can be terminated by the browser when idle. The debounce timer (`debounceTimer`) and `pendingWindows` set are in-memory and will be reset if the worker is killed mid-debounce — this is an accepted trade-off.
- **Content-script dead zones**: the click shortcut cannot fire on `chrome://` pages, the Chrome Web Store, the PDF viewer, or tabs loaded before the extension was refreshed. The context menu is the fallback there, which is why both entry points exist.
- **No CSS framework**: all styles are inline in `popup.html` using CSS custom properties (`--bg`, `--surface`, `--accent`, etc.) defined in `:root`. The dark theme is the default; there is no light/dark toggle.
- **Tabs list expand animation**: uses `max-height` transition (0 → 800px) rather than `display` toggling. The JS only adds/removes the `.open` class; it never sets `style.display` on `.tabs-list` elements.
