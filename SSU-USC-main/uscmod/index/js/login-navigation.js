(() => {
  const header = document.querySelector('.top-header');
  const toggle = header.querySelector('.mobile-nav-toggle');
  const setOpen = (open) => {
    header.classList.toggle('nav-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  };
  toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
  document.addEventListener('click', (event) => {
    if (!header.contains(event.target) || event.target.closest('.nav-link')) setOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
      setOpen(false);
      toggle.focus();
    }
  });
  window.matchMedia('(max-width: 940px)').addEventListener('change', () => setOpen(false));
})();
