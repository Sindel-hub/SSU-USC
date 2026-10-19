// Module navigation and wheel smoothing initialize independently of the Firebase feed.
(() => {
  const frame = document.getElementById('eventsPageMain');
  const highlight = document.getElementById('eventsHighlightSection');
  const upcoming = document.getElementById('eventsUpcomingSection');
  if (!frame || !highlight || !upcoming) return;

  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let animation = 0;
  let target = 0;
  let direction = 0;
  let previousTime = 0;
  const limit = () => Math.max(0, frame.scrollHeight - frame.clientHeight);
  const clamp = value => Math.max(0, Math.min(limit(), value));
  const stopWheel = () => {
    cancelAnimationFrame(animation);
    animation = 0;
  };
  const animateWheel = time => {
    const elapsed = Math.min(64, Math.max(1, time - previousTime));
    previousTime = time;
    target = clamp(target);
    const remaining = target - frame.scrollTop;
    if (Math.abs(remaining) <= 1) {
      frame.scrollTo({ top: target, behavior: 'instant' });
      animation = 0;
      return;
    }
    frame.scrollTo({ top: frame.scrollTop + remaining * (1 - Math.exp(-elapsed / 45)), behavior: 'instant' });
    animation = requestAnimationFrame(animateWheel);
  };
  const nestedCanScroll = (element, delta) => {
    for (let el = element; el && el !== frame; el = el.parentElement) {
      if (!/(auto|scroll)/.test(getComputedStyle(el).overflowY) || el.scrollHeight <= el.clientHeight + 1) continue;
      if (delta > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 1) return true;
    }
    return false;
  };
  frame.addEventListener('wheel', event => {
    // Leave zoom, horizontal gestures, touchpad micro-deltas, and form controls native.
    if (event.defaultPrevented || !event.cancelable || motion.matches || event.ctrlKey || event.shiftKey ||
        Math.abs(event.deltaX) > Math.abs(event.deltaY) || !event.deltaY ||
        event.target.closest?.('input, textarea, select, [contenteditable="true"], [role="dialog"]') ||
        (event.deltaMode === 0 && Math.abs(event.deltaY) < 16)) {
      stopWheel();
      return;
    }
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? frame.clientHeight : 1);
    if (nestedCanScroll(event.target, delta) ||
        (delta > 0 ? frame.scrollTop >= limit() - 1 : frame.scrollTop <= 1)) {
      stopWheel();
      return; // At the boundary, allow the page to scroll to/from the footer.
    }
    event.preventDefault();
    const nextDirection = Math.sign(delta);
    target = clamp((animation && nextDirection === direction ? target : frame.scrollTop) + delta);
    direction = nextDirection;
    if (!animation) {
      previousTime = performance.now();
      animation = requestAnimationFrame(animateWheel);
    }
  }, { passive: false });
  for (const name of ['pointerdown', 'touchstart', 'keydown']) frame.addEventListener(name, stopWheel, { passive: true });
  motion.addEventListener?.('change', stopWheel);

  const sectionTop = section => frame.scrollTop + section.getBoundingClientRect().top - frame.getBoundingClientRect().top - frame.clientTop;
  const navigate = section => {
    stopWheel();
    frame.scrollTo({ top: sectionTop(section), behavior: motion.matches ? 'instant' : 'smooth' });
  };
  document.getElementById('eventsScrollDown')?.addEventListener('click', () => navigate(upcoming));
  document.getElementById('eventsScrollUp')?.addEventListener('click', () => navigate(highlight));

  // Measure the content frame, never the document or a scrolled section.
  let previousHeight = 0;
  let previousUpcomingTop = 0;
  const resize = () => {
    const atUpcoming = previousHeight && Math.abs(frame.scrollTop - previousUpcomingTop) < 3;
    const height = frame.clientHeight;
    if (!height || height === previousHeight) return;
    stopWheel();
    previousHeight = height;
    frame.style.setProperty('--events-frame-height', `${height}px`);
    previousUpcomingTop = sectionTop(upcoming);
    if (atUpcoming) frame.scrollTo({ top: previousUpcomingTop, behavior: 'instant' });
  };
  new ResizeObserver(resize).observe(frame);
  resize();
})();
