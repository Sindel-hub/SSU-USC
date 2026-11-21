import { functions } from '../firebase/firebase-config.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/12.12.0/firebase-functions.js';
export async function surveyCall(action, data = {}) {
  try { return (await httpsCallable(functions, `needsAssessment${action}`)(data)).data; }
  catch (error) {
    if (/not-found|unavailable|internal|unknown/.test(error.code || '') && !error.message?.includes('Survey')) {
      throw new Error('The survey service is unavailable. Please try again later.');
    }
    throw new Error(error.message || 'Unable to complete the survey request.');
  }
}
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const surveyLink = id => new URL(`/survey/index.html?id=${encodeURIComponent(id)}`, location.origin).href;
