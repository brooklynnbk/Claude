// Keep HQ's bottom tab bar clear of things other services float over the page
// (e.g. the "Powered by Netlify" badge). We look for anything near the bottom
// of the screen that isn't part of HQ and lift the tab bar above it. If the
// overlay goes away, the extra space goes too.

const SCAN_HEIGHT = 160; // px from the bottom of the screen
const GAP = 8;

function measureClearance(root: HTMLElement): number {
  const w = window.innerWidth;
  const h = window.innerHeight;
  let top = h;
  for (const fx of [0.08, 0.3, 0.5, 0.7, 0.85, 0.95]) {
    for (let y = h - 4; y > h - SCAN_HEIGHT; y -= 6) {
      const el = document.elementFromPoint(w * fx, y);
      if (el && el !== document.documentElement && el !== document.body && !root.contains(el)) top = Math.min(top, y);
    }
  }
  return top < h ? Math.ceil(h - top + GAP) : 0;
}

export function keepClearOfOverlays(): void {
  const root = document.getElementById('root');
  if (!root || typeof document.elementFromPoint !== 'function') return;
  let current = -1;
  const update = () => {
    const next = measureClearance(root);
    if (next !== current) {
      current = next;
      document.documentElement.style.setProperty('--overlay-clearance', `${next}px`);
    }
  };
  // Third-party overlays load late, so check for a while, then on changes.
  let ticks = 0;
  const timer = setInterval(() => {
    update();
    if (++ticks > 20) clearInterval(timer);
  }, 1000);
  new MutationObserver(() => requestAnimationFrame(update)).observe(document.body, { childList: true });
  window.addEventListener('resize', update);
  document.addEventListener('visibilitychange', update);
  update();
}
