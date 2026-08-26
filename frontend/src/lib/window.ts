/**
 * Open a URL in a separate browser window rather than a tab. Passing any window
 * feature at all is what makes the browser choose a popup window over a tab, so
 * the size is load-bearing, not cosmetic — `window.open(url, '_blank')` with no
 * features lands in a tab. Sized to most of the screen so listings stay readable.
 */
export function openWindow(url: string) {
  const width = Math.min(1280, Math.round(screen.availWidth * 0.8))
  const height = Math.min(1000, Math.round(screen.availHeight * 0.9))
  // availLeft/availTop are real but missing from lib.dom's Screen type.
  const s = screen as Screen & { availLeft: number; availTop: number }
  const left = Math.round(s.availLeft + (s.availWidth - width) / 2)
  const top = Math.round(s.availTop + (s.availHeight - height) / 2)
  window.open(url, '_blank', `noopener,popup=1,width=${width},height=${height},left=${left},top=${top}`)
}

/** Anchor props that open the link in a new window (with middle-click/⌘-click intact). */
export function windowLink(url: string) {
  return {
    href: url,
    target: '_blank',
    rel: 'noopener',
    onClick: (ev: React.MouseEvent) => {
      // Let modified clicks through so the browser's own "new tab" gestures still work.
      if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button !== 0) return
      ev.preventDefault()
      openWindow(url)
    },
  }
}
