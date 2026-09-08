/**
 * Grouple – link-click content script.
 *
 * The browser handles Cmd/Ctrl+click itself and extensions cannot hook that,
 * so the only way to route a link into the manual group is to watch clicks in
 * the page. On Cmd+Alt+click (Ctrl+Alt+click on Windows/Linux) we cancel the
 * navigation and hand the URL to the service worker, which opens it directly
 * inside the manual group. No other modifier combination is touched, so every
 * native click shortcut keeps working.
 */

/** True for the modifier combo that means "send this link to the manual group". */
function isManualGroupClick(event) {
  return event.button === 0
    && event.altKey
    && (event.metaKey || event.ctrlKey)
    && !event.shiftKey;
}

/**
 * Walks the composed event path (so links inside shadow roots are found too)
 * and returns the first anchor's resolved http/https href.
 */
function findLinkUrl(event) {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
  for (const node of path) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) continue;
    const name = node.nodeName.toLowerCase();
    if (name !== 'a' && name !== 'area') continue;
    const href = node.href;
    if (typeof href !== 'string' || !href) continue;
    return /^https?:\/\//i.test(href) ? href : null;
  }
  return null;
}

// Capture phase so the page's own click handlers don't get to navigate first.
document.addEventListener('click', (event) => {
  if (!isManualGroupClick(event)) return;

  const url = findLinkUrl(event);
  if (!url) return;

  event.preventDefault();
  event.stopPropagation();

  // The service worker may be gone or the extension reloaded mid-session;
  // a failed send should never leave a page error behind.
  try {
    chrome.runtime.sendMessage({ action: 'openInWorkGroup', url }).catch(() => {});
  } catch {
    /* extension context invalidated – ignore */
  }
}, true);
