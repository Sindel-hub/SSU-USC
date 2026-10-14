// Public UI navigation initializes independently of the Firebase events feed.
(() => {
  const highlight = document.getElementById('eventsHighlightSection');
  const upcoming = document.getElementById('eventsUpcomingSection');
  if (!highlight || !upcoming) return;
  const headerOffset = () => {
    const header = document.querySelector('.dashboard-header');
    return header && ['fixed', 'sticky'].includes(getComputedStyle(header).position)
      ? header.getBoundingClientRect().height : 0;
  };
  const top = (section) => Math.max(0, window.scrollY + section.getBoundingClientRect().top - headerOffset());
  let destination = null;
  let destinationTime = 0;
  const navigate = (section) => {
    destination = section;
    destinationTime = performance.now();
    window.scrollTo({ top: section === highlight ? 0 : top(section), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  };
  document.getElementById('eventsScrollDown')?.addEventListener('click', () => navigate(upcoming));
  document.getElementById('eventsScrollUp')?.addEventListener('click', () => navigate(highlight));
  const excluded = (target) => !(target instanceof Element) || !!target.closest('.student-sidebar, .notification-panel, [role="dialog"], .events-detail-modal, .profile-drawer, input, textarea, select, [contenteditable="true"]');
  const nestedCanScroll = (target, direction) => {
    for (let el = target; el instanceof Element && el !== document.body; el = el.parentElement) {
      if (!/(auto|scroll)/.test(getComputedStyle(el).overflowY) || el.scrollHeight <= el.clientHeight + 2) continue;
      if (direction > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 2 : el.scrollTop > 2) return true;
    }
    return false;
  };
  const nextSection = (direction, target) => {
    if (excluded(target) || nestedCanScroll(target, direction)) return null;
    if (performance.now() - destinationTime < 700 && destination) {
      return direction > 0 && destination === highlight ? upcoming : direction < 0 && destination === upcoming ? highlight : null;
    }
    const y = window.scrollY;
    const upcomingTop = top(upcoming);
    // Let long chapters scroll to their boundary before changing chapters.
    if (direction > 0 && y < upcomingTop - 40 && highlight.getBoundingClientRect().bottom <= window.innerHeight + 40) return upcoming;
    if (direction < 0 && y >= upcomingTop - 40 && y <= upcomingTop + 40) return highlight;
    return null;
  };
  let wheelLocked = false, wheelTimer;
  const lockWheel = () => {
    wheelLocked = true;
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => { wheelLocked = false; }, 180);
  };
  window.addEventListener('wheel', (event) => {
    if (event.ctrlKey || excluded(event.target) || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    if (wheelLocked) { event.preventDefault(); lockWheel(); return; }
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1);
    if (Math.abs(delta) < 18) return;
    const next = nextSection(Math.sign(delta), event.target);
    if (next) { event.preventDefault(); navigate(next); lockWheel(); }
  }, { passive: false });
  let touch = null;
  window.addEventListener('touchstart', (event) => {
    touch = event.touches.length === 1 && !excluded(event.target)
      ? { x: event.touches[0].clientX, y: event.touches[0].clientY, target: event.target, next: null } : null;
  }, { passive: true });
  window.addEventListener('touchmove', (event) => {
    if (!touch || event.touches.length !== 1) { touch = null; return; }
    const dx = touch.x - event.touches[0].clientX, dy = touch.y - event.touches[0].clientY;
    if (Math.abs(dy) < 7 || Math.abs(dy) <= Math.abs(dx) * 1.1) return;
    touch.next = nextSection(Math.sign(dy), touch.target);
    if (touch.next && event.cancelable) event.preventDefault();
  }, { passive: false });
  window.addEventListener('touchend', (event) => {
    if (!touch) return;
    const end = event.changedTouches[0];
    if (end && touch.next && Math.abs(touch.y - end.clientY) >= 36 && Math.abs(touch.y - end.clientY) > Math.abs(touch.x - end.clientX) * 1.1) navigate(touch.next);
    touch = null;
  }, { passive: true });
  window.addEventListener('touchcancel', () => { touch = null; }, { passive: true });
  window.addEventListener('resize', () => { destination = null; touch = null; wheelLocked = false; clearTimeout(wheelTimer); });
})();
