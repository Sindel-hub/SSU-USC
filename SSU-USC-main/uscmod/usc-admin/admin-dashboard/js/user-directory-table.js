// Interaction and scroll controls only; account access is handled by the existing editor.
export function bindDirectoryTable({ body, scroller, scrollbar, slider, openAccount }) {
  let down = null, lastTap = null;
  const interactive = target => target.closest('button, input, select, textarea, a, label, summary');
  const rowFor = target => target.closest('[data-account-row]');
  body.addEventListener('click', event => {
    const name = event.target.closest('[data-account-name]');
    if (name) openAccount(name.dataset.accountName);
  });
  body.addEventListener('dblclick', event => {
    if (interactive(event.target)) return;
    const row = rowFor(event.target);
    if (row) { event.preventDefault(); lastTap = null; openAccount(row.dataset.accountRow); }
  });
  body.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' || !event.isPrimary || interactive(event.target)) { down = null; lastTap = null; return; }
    const row = rowFor(event.target);
    down = row ? { id: event.pointerId, uid: row.dataset.accountRow, x: event.clientX, y: event.clientY, at: performance.now() } : null;
  });
  body.addEventListener('pointermove', event => {
    if (down && (Math.abs(event.clientX - down.x) > 10 || Math.abs(event.clientY - down.y) > 10)) { down = null; lastTap = null; }
  });
  body.addEventListener('pointercancel', () => { down = null; lastTap = null; });
  body.addEventListener('pointerup', event => {
    if (!down || down.id !== event.pointerId) return;
    const tap = down; down = null;
    const now = performance.now(), row = rowFor(event.target);
    if (!row || interactive(event.target) || row.dataset.accountRow !== tap.uid || now - tap.at > 400
      || Math.abs(event.clientX - tap.x) > 10 || Math.abs(event.clientY - tap.y) > 10) { lastTap = null; return; }
    if (lastTap && lastTap.uid === tap.uid && now - lastTap.at <= 400
      && Math.abs(tap.x - lastTap.x) <= 24 && Math.abs(tap.y - lastTap.y) <= 24) {
      event.preventDefault(); lastTap = null; openAccount(tap.uid);
    } else lastTap = { ...tap, at: now };
  });
  scroller.addEventListener('scroll', () => {
    lastTap = null; down = null; slider.value = String(scroller.scrollLeft);
  }, { passive: true });
  slider.addEventListener('input', () => { scroller.scrollLeft = Number(slider.value); });
  const refresh = () => {
    const maximum = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    scrollbar.hidden = maximum <= 1;
    slider.max = String(maximum); slider.value = String(scroller.scrollLeft);
  };
  const observer = new ResizeObserver(refresh);
  observer.observe(scroller); observer.observe(scroller.querySelector('table'));
  refresh();
  return { refresh };
}
