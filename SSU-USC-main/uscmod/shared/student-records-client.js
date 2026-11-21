import { hostedManagementCall } from './hosted-management-client.js';
export async function studentRecordCall(name, data = {}) {
  try { return await hostedManagementCall(name, data); }
  catch(error) {
    if (/not-found|unavailable|internal|unknown/.test(error.code||'') && !/record not found|delivery|Import not found/i.test(error.message||'')) throw new Error('The student records service is unavailable. Please try again later.');
    throw new Error(error.message||'Student record request failed.');
  }
}
