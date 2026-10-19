export function chosenPasswordIsValid(password) {
  return typeof password === 'string' && password.length >= 10 && password.length <= 64
    && /[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password)
    && /[^A-Za-z0-9\s]/.test(password);
}

export function createAdminPasswordEditor({ callSecure, onSaved }) {
  const dialog = document.getElementById('adminPasswordDialog');
  const form = document.getElementById('adminPasswordForm');
  const password = document.getElementById('adminChosenPassword');
  const confirmation = document.getElementById('adminConfirmPassword');
  const feedback = document.getElementById('adminPasswordFeedback');
  const save = document.getElementById('saveAdminPasswordButton');
  const cancel = document.getElementById('cancelAdminPasswordButton');
  const show = document.getElementById('showAdminPasswordsButton');
  let target = null, busy = false, returnFocus = null;
  function message(text, error = false) {
    feedback.textContent = text;
    feedback.classList.toggle('is-error', error);
  }
  function reset() {
    form.reset();
    password.type = confirmation.type = 'password';
    password.removeAttribute('aria-invalid');
    confirmation.removeAttribute('aria-invalid');
    show.setAttribute('aria-pressed', 'false');
    show.textContent = 'Show passwords';
    message('');
  }
  function setBusy(value) {
    busy = value;
    form.setAttribute('aria-busy', String(value));
    for (const control of [password, confirmation, save, cancel, show]) control.disabled = value;
    save.textContent = value ? 'Saving…' : 'Save password';
  }
  function close() { if (!busy) { reset(); dialog.close(); target = null; returnFocus?.focus({ preventScroll: true }); } }
  dialog.addEventListener('close', () => { if (!dialog.open) { reset(); target = null; returnFocus?.focus({ preventScroll: true }); } });
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); else reset(); });
  cancel.addEventListener('click', close);
  show.addEventListener('click', () => {
    const visible = password.type === 'password';
    password.type = confirmation.type = visible ? 'text' : 'password';
    show.setAttribute('aria-pressed', String(visible));
    show.textContent = visible ? 'Hide passwords' : 'Show passwords';
  });
  for (const input of [password, confirmation]) input.addEventListener('input', () => {
    input.removeAttribute('aria-invalid'); message('');
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !target) return;
    if (!chosenPasswordIsValid(password.value)) {
      message('Use 10–64 characters, including uppercase, lowercase, a number, and a symbol.', true);
      password.setAttribute('aria-invalid', 'true'); password.focus(); return;
    }
    if (password.value !== confirmation.value) {
      message('Passwords do not match.', true);
      confirmation.setAttribute('aria-invalid', 'true'); confirmation.focus(); return;
    }
    if (!window.confirm(`Set a new password for ${target.fullName || target.studentId || 'this user'}? Their current password will stop working.`)) return;
    setBusy(true); message('Saving password…');
    try {
      const result = await callSecure('adminSetUserPassword', { uid: target.uid, password: password.value });
      if (result?.changed !== true || result.uid !== target.uid) throw new Error('The password change could not be confirmed.');
      const name = target.fullName || target.studentId || 'the selected user';
      setBusy(false);
      close();
      onSaved(`Password changed for ${name}.${result.warning ? ` ${result.warning}` : ''}`);
    } catch (error) {
      message(error.message || 'The password change could not be confirmed.', true);
    } finally { setBusy(false); }
  });
  return { open(user) {
    if (busy || dialog.open || !user?.uid || !['student', 'officer'].includes(user.role)) return;
    reset(); target = { uid: user.uid, fullName: user.fullName, studentId: user.studentId };
    returnFocus = document.activeElement;
    document.getElementById('adminPasswordTarget').textContent = `${user.fullName || 'Unnamed user'} · ${user.studentId || user.email || user.uid}`;
    dialog.showModal(); password.focus();
  } };
}
