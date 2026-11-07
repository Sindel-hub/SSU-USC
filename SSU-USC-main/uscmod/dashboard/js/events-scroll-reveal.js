// Scroll-driven reveal only: never captures wheel or touch input.
(() => {
  const frame=document.getElementById('eventsPageMain');
  if(!frame)return;
  const motion=matchMedia('(prefers-reduced-motion: reduce)');
  const targets=[...frame.querySelectorAll('.events-highlight-center,.events-upcoming-copy > h2,.events-upcoming-copy > p,.events-upcoming-copy > .activity-tabs,.events-upcoming-calendar')];
  let pending=0;
  const update=()=>{
    pending=0;const bounds=frame.getBoundingClientRect();
    for(const target of targets){const r=target.getBoundingClientRect();const visible=Math.max(0,Math.min(r.bottom,bounds.bottom,innerHeight)-Math.max(r.top,bounds.top,0));const ratio=motion.matches?1:Math.min(1,visible/Math.min(100,r.height||1));target.style.setProperty('--section-reveal',String(ratio));}
  };
  const schedule=()=>{if(!pending)pending=requestAnimationFrame(update)};
  targets.forEach(e=>e.classList.add('events-scroll-reveal'));
  frame.addEventListener('scroll',schedule,{passive:true});window.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',schedule,{passive:true});motion.addEventListener('change',schedule);new ResizeObserver(schedule).observe(frame);schedule();
})();
