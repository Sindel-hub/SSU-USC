import { auth, db } from '../firebase/firebase-config.js';
import { EmailAuthProvider, reauthenticateWithCredential } from 'https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js';
import { callStudentEmailService } from './supabase-email-service.js';
import { institutionalEmailForDisplay, validateInstitutionalEmail } from './account-email.js';

export async function initializeInstitutionalEmailSettings(root) {
  if (!root || !auth.currentUser) return;
  if (!document.getElementById("uscInstitutionalEmailStyles")) {
    const style = document.createElement("link");
    style.id = "uscInstitutionalEmailStyles"; style.rel = "stylesheet";
    style.href = new URL("./institutional-email-settings.css?v=1", import.meta.url).href;
    document.head.appendChild(style);
  }
  root.innerHTML = `
    <div class="usc-profile-password-head"><strong>Account Settings</strong><small>Institutional email</small></div>
    <p id="institutionalEmailState" role="status" aria-live="polite">Checking institutional email…</p>
    <form id="institutionalEmailForm">
      <label for="institutionalEmailAddress">University email<input id="institutionalEmailAddress" type="email" autocomplete="email" placeholder="name@ssu.edu.ph" maxlength="200" required aria-describedby="institutionalEmailHint"></label>
      <label for="institutionalEmailPassword">Current password<input id="institutionalEmailPassword" type="password" autocomplete="current-password" required></label>
      <p id="institutionalEmailHint">Verify your @ssu.edu.ph address to enable email login. Your Student ID and password stay the same.</p>
      <button class="usc-profile-save" type="submit">Send verification link</button>
    </form>
    <p id="institutionalEmailMessage" class="usc-profile-password-message" role="status" aria-live="polite"></p>`;
  const form = root.querySelector('form');
  const state = root.querySelector('#institutionalEmailState');
  const emailInput = root.querySelector('#institutionalEmailAddress');
  const passwordInput = root.querySelector('#institutionalEmailPassword');
  const message = root.querySelector('#institutionalEmailMessage');
  const button = root.querySelector('button');
  const profileSnap = await getDoc(doc(db, 'users', auth.currentUser.uid));
  const profile = profileSnap.exists() ? profileSnap.data() : {};
  const email = institutionalEmailForDisplay(profile);
  const verified = email && (profile.institutionalEmailVerified === true || (auth.currentUser.emailVerified && auth.currentUser.email?.toLowerCase() === email));
  state.textContent = verified ? `${email} · Verified` : email ? `${email} · Not verified` : 'Not Linked';
  emailInput.value = email;
  form.hidden = Boolean(verified);
  // A pending request is informational only; it never enables email login.
  callStudentEmailService('institutional_get').then(result => {
    if (!root.isConnected) return;
    state.textContent = result.verified ? `${result.email} · Verified` : result.pendingEmail ? `Verification pending: ${result.pendingEmail}` : result.email ? `${result.email} · Not verified` : 'Not Linked';
    form.hidden = result.verified;
  }).catch(() => { message.textContent = 'Email linking requires the updated USC email service. You can still sign in using your Student ID.'; });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (button.disabled) return;
    button.disabled = true;
    message.textContent = '';
    try {
      const address = validateInstitutionalEmail(emailInput.value);
      const user = auth.currentUser;
      if (!user?.email) throw new Error('Sign in again to link your institutional email.');
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, passwordInput.value));
      passwordInput.value = '';
      const result = await callStudentEmailService('institutional_request', { email: address });
      state.textContent = `Verification pending: ${result.email}`;
      message.textContent = result.message;
      message.dataset.kind = 'success';
    } catch (error) {
      message.textContent = ['auth/invalid-credential', 'auth/wrong-password'].includes(error.code) ? 'Your current password is incorrect.' : error.message || 'Unable to send verification. Try again.';
      message.dataset.kind = 'error';
    } finally { passwordInput.value = ''; button.disabled = false; }
  });
}
