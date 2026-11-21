import { functions } from '../firebase/firebase-config.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/12.12.0/firebase-functions.js';
export async function studentRecordCall(name, data = {}) {
  try { return (await httpsCallable(functions,name,{timeout:600000})(data)).data; }
  catch(error) {
    if (/not-found|unavailable|internal|unknown/.test(error.code||'') && !/record not found|delivery|Import not found/i.test(error.message||'')) throw new Error('The student records service is unavailable. Please try again later.');
    throw new Error(error.message||'Student record request failed.');
  }
}
