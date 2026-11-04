// Observe bounded activity lists only; full details and management controls keep their behavior.
const motion = matchMedia('(prefers-reduced-motion: reduce)');
for (const list of document.querySelectorAll('.activity-card-grid')) {
  const tracked = new Set();
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) entry.target.classList.toggle('activity-out', !motion.matches && entry.intersectionRatio < .12);
  }, {root:list,threshold:[0,.12,1]});
  const sync = () => {
    for (const item of tracked) if (!list.contains(item)) { observer.unobserve(item); tracked.delete(item); }
    for (const item of list.children) if (!tracked.has(item)) { item.classList.add('activity-fade'); observer.observe(item); tracked.add(item); }
    list.classList.remove('activity-switch');
    void list.offsetWidth;
    list.classList.add('activity-switch');
  };
  new MutationObserver(sync).observe(list,{childList:true});
  motion.addEventListener('change', () => { for (const item of tracked) item.classList.remove('activity-out'); });
  sync();
}
const switches = new WeakMap();
globalThis.USC_FADE_ACTIVITY = (list, render) => {
  switches.get(list)?.animation?.cancel();
  const state = {};
  switches.set(list, state);
  if (motion.matches || !list.animate) { render(); return; }
  state.animation = list.animate([{opacity:getComputedStyle(list).opacity},{opacity:.15}],{duration:120,fill:'forwards'});
  state.animation.finished.then(() => {
    if (switches.get(list) !== state) return;
    render();
    state.animation.cancel();
    state.animation = list.animate([{opacity:.15},{opacity:1}],{duration:160});
  }, () => {});
};
