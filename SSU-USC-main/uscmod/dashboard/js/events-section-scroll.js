// Smooth chapter navigation with native scrolling inside cards, calendars and dialogs.
(() => {
  const frame = document.getElementById('eventsPageMain');
  const highlight = document.getElementById('eventsHighlightSection');
  const upcoming = document.getElementById('eventsUpcomingSection');
  if (!frame || !highlight || !upcoming) return;

  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let destination = null;
  const protectedControl = target => Boolean(target.closest?.('[role="dialog"], input, textarea, select, [contenteditable="true"]'));
  const ownsScroll = (target, delta) => {
    if (protectedControl(target)) return true;
    const list=target.closest?.('.activity-card-grid');
    if (!list || list.scrollHeight<=list.clientHeight+1) return false;
    return delta>0 ? list.scrollTop+list.clientHeight<list.scrollHeight-1 : list.scrollTop>1;
  };
  const sectionTop = section => frame.scrollTop + section.getBoundingClientRect().top - frame.getBoundingClientRect().top - frame.clientTop;
  const navigate = section => {
    destination = section;
    frame.scrollTo({ top: sectionTop(section), behavior: motion.matches ? 'instant' : 'smooth' });
  };
  document.getElementById('eventsScrollDown')?.addEventListener('click', () => navigate(upcoming));
  document.getElementById('eventsScrollUp')?.addEventListener('click', () => navigate(highlight));

  // Repeat wheel momentum keeps the same destination instead of jumping twice.
  // There is no timed lock: reverse input can immediately reverse the transition.
  frame.addEventListener('wheel', event => {
    if (motion.matches || event.defaultPrevented || event.ctrlKey || event.shiftKey ||
        Math.abs(event.deltaX) > Math.abs(event.deltaY) || Math.abs(event.deltaY) < 16 ||
        !event.cancelable || ownsScroll(event.target,event.deltaY)) { destination=null; return; }
    const boundary = sectionTop(upcoming);
    const down = event.deltaY > 0;
    const target = down && frame.scrollTop < boundary - 2 ? upcoming :
      !down && frame.scrollTop > 2 && frame.scrollTop <= boundary + 2 ? highlight : null;
    if (!target) return; // Native scrolling within a tall section or beyond either chapter.
    event.preventDefault();
    if (destination !== target) navigate(target);
  }, {passive:false});
  frame.addEventListener('scroll', () => {
    if (destination && Math.abs(frame.scrollTop - sectionTop(destination)) < 2) destination=null;
  }, {passive:true});
  frame.addEventListener('scrollend', () => {destination=null;}, {passive:true});
  for (const name of ['pointerdown','keydown']) frame.addEventListener(name, () => {destination=null;}, {passive:true});
  let touch = null;
  frame.addEventListener('touchstart', event => {
    destination=null;
    const point=event.touches?.[0];
    const list=event.target.closest?.('.activity-card-grid');
    touch=point && !protectedControl(event.target) ? {x:point.clientX,y:point.clientY,top:frame.scrollTop,list, listTop:list?.scrollTop || 0, listMax:list?Math.max(0,list.scrollHeight-list.clientHeight):0} : null;
  }, {passive:true});
  frame.addEventListener('touchend', event => {
    const start=touch;touch=null;
    const point=event.changedTouches?.[0];
    if (!start || !point || motion.matches) return;
    const dy=start.y-point.clientY, dx=start.x-point.clientX;
    if (Math.abs(dy)<48 || Math.abs(dy)<=Math.abs(dx)*1.2) return;
    // A swipe that began with room inside a card list belongs to that list,
    // even if its momentum reaches the edge before the finger lifts.
    if (start.list && (dy>0 ? start.listTop<start.listMax-1 : start.listTop>1)) return;
    const boundary=sectionTop(upcoming);
    if (dy>0 && start.top<boundary-2) navigate(upcoming);
    else if (dy<0 && start.top<=boundary+2) navigate(highlight);
  }, {passive:true});
  frame.addEventListener('touchcancel', () => {touch=null;}, {passive:true});
  motion.addEventListener('change', () => {
    destination=null;
    if(motion.matches)frame.scrollTo({top:frame.scrollTop,behavior:'instant'});
  });


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
