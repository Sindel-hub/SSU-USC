import { permissionDefinition } from './officer-permissions.js';
import { hostedManagementCall as call } from './hosted-management-client.js';

const allowed = await (globalThis.USC_AUTH_READY || Promise.resolve(false));
if (allowed !== true) await new Promise(() => {});
let profile = {};
try { profile = JSON.parse(sessionStorage.getItem('studentProfile') || '{}'); } catch {}
const admin = profile.role === 'admin';
const $ = id => document.getElementById(id);
const state = { assignments: [], assignmentNext: null, activities: [], activityNext: null, selected: null, candidate: null, positions: {}, departments: [], record: null, officers: [], officerNext: null };
const date = value => Number.isFinite(value) ? new Date(value).toLocaleString() : 'Not recorded';
function node(tag, text, className) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; }
function status(message, error = false) { $('historyStatus').textContent = message; $('historyStatus').classList.toggle('history-error', error); }
async function run(button, operation) {
  if (button) button.disabled = true;
  try { await operation(); } catch (error) { status(error.message || 'The request could not be completed.', true); }
  finally { if (button) button.disabled = false; }
}
function button(label, operation) { const el = node('button', label); el.type = 'button'; el.addEventListener('click', () => run(el, operation)); return el; }
function renderPermissions() {
  const parent = $('assignmentPermissions');
  parent.replaceChildren(node('legend', 'Approved module permissions'));
  for (const permission of state.positions[$('assignmentPosition').value] || []) {
    const label = node('label', undefined, 'history-check');
    const check = node('input'); check.type = 'checkbox'; check.value = permission; check.checked = true; check.disabled = permission === 'dashboard.view';
    label.append(check, node('span', permissionDefinition(permission)?.label || permission)); parent.append(label);
  }
  const representative = $('assignmentPosition').value === 'USC Representative';
  $('assignmentDepartment').disabled = !representative;
  $('assignmentDepartment').required = representative;
  $('assignmentDepartment').replaceChildren();
  for (const department of representative ? state.departments : ['University-wide']) { const option = node('option', department); option.value = department; $('assignmentDepartment').append(option); }
}
function renderAssignments() {
  const list = $('assignmentList'); list.replaceChildren();
  if (!state.assignments.length) list.append(node('p', 'No authorized officer assignments found. Existing legacy officers must be assigned a position and term before tracked activity begins.'));
  for (const a of state.assignments) {
    const card = node('article', undefined, 'history-term');
    card.append(node('h3', `${a.position} · ${a.administration}`), node('p', `${a.officerName} · ${a.department}`), node('p', `${date(a.startsAtMs)} – ${date(a.endsAtMs)}`));
    const termStatus = a.status === 'completed' ? 'Completed' : a.endsAtMs <= Date.now() ? 'Expired — turnover required' : 'Active';
    card.append(node('strong', termStatus), node('p', `Permissions: ${(a.permissions || []).map(p => permissionDefinition(p)?.label || p).join(', ')}`));
    if (a.authSyncPending) card.append(node('p', 'Authentication synchronization pending. Administrator action required.', 'history-error'));
    card.append(button('View tracklist', () => loadActivities(a)));
    if (admin && a.status !== 'completed') card.append(button('Complete term', async () => {
      const reason = prompt('Enter the approved turnover reason or reference. This removes officer editing access and preserves historical records.');
      if (!reason?.trim()) return;
      if (!confirm(`Complete ${a.officerName}’s ${a.position} assignment?`)) return;
      const result = await call('officerAssignmentManage', { action: 'complete', assignmentId: a.id, reason });
      await loadAssignments(); status(result.authSyncPending ? 'Term completed and profile access removed. Authentication synchronization needs a retry.' : 'Term completed. Historical records are preserved; the outgoing officer must sign in again.');
    }));
    if (admin && a.authSyncPending) card.append(button('Retry authentication sync', async () => {
      const r = await call('officerAssignmentManage', { action: 'sync', assignmentId: a.id });
      await loadAssignments(); status(r.authSyncPending ? 'Synchronization is still pending. Contact the technical maintainer.' : 'Authentication synchronized. The officer must sign in again.');
    }));
    list.append(card);
  }
  $('moreAssignments').hidden = !state.assignmentNext;
  $('financialReportPanel').hidden = !state.assignments.some(a => a.officerUid === profile.uid && a.position === 'Treasurer' && a.status === 'active' && a.endsAtMs > Date.now() && a.permissions.includes('reports.generate'));
}
function renderOfficerDirectory() {
  const rows = $('registeredOfficerRows'); rows.replaceChildren();
  const statusLabels = { approved: 'Approved', suspended: 'Suspended', pending: 'Pending', active: 'Active term', expired: 'Expired term', completed: 'Completed term', scheduled: 'Scheduled term' };
  for (const officer of state.officers) {
    const row = node('tr'); row.dataset.officerUid = officer.uid;
    row.append(node('td', officer.fullName), node('td', officer.studentId || '—'), node('td', officer.position), node('td', officer.department));
    const termCell = node('td');
    if (officer.term) {
      termCell.append(node('strong', officer.term.administration), node('span', `${date(officer.term.startsAtMs)} – ${date(officer.term.endsAtMs)}`, 'history-officer-dates'));
    } else termCell.textContent = 'No term recorded';
    const accessCell = node('td');
    const blocked = officer.accountStatus !== 'approved' || !officer.isActive || officer.studentStanding !== 'active';
    accessCell.append(node('span', statusLabels[officer.accountStatus] || 'Pending', `history-officer-badge${blocked ? ' is-restricted' : ''}`));
    if (officer.studentStanding !== 'active') accessCell.append(node('span', officer.studentStanding.charAt(0).toUpperCase() + officer.studentStanding.slice(1), 'history-officer-dates'));
    else if (!officer.isActive) accessCell.append(node('span', 'Account inactive', 'history-officer-dates'));
    if (officer.term) accessCell.append(node('span', statusLabels[officer.term.status], 'history-officer-dates'));
    if (officer.term?.authSyncPending) accessCell.append(node('span', 'Authentication sync pending', 'history-officer-dates history-error'));
    row.append(termCell, accessCell); rows.append(row);
  }
  if (!state.officers.length) {
    const row = node('tr'), cell = node('td', state.officerNext ? 'No officers in this batch. Load more to continue.' : 'No registered USC officers found.'); cell.colSpan = 6; row.append(cell); rows.append(row);
  }
  $('registeredOfficerCount').textContent = `${state.officers.length} officer${state.officers.length === 1 ? '' : 's'}${state.officerNext ? ' loaded' : ''}`;
  $('moreRegisteredOfficers').hidden = !state.officerNext;
}
let officerDirectoryRequest = 0;
async function loadOfficerDirectory(more = false) {
  if (!admin || !$('registeredOfficersPanel')) return;
  const requestId = ++officerDirectoryRequest;
  const message = $('registeredOfficerStatus'); message.textContent = 'Loading officers…'; message.classList.remove('history-error');
  try {
    const response = await call('officerDirectory', more ? { after: state.officerNext } : {});
    if (requestId !== officerDirectoryRequest) return;
    state.officers = more ? [...new Map([...state.officers, ...response.items].map(officer => [officer.uid, officer])).values()] : response.items;
    state.officerNext = response.next; renderOfficerDirectory(); message.textContent = '';
  } catch (error) {
    if (requestId !== officerDirectoryRequest) return;
    if (!more) { state.officers = []; state.officerNext = null; $('registeredOfficerRows').replaceChildren(); $('registeredOfficerCount').textContent = ''; $('moreRegisteredOfficers').hidden = true; }
    message.textContent = `${error.message || 'Officers could not be loaded.'} Use Refresh to retry.`; message.classList.add('history-error');
  }
}
$('registeredOfficersPanel')?.toggleAttribute('hidden', !admin);
$('moreRegisteredOfficers')?.addEventListener('click', event => run(event.currentTarget, () => loadOfficerDirectory(true)));
async function loadAssignments(more = false) {
  const response = await call('officerAssignments', { scope: admin ? 'all' : $('assignmentScope').value, ...(more ? { after: state.assignmentNext } : {}) });
  state.assignments = more ? [...state.assignments, ...response.items] : response.items;
  state.assignmentNext = response.next; state.positions = response.positions; state.departments = response.departments || [];
  if (!$('assignmentPosition').options.length) {
    for (const position of Object.keys(response.positions)) { const option = node('option', position); option.value = position; $('assignmentPosition').append(option); }
    renderPermissions();
  }
  renderAssignments();
  if (!more) await loadOfficerDirectory();
}
function formatSnapshot(snapshot) {
  if (snapshot.content) return `${snapshot.title || ''}\n\n${snapshot.content}`;
  if (snapshot.description) return `${snapshot.title || ''}\n\n${snapshot.description}\n\n${snapshot.eventDate || ''} ${snapshot.startTime || ''} ${snapshot.venue || ''}`;
  if (snapshot.questions) return `${snapshot.title || ''}\n\n${snapshot.description || ''}\n\n${snapshot.questions.map((q, i) => `${i + 1}. ${q.label}${q.options ? '\n' + q.options.join(' · ') : ''}`).join('\n\n')}`;
  return JSON.stringify(snapshot, null, 2);
}
function renderActivities() {
  const list = $('activityList'); list.replaceChildren();
  if (!state.activities.length) list.append(node('p', 'No recorded activities for this term. Earlier or off-system work is not reconstructed automatically.'));
  for (const activity of [...state.activities].sort((a, b) => b.createdAtMs - a.createdAtMs)) {
    const row = node('article', undefined, 'history-activity');
    row.append(node('h3', activity.action), node('p', `${activity.officerName} · ${activity.position} · ${activity.administration}`), node('p', `${activity.module} · ${activity.status} · ${date(activity.createdAtMs)}`), node('small', `Related record: ${activity.recordId}`));
    row.append(button('View preserved record', async () => {
      const record = await call('officerRecord', { recordId: activity.id }); state.record = record;
      $('recordAttribution').textContent = `${record.officerName} · ${record.position} · ${record.administration} · ${date(record.createdAtMs)}`;
      $('recordContent').textContent = record.snapshot ? formatSnapshot(record.snapshot) : 'This activity preserves metadata only. Confidential complaint content is not copied into the tracklist. Review the original module only if your current permissions allow access.';
      $('recordPreview').hidden = false; $('recordPreview').scrollIntoView({ behavior: 'smooth', block: 'start' }); $('recordContent').focus({ preventScroll: true });
    })); list.append(row);
  }
  $('moreActivities').hidden = !state.activityNext;
}
async function loadActivities(assignment = state.selected, more = false) {
  if (!assignment) return;
  const response = await call('officerTracklist', { assignmentId: assignment.id, ...(more ? { after: state.activityNext } : {}) });
  state.selected = assignment; state.activities = more ? [...state.activities, ...response.items] : response.items; state.activityNext = response.next;
  $('activityHeading').textContent = `${assignment.position} · ${assignment.administration} · ${assignment.officerName}`;
  renderActivities(); status(`Showing ${state.activities.length} loaded activities for the selected term.`);
}
$('appointmentPanel').hidden = !admin; $('officeScopeLabel').hidden = admin || profile.role !== 'officer';
$('backLink').href = admin ? '/usc-admin/admin-dashboard/admin-dashboard.html' : profile.role === 'officer' ? '/usc-admin/overview/overview.html' : '/dashboard/dashboard.html';
$('assignmentPosition').addEventListener('change', renderPermissions);
$('candidateStudentId').addEventListener('input', () => { state.candidate = null; $('candidateSummary').textContent = 'Select an existing account first.'; });
$('findOfficerCandidate').addEventListener('click', event => run(event.currentTarget, async () => {
  state.candidate = await call('officerCandidateFind', { studentId: $('candidateStudentId').value.trim() });
  $('candidateSummary').textContent = `${state.candidate.fullName} · ${state.candidate.studentId}`; status('Student account found. Review the appointment and permissions.');
}));
$('appointmentForm').addEventListener('submit', event => { event.preventDefault(); run(event.submitter, async () => {
  if (!state.candidate) throw new Error('Find and review the student account first.');
  const data = { action: 'assign', assignmentId: crypto.randomUUID(), officerUid: state.candidate.uid, position: $('assignmentPosition').value, department: $('assignmentDepartment').value.trim(), administration: $('administrationPeriod').value.trim(), authorization: $('appointmentAuthorization').value.trim(), startsAtMs: new Date($('termStart').value).getTime(), endsAtMs: new Date($('termEnd').value).getTime(), permissions: [...$('assignmentPermissions').querySelectorAll('input:checked')].map(input => input.value) };
  const r = await call('officerAssignmentManage', data); $('appointmentConfirmed').checked = false;
  await loadAssignments(); status(r.authSyncPending ? 'Assignment saved. Authentication synchronization is pending; retry before officer sign-in.' : 'Assignment created. Ask the officer to sign out and sign in again.');
}); });
$('financialReportForm').addEventListener('submit', event => { event.preventDefault(); run(event.submitter, async () => {
  await call('officerReportSubmit', { title: $('financialReportTitle').value, content: $('financialReportContent').value, operationId: crypto.randomUUID() });
  $('financialReportForm').reset(); status('Financial report submitted and preserved under your current assignment.');
  if (state.selected) await loadActivities();
}); });
$('assignmentScope').addEventListener('change', () => run(null, () => loadAssignments()));
$('refreshHistory').addEventListener('click', event => run(event.currentTarget, async () => { await loadAssignments(); if (state.selected) await loadActivities(); status('Authorized records refreshed.'); }));
$('moreAssignments').addEventListener('click', event => run(event.currentTarget, () => loadAssignments(true)));
$('moreActivities').addEventListener('click', event => run(event.currentTarget, () => loadActivities(state.selected, true)));
$('closeRecord').addEventListener('click', () => { $('recordPreview').hidden = true; });
$('downloadRecord').addEventListener('click', () => {
  if (!state.record) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(state.record, null, 2)], { type: 'application/json' }));
  const link = node('a'); link.href = url; link.download = `usc-officer-record-${state.record.id}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
await run(null, async () => { await loadAssignments(); status('Authorized assignments loaded. Select a term to review its tracklist.'); });

if (admin) {
  const studentId = new URLSearchParams(location.search).get('studentId');
  if (studentId && /^[0-9]{1,64}$/.test(studentId)) {
    $('candidateStudentId').value = studentId;
    $('findOfficerCandidate').click();
  }
}
