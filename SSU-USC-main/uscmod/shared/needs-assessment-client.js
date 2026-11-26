import { hostedManagementCall } from './hosted-management-client.js';
export async function surveyCall(action, data = {}) {
  try { return await hostedManagementCall(`needsAssessment${action}`, data); }
  catch (error) {
    const unavailable = /not-found|internal|unknown/.test(error.code || '') && !error.message?.includes('Survey');
    const message = unavailable ? 'Unable to load the survey service. Please try again or contact the administrator.' : error.message || 'Unable to complete the survey request.';
    const requestId = typeof error.requestId === 'string' && /^[a-f0-9-]{36}$/i.test(error.requestId) ? error.requestId : '';
    throw Object.assign(new Error(message + (requestId ? ` Reference: ${requestId}` : '')), {code:error.code, ...(requestId ? {requestId} : {})});
  }
}
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const surveyLink = id => new URL(`/survey/index.html?id=${encodeURIComponent(id)}`, globalThis.USC_PUBLIC_ORIGIN || location.origin).href;
