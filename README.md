# Auto Tab Groups

[![Build Extension](https://github.com/denis-n-ko/auto-tab-groups/actions/workflows/build.yml/badge.svg)](https://github.com/denis-n-ko/auto-tab-groups/actions/workflows/build.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Auto Tab Groups is a Manifest V3 extension for Chrome and Brave that automatically organizes unpinned tabs into browser tab groups by domain.

Tabs from `mail.google.com` and `docs.google.com`, for example, are grouped together as `google.com`. Groups are updated as tabs are opened, navigated, closed, and moved.

## Features

- Groups two or more unpinned `http`/`https` tabs that share a base domain.
- Merges subdomains by default, with support for common multi-part TLDs such as `co.uk`.
- Lets you keep selected domains' subdomains separate from the popup settings.
- Assigns each domain a deterministic tab-group colour.
- Provides a searchable popup that mirrors browser group order, supports group repositioning, keyboard navigation, and quick tab closing.
- Includes browser-wide shortcuts to collapse, expand, or focus tab groups.
- Works independently in every open browser window.

## Install from source

1. Clone or download this repository.
2. Open `chrome://extensions` in Chrome or `brave://extensions` in Brave.
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose this repository's root directory.
5. Open at least two unpinned tabs for the same domain.

After changing `background.js` or `manifest.json`, use the refresh button on the extension card. Changes to the popup take effect the next time it is opened.

## Keyboard shortcuts

Configure or resolve shortcut conflicts at `chrome://extensions/shortcuts` or `brave://extensions/shortcuts`.

| Command | Windows / Linux | macOS |
| --- | --- | --- |
| Open the popup | `Alt`+`Shift`+`G` | `Cmd`+`Shift`+`E` |
| Collapse all groups | `Ctrl`+`Shift`+`,` | `Ctrl`+`Shift`+`,` |
| Expand all groups | `Ctrl`+`Shift`+`.` | `Ctrl`+`Shift`+`.` |
| Focus the active group | `Ctrl`+`Shift`+`U` | `Ctrl`+`Shift`+`G` |

When the popup is open, use `Ctrl`+`Shift`+`[` and `Ctrl`+`Shift`+`]` to collapse and expand visible groups, arrow keys to navigate, and `Enter` to open a group or activate a tab. Use `Alt`+`↑` / `Alt`+`↓` or `Cmd`+`↑` / `Cmd`+`↓` on macOS to move the focused group up or down in the browser tab strip. Left and right arrows collapse or expand a focused group.

## Behavior and limitations

- A domain needs at least two eligible tabs to form a group; a lone tab is left ungrouped.
- Pinned tabs and non-web pages such as `chrome://`, `about:blank`, and `file://` are never grouped.
- A manually renamed browser group is no longer recognized as the domain group, so a later regroup can create a new group.
- The extension uses a practical list of common multi-part TLDs, not the full Public Suffix List.

## Privacy and permissions

Auto Tab Groups has no network requests, analytics, accounts, or remote code. It processes tab URLs locally in the browser solely to determine their domains.

| Permission | Purpose |
| --- | --- |
| `tabs` | Read tab URLs and arrange tabs into groups. |
| `tabGroups` | Create, update, and inspect browser tab groups. |
| `storage` | Save domain-separation preferences locally. |

## Development

This project uses plain HTML, CSS, and JavaScript with no dependencies, build step, or automated test suite. Load it unpacked as described above and test changes in Chrome or Brave.

The GitHub Actions workflow performs syntax and manifest validation, then packages the extension as a ZIP artifact. Tagged releases publish a ready-to-load ZIP with the version taken from the tag.

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md), follow the [Code of Conduct](CODE_OF_CONDUCT.md), and report security issues through the process in [SECURITY.md](SECURITY.md).

## License

Distributed under the [MIT License](LICENSE).
