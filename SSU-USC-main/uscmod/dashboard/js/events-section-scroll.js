// Native scrolling and immediate section shortcuts initialize independently of the feed.
(() => {
  const frame = document.getElementById('eventsPageMain');
  const highlight = document.getElementById('eventsHighlightSection');
  const upcoming = document.getElementById('eventsUpcomingSection');
  if (!frame || !highlight || !upcoming) return;

  const sectionTop = section => frame.scrollTop + section.getBoundingClientRect().top - frame.getBoundingClientRect().top - frame.clientTop;
  const navigate = section => {
    frame.scrollTo({ top: sectionTop(section), behavior: 'instant' });
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
    previousHeight = height;
    frame.style.setProperty('--events-frame-height', `${height}px`);
    previousUpcomingTop = sectionTop(upcoming);
    if (atUpcoming) frame.scrollTo({ top: previousUpcomingTop, behavior: 'instant' });
  };
  new ResizeObserver(resize).observe(frame);
  resize();
})();
