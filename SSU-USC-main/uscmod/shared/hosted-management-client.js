import { auth, appCheck, functions } from '../firebase/firebase-config.js';
const PUBLIC_ACTIONS = new Set(['studentActivateAccount']);
export async function hostedManagementCall(action, data = {}) {
  // Explicit opt-in retains the existing emulator/Cloud Functions workflow.
  if (globalThis.USC_MANAGEMENT_TRANSPORT === 'firebase') {
    const { httpsCallable } = await import('https://www.gstatic.com/firebasejs/12.12.0/firebase-functions.js');
    return (await httpsCallable(functions, action, { timeout: 600000 })(data)).data;
  }
  const headers = { 'Content-Type': 'application/json' };
  if (!PUBLIC_ACTIONS.has(action)) {
    if (!auth.currentUser) throw new Error('Your session has ended. Please sign in again.');
    headers.Authorization = `Bearer ${await auth.currentUser.getIdToken()}`;
  }
  if (appCheck) {
    const { getToken } = await import('https://www.gstatic.com/firebasejs/12.12.0/firebase-app-check.js');
    headers['X-Firebase-AppCheck'] = (await getToken(appCheck)).token;
  }
  let response;
  try {
    response = await fetch('/api/management', {
      method: 'POST', headers, body: JSON.stringify({ action, data }),
      credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(310000)
    });
  } catch { throw new Error('The hosted service could not be reached. Please try again.'); }
  const result = await response.json().catch(() => null);
  if (!response.ok || !result || !Object.hasOwn(result, 'data')) {
    const error = new Error(result?.error?.message || 'The hosted service is unavailable. Please try again later.');
    error.code = result?.error?.code || 'unavailable';
    throw error;
  }
  return result.data;
}
