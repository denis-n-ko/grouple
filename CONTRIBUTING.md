# Contributing to Auto Tab Groups

Thanks for contributing.

## Before you start

- Search existing issues and pull requests before opening a new one.
- For substantial behavior or UX changes, open an issue first so the approach can be discussed.
- Keep each pull request focused on one change.

## Development workflow

The extension has no dependencies or build step.

1. Fork the repository and create a branch from `main`.
2. Load the repository root as an unpacked extension in Chrome or Brave.
3. Make the change.
4. Refresh the extension card after changing `background.js` or `manifest.json`; reopen the popup after changing `popup.html` or `popup.js`.
5. Manually test the affected behavior, including relevant edge cases such as pinned tabs, single-tab domains, non-web URLs, and multiple windows.
6. Run the validation commands from the CI workflow:

   ```sh
   node --check background.js
   node --check popup.js
   node -e "JSON.parse(require('fs').readFileSync('manifest.json', 'utf8'))"
   ```

7. Open a pull request explaining the problem, solution, and manual testing performed.

## Style

- Use the existing plain JavaScript, HTML, and CSS patterns; do not add dependencies without prior discussion.
- Keep changes accessible, especially keyboard interactions and labels.
- Update the README when behavior, permissions, shortcuts, or installation instructions change.

## Reporting issues

Use the issue forms for reproducible bugs and feature proposals. Do not include security vulnerabilities in public issues; follow [SECURITY.md](SECURITY.md) instead.
