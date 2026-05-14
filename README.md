# Auto Tab Groups

A Brave / Chrome browser extension that **automatically groups open tabs by domain name**.

All tabs pointing to `github.com` end up in one group, all tabs pointing to `stackoverflow.com` in another, and so on.

---

## Features

- Groups every open tab by its hostname automatically.
- New tabs and browser-internal pages (`chrome://`, `about:blank`, etc.) are **not** grouped.
- Each domain group gets a deterministic colour (the same domain always gets the same colour).
- A small popup shows a live summary of current groups and a **Regroup Tabs Now** button.
- Popup shortcuts for folding/unfolding all groups and jumping to the current tab's group.
- Manual popup group ordering (buttons and keyboard shortcuts), persisted between popup opens.
- Works across all open windows.

---

## Installation (Developer Mode)

1. Clone or download this repository.
2. Open Brave (or Chrome) and navigate to `brave://extensions` (or `chrome://extensions`).
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the root folder of this repository.
5. The extension is now active — open a few tabs on the same domain and watch them group automatically.

---

## How It Works

The background service worker listens for `tabs.onCreated`, `tabs.onUpdated`, `tabs.onRemoved`, `tabs.onMoved`, `tabs.onAttached`, and `tabs.onDetached` events.  
Whenever any of these fires, tab regrouping is scheduled with a short debounce (400 ms) to avoid redundant calls during rapid tab operations.

For each window, the grouping algorithm:

1. Extracts the `hostname` from every `http`/`https` tab URL.
2. Collects all tab IDs that share the same hostname.
3. Reuses an existing tab group whose title matches the hostname, or creates a new one.
4. Tabs without an http/https URL are ungrouped.

---

## Permissions

| Permission   | Reason |
|---|---|
| `tabs`       | Read tab URLs and move tabs into groups |
| `tabGroups`  | Create, update, and query tab groups |
| `storage`    | Persist popup group order |

---

## Popup Keyboard Shortcuts

When the popup is open:

- `Ctrl+Shift+[` — Fold all visible groups
- `Ctrl+Shift+]` — Unfold all visible groups
- `Ctrl+Shift+G` — Focus the group containing the active tab
- `Alt+↑ / Alt+↓` — Move focused group up/down in popup order
- `Ctrl+Shift+M` — Move focused group below the first visible group matching the current search text

---

## Project Structure

```
auto-tab-groups/
├── manifest.json   # Extension manifest (MV3)
├── background.js   # Service worker – core grouping logic
├── popup.html      # Toolbar popup UI
├── popup.js        # Popup logic
└── icons/          # Extension icons (16 × 16, 48 × 48, 128 × 128)
```
