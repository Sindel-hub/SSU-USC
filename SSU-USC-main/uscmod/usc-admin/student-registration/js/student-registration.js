import { studentRecordCall as call } from '../../../shared/student-records-client.js';
import { formatSsuCollege, formatSsuProgram } from './ssu-programs.js';

if (await globalThis.USC_AUTH_READY !== true) await new Promise(() => {});
const $ = id => document.getElementById(id);
const input = $('studentId'), form = $('studentForm'), button = $('createBtn'), verify = $('verifyStudent');
const handoff = $('activationHandoff'), link = $('studentActivationLink');
let lookup = null, busy = false, revision = 0;

function message(text) { $('registrationStatus').textContent = text; }
function clear() {
  lookup = null;
  form.hidden = true;
  handoff.hidden = true;
  link.value = '';
  verify.checked = false;
  button.disabled = true;
}
function canIssue(result) {
  return result && (result.canReissue || (!result.account && result.record?.studentStanding === 'active' && result.recordRevision));
}
function render(result) {
  lookup = result;
  const student = result.record || result.account;
  form.hidden = !student;
  if (!student) { message('No masterlist record found. Verify the Student ID or import the SCL first.'); return; }
  $('name').value = student.fullName || '';
  $('college').value = formatSsuCollege(student.college) || '';
  $('program').value = formatSsuProgram(student.college, student.program) || '';
  $('yearLevel').value = student.yearLevel || '';
  $('email').value = student.institutionalEmail || '';
  $('registrationAccount').value = result.account?.accountState || 'No account';
  const allowed = canIssue(result);
  $('verifyStudentLabel').hidden = !allowed;
  button.hidden = !allowed;
  button.disabled = !allowed || !verify.checked;
  button.textContent = result.canReissue ? 'Replace activation link' : 'Create student account';
  message(result.account ? `Existing account: ${result.account.fullName} · ${result.account.accountState}.` : allowed ? '' : 'Only an eligible masterlist record can be issued an account.');
}

input.oninput = () => { revision++; clear(); message(''); };
$('studentLookup').onsubmit = async event => {
  event.preventDefault();
  if (busy) return;
  clear();
  const request = ++revision;
  message('Looking up Student ID…');
  try {
    const result = await call('studentRegistrationLookup', { studentId: input.value.trim() });
    if (request === revision) render(result);
  } catch (error) { if (request === revision) message(error.message); }
};

verify.onchange = () => { button.disabled = busy || !canIssue(lookup) || !verify.checked; };
form.onsubmit = async event => {
  event.preventDefault();
  if (busy || !canIssue(lookup) || !verify.checked) return;
  const studentId = input.value.trim(), { recordRevision, canReissue } = lookup;
  busy = true;
  input.disabled = true;
  button.disabled = true;
  try {
    const result = await call('studentRegistrationIssue', {
      studentId, recordRevision, verifiedInPerson: true, reissue: canReissue
    });
    clear();
    const url = new URL('../../activate/index.html', location.href);
    url.hash = 'token=' + result.token;
    link.value = url.href;
    handoff.hidden = false;
    message(canReissue ? 'Replacement activation link ready.' : 'Account issued. The student can set their own password.');
    link.focus();
    link.select();
  } catch (error) {
    message(error.message);
    button.disabled = false;
  } finally {
    busy = false;
    input.disabled = false;
  }
};
$('copyActivationLink').onclick = async () => {
  try { await navigator.clipboard.writeText(link.value); message('Activation link copied.'); }
  catch { link.focus(); link.select(); message('Copy the selected link.'); }
};
$('clearActivationLink').onclick = () => { clear(); message(''); input.focus(); };
