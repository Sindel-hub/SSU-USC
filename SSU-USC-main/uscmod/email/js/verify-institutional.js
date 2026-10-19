import { auth } from '../../firebase/firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js';
import { callStudentEmailService } from '../../shared/supabase-email-service.js';

const key = 'uscInstitutionalVerificationToken';
const button = document.getElementById('verifyButton');
const status = document.getElementById('verifyStatusText');
const signIn = document.getElementById('signinButton');
const url = new URL(location.href);
const incoming = url.searchParams.get('token');
if (incoming) {
  sessionStorage.removeItem(key);
  if (/^[a-f0-9]{64}$/.test(incoming)) sessionStorage.setItem(key, incoming);
  url.searchParams.delete('token');
  history.replaceState(null, '', url.pathname + url.search + url.hash);
}
let token = sessionStorage.getItem(key) || '';
let busy = false, done = false;
function sessionState() {
  button.disabled = busy || done || !auth.currentUser || !/^[a-f0-9]{64}$/.test(token);
  if (done || busy) return;
  status.textContent = !/^[a-f0-9]{64}$/.test(token) ? 'This link is missing or invalid. Request a new link from your profile.' : auth.currentUser ? 'Ready to verify. Continue only if you requested this institutional email connection.' : 'Sign in using your Student ID in the portal tab, then return here to confirm.';
  signIn.hidden = Boolean(auth.currentUser);
}
onAuthStateChanged(auth, sessionState);
window.addEventListener('focus', sessionState);
button.addEventListener('click', async () => {
  if (button.disabled) return;
  busy = true; button.disabled = true; status.textContent = 'Verifying institutional email…';
  try {
    const result = await callStudentEmailService('institutional_verify', { token });
    token = ''; sessionStorage.removeItem(key); done = true;
    status.textContent = result.message;
    button.hidden = true;
    document.getElementById('returnButton').href = result.role === 'officer' ? '../usc-admin/overview/overview.html' : '../dashboard/dashboard.html';
  } catch (error) { status.textContent = error.message || 'Verification failed. Request a new link from your profile.'; }
  finally { busy = false; button.disabled = done || !auth.currentUser || !/^[a-f0-9]{64}$/.test(token); }
});
