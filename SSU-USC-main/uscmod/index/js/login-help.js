/* Presentation only; never reads credentials or invokes account services. */
(() => {
  const button = document.getElementById('loginHelpButton');
  const dialog = document.getElementById('loginHelpDialog');
  const closeButton = document.getElementById('closeLoginHelp');
  const card = button?.closest('.glass-panel');
  if (!button || !dialog || !closeButton || !card) return;
  const desktop = window.matchMedia('(min-width: 941px)');
  let restoreFocus = true;

  function positionPanel() {
    if (!dialog.open || !desktop.matches) return;
    const cardRect = card.getBoundingClientRect();
    const iconRect = button.getBoundingClientRect();
    const available = Math.max(0, window.innerWidth - cardRect.right - 28);
    dialog.style.width = `${Math.min(330, available)}px`;
    dialog.style.left = `${cardRect.right + 12}px`;
    const height = dialog.getBoundingClientRect().height;
    dialog.style.top = `${Math.max(16, Math.min(iconRect.top, window.innerHeight - height - 16))}px`;
  }

  function openHelp() {
    restoreFocus = true;
    dialog.removeAttribute('style');
    dialog.setAttribute('aria-modal', desktop.matches ? 'false' : 'true');
    button.setAttribute('aria-expanded', 'true');
    if (desktop.matches) dialog.show();
    else dialog.showModal();
    positionPanel();
    closeButton.focus({ preventScroll: true });
  }

  function closeHelp(focus = true) {
    restoreFocus = focus;
    dialog.close();
  }

  button.setAttribute('aria-expanded', 'false');
  button.addEventListener('click', () => dialog.open ? closeHelp() : openHelp());
  closeButton.addEventListener('click', () => closeHelp());
  document.addEventListener('pointerdown', event => {
    if (desktop.matches && dialog.open && !dialog.contains(event.target) && !button.contains(event.target)) closeHelp(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && dialog.open && desktop.matches) {
      event.preventDefault(); closeHelp();
    }
  });
  dialog.addEventListener('click', event => {
    if (desktop.matches) return;
    const rect = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) closeHelp();
  });
  dialog.addEventListener('close', () => {
    if (dialog.open) return; // A breakpoint switch may already have reopened it.
    button.setAttribute('aria-expanded', 'false');
    if (restoreFocus) button.focus({ preventScroll: true });
  });
  desktop.addEventListener('change', () => {
    if (!dialog.open) return;
    dialog.close(); openHelp();
  });
  window.addEventListener('resize', positionPanel);
  window.addEventListener('scroll', positionPanel, { passive: true });
})();
