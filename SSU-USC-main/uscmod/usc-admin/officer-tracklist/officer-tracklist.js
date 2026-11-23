import { permissionDefinition } from '../../shared/officer-permissions.js';
import { hostedManagementCall as call } from '../../shared/hosted-management-client.js';

const allowed = await (globalThis.USC_AUTH_READY || Promise.resolve(false));
if (allowed !== true) await new Promise(() => {});
let profile = {};
try { profile = JSON.parse(sessionStorage.getItem('studentProfile') || '{}'); } catch {}
const admin = profile.role === 'admin';
const $ = id => document.getElementById(id);
const state = { assignments: [], assignmentNext: null, activities: [], activityNext: null, selected: null, candidate: null, positions: {}, departments: [], record: null };
let assignmentRequest = 0, activityRequest = 0, recordRequest = 0;
const date = value => Number.isFinite(value) ? new Date(value).toLocaleString() : 'Not recorded';
function node(tag, text, className) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; }
function emptyState(title, description, icon = 'fa-folder-open') {
  const box = node('div', undefined, 'history-empty');
  const mark = node('span', undefined, 'history-empty-icon');
  mark.setAttribute('aria-hidden', 'true');
  mark.innerHTML = icon === 'fa-calendar' ? '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18m-13 5 2 2 4-4"/></svg>' : '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8V6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v1M3 8h18l-3 10H3L1 8z"/></svg>';
  const copy = node('div'); copy.append(node('h3', title), node('p', description));
  box.append(mark, copy); return box;
}
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
  if (!state.assignments.length) list.append(emptyState('No assignments yet', 'No authorized officer assignments found. An administrator must record your position and term before tracked activity begins.'));
  for (const a of state.assignments) {
    const card = node('article', undefined, 'history-term');
    card.append(node('h3', `${a.position} · ${a.administration}`), node('p', `${a.officerName} · ${a.department}`), node('p', `${date(a.startsAtMs)} – ${date(a.endsAtMs)}`));
    const termStatus = a.status === 'completed' ? 'Completed' : a.endsAtMs <= Date.now() ? 'Expired — turnover required' : a.startsAtMs > Date.now() ? 'Scheduled' : 'Active';
    card.append(node('strong', termStatus, 'history-term-status' + (termStatus === 'Active' ? ' is-active' : '')), node('p', `Permissions: ${(a.permissions || []).map(p => permissionDefinition(p)?.label || p).join(', ')}`));
    if (a.authSyncPending) card.append(node('p', 'Authentication synchronization pending. Administrator action required.', 'history-error'));
    const viewButton = button('View tracklist', () => loadActivities(a));
    viewButton.setAttribute('aria-pressed', String(state.selected?.id === a.id));
    card.append(viewButton);
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
  $('financialReportPanel').hidden = !state.assignments.some(a => a.officerUid === profile.uid && a.position === 'Treasurer' && a.status === 'active' && a.startsAtMs <= Date.now() && a.endsAtMs > Date.now() && a.permissions.includes('reports.generate'));
}
function clearRecord() {
  recordRequest++;
  state.record = null;
  $('recordPreview').hidden = true;
  $('recordContent').textContent = '';
  $('recordAttribution').textContent = '';
}
function clearActivities() {
  activityRequest++;
  state.selected = null; state.activities = []; state.activityNext = null;
  clearRecord();
  $('activityHeading').textContent = 'Recorded activities';
  $('activityList').replaceChildren(emptyState('Select a term to get started', 'Choose a term above to view its recorded activities.', 'fa-calendar'));
  $('moreActivities').hidden = true;
}
async function loadAssignments(more = false) {
  const request = ++assignmentRequest;
  if (!more) {
    clearActivities(); state.assignments = []; state.assignmentNext = null;
    $('assignmentList').replaceChildren(node('p', 'Loading authorized assignments…'));
    $('moreAssignments').hidden = true; $('financialReportPanel').hidden = true;
  }
  let response;
  try {
    response = await call('officerAssignments', { scope: admin ? 'all' : $('assignmentScope').value, ...(more ? { after: state.assignmentNext } : {}) });
  } catch (error) {
    if (request !== assignmentRequest) return;
    if (!more) $('assignmentList').replaceChildren(node('p', 'Assignments could not be loaded. Use Refresh to try again.'));
    throw error;
  }
  if (request !== assignmentRequest) return;
  state.assignments = more ? [...state.assignments, ...response.items] : response.items;
  state.assignmentNext = response.next; state.positions = response.positions; state.departments = response.departments || [];
  if (!$('assignmentPosition').options.length) {
    for (const position of Object.keys(response.positions)) { const option = node('option', position); option.value = position; $('assignmentPosition').append(option); }
    renderPermissions();
  }
  renderAssignments();
  status(state.assignments.length ? 'Assignments loaded. Select a term to view activities.' : '');
}
function formatSnapshot(snapshot) {
  if (snapshot.content) return `${snapshot.title || ''}\n\n${snapshot.content}`;
  if (snapshot.questions) return `${snapshot.title || ''}\n\n${snapshot.description || ''}\n\n${snapshot.questions.map((q, i) => `${i + 1}. ${q.label}${q.options ? '\n' + q.options.join(' · ') : ''}`).join('\n\n')}`;
  if (snapshot.description) return `${snapshot.title || ''}\n\n${snapshot.description}\n\n${snapshot.eventDate || ''} ${snapshot.startTime || ''} ${snapshot.venue || ''}`;
  return JSON.stringify(snapshot, null, 2);
}
function renderActivities() {
  const list = $('activityList'); list.replaceChildren();
  if (!state.activities.length) list.append(emptyState('No activities recorded', 'No recorded activities for this term. Completed work will appear here as it is recorded.'));
  for (const activity of [...state.activities].sort((a, b) => b.createdAtMs - a.createdAtMs)) {
    const row = node('article', undefined, 'history-activity');
    row.append(node('h3', activity.action), node('p', `${activity.officerName} · ${activity.position} · ${activity.administration}`), node('p', `${activity.module} · ${activity.status} · ${date(activity.createdAtMs)}`), node('small', `Related record: ${activity.recordId}`));
    row.append(button('View preserved record', async () => {
      const request = ++recordRequest;
      const record = await call('officerRecord', { recordId: activity.id });
      if (request !== recordRequest) return;
      state.record = record;
      $('recordAttribution').textContent = `${record.officerName} · ${record.position} · ${record.administration} · ${date(record.createdAtMs)}`;
      $('recordContent').textContent = record.snapshot ? formatSnapshot(record.snapshot) : 'This activity preserves metadata only. Confidential complaint content is not copied into the tracklist. Review the original module only if your current permissions allow access.';
      $('recordPreview').hidden = false; $('recordPreview').scrollIntoView({ behavior: 'smooth', block: 'start' }); $('recordContent').focus({ preventScroll: true });
    })); list.append(row);
  }
  $('moreActivities').hidden = !state.activityNext;
}
async function loadActivities(assignment = state.selected, more = false) {
  if (!assignment) return;
  const request = ++activityRequest;
  if (!more) {
    state.selected = assignment; state.activities = []; state.activityNext = null;
    clearRecord(); renderAssignments();
    $('activityList').replaceChildren(node('p', 'Loading recorded activities…'));
    $('moreActivities').hidden = true;
  }
  $('activityHeading').textContent = `${assignment.position} · ${assignment.administration} · ${assignment.officerName}`;
  let response;
  try {
    response = await call('officerTracklist', { assignmentId: assignment.id, ...(more ? { after: state.activityNext } : {}) });
  } catch (error) {
    if (request !== activityRequest) return;
    if (!more) $('activityList').replaceChildren(node('p', 'Activities could not be loaded. Select the term again or use Refresh to retry.'));
    throw error;
  }
  if (request !== activityRequest) return;
  state.activities = more ? [...state.activities, ...response.items] : response.items; state.activityNext = response.next;
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
  $('financialReportForm').reset();
  if (state.selected) await loadActivities();
  status('Financial report submitted and preserved under your current assignment.');
}); });
$('assignmentScope').addEventListener('change', () => run(null, () => loadAssignments()));
$('refreshHistory').addEventListener('click', event => run(event.currentTarget, async () => { const selectedId = state.selected?.id; await loadAssignments(); const selected = state.assignments.find(a => a.id === selectedId); if (selected) await loadActivities(selected); status('Authorized records refreshed.'); }));
$('moreAssignments').addEventListener('click', event => run(event.currentTarget, () => loadAssignments(true)));
$('moreActivities').addEventListener('click', event => run(event.currentTarget, () => loadActivities(state.selected, true)));
$('closeRecord').addEventListener('click', () => { clearRecord(); });
$('downloadRecord').addEventListener('click', () => {
  if (!state.record) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(state.record, null, 2)], { type: 'application/json' }));
  const link = node('a'); link.href = url; link.download = `usc-officer-record-${state.record.id}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
await run(null, () => loadAssignments());

document.querySelector('a[href="#responsibilities"]')?.addEventListener('click', () => { $('responsibilities').open = true; });
