// Native module scrolling initializes independently of the Firebase events feed.
(() => {
  const frame = document.getElementById('eventsPageMain');
  const highlight = document.getElementById('eventsHighlightSection');
  const upcoming = document.getElementById('eventsUpcomingSection');
  if (!frame || !highlight || !upcoming) return;

  const sectionTop = section => frame.scrollTop + section.getBoundingClientRect().top - frame.getBoundingClientRect().top - frame.clientTop;
  const navigate = section => frame.scrollTo({
    top: sectionTop(section),
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
  });
  document.getElementById('eventsScrollDown')?.addEventListener('click', () => navigate(upcoming));
  document.getElementById('eventsScrollUp')?.addEventListener('click', () => navigate(highlight));

  // Measure the actual content frame, never the document or a scrolled section.
  // Keep a settled Upcoming chapter in place when device orientation changes.
  let previousHeight = 0;
  const resize = () => {
    const atUpcoming = previousHeight && Math.abs(frame.scrollTop - previousHeight) < 3;
    const height = frame.clientHeight;
    if (!height || height === previousHeight) return;
    previousHeight = height;
    frame.style.setProperty('--events-frame-height', `${height}px`);
    if (atUpcoming) frame.scrollTop = sectionTop(upcoming);
  };
  new ResizeObserver(resize).observe(frame);
  resize();
})();
