/* UI only: no authentication, account, storage or recovery operations. */
(() => {
  const button = document.getElementById('loginHelpButton');
  const dialog = document.getElementById('loginHelpDialog');
  if (!button || !dialog) return;
  button.addEventListener('click', () => {
    if (!dialog.open) dialog.showModal();
  });
  document.getElementById('closeLoginHelp')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    const rect = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
  });
  dialog.addEventListener('close', () => button.focus({ preventScroll: true }));
})();
