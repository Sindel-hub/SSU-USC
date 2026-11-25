import { studentRecordCall } from "../../../shared/student-records-client.js";
import { bindDirectoryTable } from "./user-directory-table.js?v=2";
import { callStudentEmailService } from "../../../shared/supabase-email-service.js";
import { institutionalEmailForDisplay } from "../../../shared/account-email.js";
import { callSecure, auth } from "../../../shared/security-client.js?v=admin-account-only-1";
import { OFFICER_PERMISSION_DEFINITIONS, DEFAULT_OFFICER_PERMISSIONS, normalizeOfficerPermissions } from "../../../shared/officer-permissions.js?v=programs-1";

import {
  complaintSummaryFor,
  escapeHtml,
  formatDateOnly,
  formatDateTime,
  getCurrentAdminProfile,
  getFilteredUsers,
  getInitials,
  isProtectedAdmin,
  renderAdminIdentity,
  roleClass,
  routeLabel,
  setActiveAdminNav,
  statusClass,
  subscribeComplaints,
  subscribeUsers,
  summarizeComplaintStates,
  updateSingleUser,
} from "./admin-core.js?v=admin-account-only-1";


const uscAuthAllowed = await (globalThis.USC_AUTH_READY || Promise.resolve(false));
if (uscAuthAllowed !== true) await new Promise(() => {});


const dom = {
  userSearchInput: document.getElementById("userSearchInput"),
  roleFilterSelect: document.getElementById("roleFilterSelect"),
  statusFilterSelect: document.getElementById("statusFilterSelect"),
  verifiedFilterSelect: document.getElementById("verifiedFilterSelect"),
  activeFilterSelect: document.getElementById("activeFilterSelect"),
  recentFilterSelect: document.getElementById("recentFilterSelect"),
  sortSelect: document.getElementById("sortSelect"),
  directoryCountBadge: document.getElementById("directoryCountBadge"),
  listStatusText: document.getElementById("listStatusText"),
  usersTableBody: document.getElementById("usersTableBody"),
  userEditorModal: document.getElementById("userEditorModal"),
  userEditorModalBackdrop: document.getElementById("userEditorModalBackdrop"),
  userEditorModalClose: document.getElementById("userEditorModalClose"),
  editorEmptyState: document.getElementById("editorEmptyState"),
  editorPanel: document.getElementById("editorPanel"),
  rolePreviewBadge: document.getElementById("rolePreviewBadge"),
  selectedUserRestrictionBanner: document.getElementById("selectedUserRestrictionBanner"),
  selectedUserInitials: document.getElementById("selectedUserInitials"),
  selectedUserName: document.getElementById("selectedUserName"),
  selectedUserEmail: document.getElementById("selectedUserEmail"),
  selectedUserId: document.getElementById("selectedUserId"),
  selectedUserRole: document.getElementById("selectedUserRole"),
  selectedUserStatus: document.getElementById("selectedUserStatus"),
  selectedUserRoute: document.getElementById("selectedUserRoute"),
  selectedUserOfficePosition: document.getElementById("selectedUserOfficePosition"),
  selectedUserPermissionSummary: document.getElementById("selectedUserPermissionSummary"),
  selectedUserRegisteredAt: document.getElementById("selectedUserRegisteredAt"),
  selectedUserLastLogin: document.getElementById("selectedUserLastLogin"),
  selectedUserLastActivity: document.getElementById("selectedUserLastActivity"),
  selectedUserEffectiveDate: document.getElementById("selectedUserEffectiveDate"),
  selectedUserYearLevel: document.getElementById("selectedUserYearLevel"),
  selectedUserStanding: document.getElementById("selectedUserStanding"),
  selectedUserVerified: document.getElementById("selectedUserVerified"),
  selectedUserActive: document.getElementById("selectedUserActive"),
  selectedUserComplaintCount: document.getElementById("selectedUserComplaintCount"),
  selectedUserComplaintStatus: document.getElementById("selectedUserComplaintStatus"),
  selectedUserLastUpdate: document.getElementById("selectedUserLastUpdate"),
  roleEditorForm: document.getElementById("roleEditorForm"),
  targetRoleSelect: document.getElementById("targetRoleSelect"),
  officePositionInput: document.getElementById("officePositionInput"),
  accountStatusSelect: document.getElementById("accountStatusSelect"),
  effectiveDateInput: document.getElementById("effectiveDateInput"),
  yearLevelSelect: document.getElementById("yearLevelSelect"),
  studentStandingSelect: document.getElementById("studentStandingSelect"),
  standingAccessNote: document.getElementById("standingAccessNote"),
  verifiedToggle: document.getElementById("verifiedToggle"),
  activeToggle: document.getElementById("activeToggle"),
  officerRbacEditor: document.getElementById("officerRbacEditor"),
  officerPermissionGrid: document.getElementById("officerPermissionGrid"),
  officerPermissionCount: document.getElementById("officerPermissionCount"),
  adminNotesInput: document.getElementById("adminNotesInput"),
  roleChangeNote: document.getElementById("roleChangeNote"),
  roleRoutePreview: document.getElementById("roleRoutePreview"),
  saveRoleButton: document.getElementById("saveRoleButton"),
  approveUserButton: document.getElementById("approveUserButton"),
  removeUserButton: document.getElementById("removeUserButton"),
  suspendUserButton: document.getElementById("suspendUserButton"),
  reactivateUserButton: document.getElementById("reactivateUserButton"),
  demoteToStudentButton: document.getElementById("demoteToStudentButton"),
  resetUserPasswordButton: document.getElementById("resetUserPasswordButton"),
  passwordResetResultModal: document.getElementById("passwordResetResultModal"),
  passwordResetResultBackdrop: document.getElementById("passwordResetResultBackdrop"),
  passwordResetResultClose: document.getElementById("passwordResetResultClose"),
  passwordResetResultName: document.getElementById("passwordResetResultName"),
  passwordResetResultStudentId: document.getElementById("passwordResetResultStudentId"),
  passwordResetResultEmail: document.getElementById("passwordResetResultEmail"),
  passwordResetResultPassword: document.getElementById("passwordResetResultPassword"),
  copyTemporaryPasswordButton: document.getElementById("copyTemporaryPasswordButton"),
  printTemporaryPasswordButton: document.getElementById("printTemporaryPasswordButton"),
  doneTemporaryPasswordButton: document.getElementById("doneTemporaryPasswordButton"),
  saveFeedbackText: document.getElementById("saveFeedbackText"),
  lastActionSummary: document.getElementById("lastActionSummary"),
  provisionStudentId: document.getElementById("provisionStudentId"),
  provisionInstitutionalEmail: document.getElementById("provisionInstitutionalEmail"),
  provisionFullName: document.getElementById("provisionFullName"),
  provisionProgram: document.getElementById("provisionProgram"),
  provisionCollege: document.getElementById("provisionCollege"),
  provisionEnrollmentStatus: document.getElementById("provisionEnrollmentStatus"),
  provisionVoterEligible: document.getElementById("provisionVoterEligible"),
  provisionSchoolAccountButton: document.getElementById("provisionSchoolAccountButton"),
  provisionCredentialResult: document.getElementById("provisionCredentialResult")
};

let users = [];
let complaintSummaryByUid = new Map();
let selectedUserId = "";
let isSaving = false;

function buildPermissionEditor() {
  if (!dom.officerPermissionGrid) return;
  const groups = new Map();
  OFFICER_PERMISSION_DEFINITIONS.filter(definition => !definition.key.startsWith("elections.")).forEach((definition) => {
    if (!groups.has(definition.group)) groups.set(definition.group, []);
    groups.get(definition.group).push(definition);
  });
  dom.officerPermissionGrid.innerHTML = [...groups.entries()].map(([group, definitions]) => `
    <section class="officer-rbac-group">
      <h4>${escapeHtml(group)}</h4>
      ${definitions.map((definition) => `
        <label class="officer-rbac-option">
          <input type="checkbox" data-officer-permission="${escapeHtml(definition.key)}" ${definition.key === "dashboard.view" ? "disabled" : ""}>
          <span><strong>${escapeHtml(definition.label)}</strong><small>${escapeHtml(definition.description)}</small></span>
        </label>`).join("")}
    </section>`).join("");
  dom.officerPermissionGrid.querySelectorAll('[data-officer-permission]').forEach((input) => input.addEventListener('change', updatePermissionCount));
}

function selectedOfficerPermissions() {
  if (!dom.officerPermissionGrid) return [...DEFAULT_OFFICER_PERMISSIONS];
  const values = [...dom.officerPermissionGrid.querySelectorAll('[data-officer-permission]:checked')].map((input) => input.dataset.officerPermission);
  return normalizeOfficerPermissions(values, { legacyFullAccess: false });
}

function setOfficerPermissions(values = DEFAULT_OFFICER_PERMISSIONS) {
  const normalized = new Set(normalizeOfficerPermissions(values, { legacyFullAccess: false }));
  normalized.add('dashboard.view');
  dom.officerPermissionGrid?.querySelectorAll('[data-officer-permission]').forEach((input) => {
    input.checked = normalized.has(input.dataset.officerPermission);
  });
  updatePermissionCount();
}

function updatePermissionCount() {
  if (!dom.officerPermissionCount) return;
  const count = selectedOfficerPermissions().length;
  dom.officerPermissionCount.textContent = `${count} permission${count === 1 ? '' : 's'}`;
}

function syncRbacEditorForRole(role, user = null) {
  const officer = role === 'officer';
  if (dom.officerRbacEditor) dom.officerRbacEditor.hidden = !officer;
  if (!officer) return;
  setOfficerPermissions(user?.officerPermissions || DEFAULT_OFFICER_PERMISSIONS);
}

function getFilters() {
  return {
    queryText: dom.userSearchInput?.value || "",
    role: "all",
    status: "all",
    verified: "all",
    active: "all",
    recent: "all",
    sort: dom.sortSelect?.value || "name"
  };
}

function getFilteredDirectory() {
  return getFilteredUsers(users, getFilters());
}

function setFeedback(message, tone = "neutral") {
  dom.lastActionSummary.textContent = message;
  dom.saveFeedbackText.textContent = tone === "success"
    ? "Account updated."
    : tone === "error"
      ? "Update failed."
      : "Ready for admin updates.";
}



function updateRolePreview(role) {
  const normalized = role === "officer" ? "officer" : "student";
  dom.rolePreviewBadge.textContent = normalized === "officer" ? "Officer access" : "Student access";
  dom.rolePreviewBadge.className = `quick-badge ${normalized === 'officer' ? 'role-officer' : 'role-student'}`;
  dom.roleRoutePreview.textContent = `Route after next login: ${routeLabel(normalized)}`;
}

function getSelectedUser() {
  return users.find((user) => user.uid === selectedUserId) || null;
}

function renderTable() {
  const visibleUsers = getFilteredDirectory();
  dom.directoryCountBadge.textContent = `${visibleUsers.length} account${visibleUsers.length === 1 ? '' : 's'}`;
  if (!visibleUsers.length) {
    dom.usersTableBody.innerHTML = '<tr><td colspan="9"><div class="empty-state"><strong>No matching accounts</strong><span>Adjust the current filters and search terms.</span></div></td></tr>';
    directoryTable.refresh();
    return;
  }

  dom.usersTableBody.innerHTML = visibleUsers.map((user) => {
    const complaintSummary = complaintSummaryFor(user, complaintSummaryByUid);
    return `
      <tr class="directory-row ${selectedUserId === user.uid ? 'is-open' : ''}" data-account-row="${escapeHtml(user.uid)}">
        <td><div class="directory-user-cell"><span class="directory-user-avatar" aria-hidden="true">${escapeHtml(getInitials(user.fullName, user.email))}</span><div class="table-name"><button type="button" class="directory-name-button" data-account-name="${escapeHtml(user.uid)}" aria-haspopup="dialog" aria-label="View account for ${escapeHtml(user.fullName || 'Unnamed user')}"><strong>${escapeHtml(user.fullName || 'Unnamed user')}</strong></button><small>${escapeHtml(user.email || 'Not Linked')}</small></div></div></td>
        <td class="mono">${escapeHtml(user.studentId || 'N/A')}</td>
        <td><span class="role-badge ${roleClass(user.role)}">${escapeHtml(user.role)}</span></td>
        <td><span class="status-badge ${statusClass(user.accountStatus)}">${escapeHtml(user.accountStatus)}</span></td>
        <td><span class="verify-badge ${user.isVerifiedStudent ? 'verify-yes' : 'verify-no'}">${user.isVerifiedStudent ? 'Verified' : 'Unverified'}</span></td>
        <td><span class="active-badge ${user.isActive ? 'active-yes' : 'active-no'}">${user.isActive ? 'Active' : 'Inactive'}</span></td>
        <td>${escapeHtml(user.officePosition || '—')}</td>
        <td>${escapeHtml(formatDateTime(user.lastLoginAtMs))}</td>
        <td><div class="table-actions"><button type="button" class="open-btn ${selectedUserId === user.uid ? 'selected' : ''}" aria-haspopup="dialog" aria-label="Open account for ${escapeHtml(user.fullName || 'Unnamed user')}" data-open-user="${escapeHtml(user.uid)}">Open</button><span class="mono">${complaintSummary.total} complaints</span></div></td>
      </tr>
    `;
  }).join("");

  dom.usersTableBody.querySelectorAll('[data-open-user]').forEach((button) => {
    button.addEventListener('click', () => openUser(button.getAttribute('data-open-user') || ''));
  });

  directoryTable.refresh();
}

function openUserEditorModal() {
  if (!dom.userEditorModal) return;
  dom.userEditorModal.classList.remove('hidden');
  dom.userEditorModal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('user-editor-modal-open');
  requestAnimationFrame(() => dom.userEditorModalClose?.focus({ preventScroll: true }));
}

function closeUserEditorModal() {
  if (!dom.userEditorModal || isSaving) return;
  dom.userEditorModal.classList.add('hidden');
  dom.userEditorModal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('user-editor-modal-open');
  [...dom.usersTableBody.querySelectorAll('[data-account-name]')].find(button => button.dataset.accountName === selectedUserId)?.focus({ preventScroll: true });
}

function toggleEditor(hasSelection) {
  dom.editorEmptyState.classList.toggle('hidden', hasSelection);
  dom.editorPanel.classList.toggle('hidden', !hasSelection);
}

function fillEditor(user) {
  if (!user) {
    toggleEditor(false);
    dom.rolePreviewBadge.textContent = 'No user selected';
    dom.rolePreviewBadge.className = 'quick-badge';
    return;
  }
  toggleEditor(true);
  const complaintSummary = complaintSummaryFor(user, complaintSummaryByUid);
  const protectedAdmin = isProtectedAdmin(user);
  dom.selectedUserRestrictionBanner.classList.toggle('hidden', !protectedAdmin);
  dom.selectedUserInitials.textContent = getInitials(user.fullName, user.email);
  dom.selectedUserName.textContent = user.fullName || 'Unnamed user';
  dom.selectedUserEmail.textContent = user.email || 'Not Linked';
  dom.selectedUserId.textContent = `Student ID: ${user.studentId || 'N/A'}`;
  dom.selectedUserRole.textContent = `Role: ${user.role}`;
  dom.selectedUserRole.className = `role-badge ${roleClass(user.role)}`;
  dom.selectedUserStatus.textContent = `Status: ${user.accountStatus}`;
  dom.selectedUserStatus.className = `status-badge ${statusClass(user.accountStatus)}`;
  dom.selectedUserRoute.textContent = routeLabel(user.role);
  dom.selectedUserOfficePosition.textContent = user.officePosition || '—';
  if (dom.selectedUserPermissionSummary) {
    const count = user.role === 'officer' ? normalizeOfficerPermissions(user.officerPermissions, { legacyFullAccess: user.officerPermissionsConfigured !== true }).filter(permission => !permission.startsWith('elections.')).length : 0;
    dom.selectedUserPermissionSummary.textContent = user.role === 'officer' ? `${count} granted permission${count === 1 ? '' : 's'}` : 'Not applicable';
  }
  dom.selectedUserRegisteredAt.textContent = formatDateTime(user.createdAtMs);
  dom.selectedUserLastLogin.textContent = formatDateTime(user.lastLoginAtMs);
  dom.selectedUserLastActivity.textContent = formatDateTime(user.lastActivityAtMs);
  dom.selectedUserEffectiveDate.textContent = formatDateOnly(user.roleEffectiveDate);
  dom.selectedUserStanding.textContent = user.studentStandingLabel || user.studentStanding || 'Active / Enrolled';
  dom.selectedUserVerified.textContent = user.isVerifiedStudent ? 'Verified' : 'Unverified';
  dom.selectedUserActive.textContent = user.isActive ? 'Active' : 'Inactive';
  dom.selectedUserComplaintCount.textContent = `${complaintSummary.total} total`;
  dom.selectedUserComplaintStatus.textContent = summarizeComplaintStates(complaintSummary);
  dom.selectedUserLastUpdate.textContent = user.updatedAtMs ? `${formatDateTime(user.updatedAtMs)}${user.lastRoleUpdatedBy ? ` • by ${user.lastRoleUpdatedBy}` : ''}` : '—';
  dom.roleEditorForm.querySelectorAll('button, input, select, textarea').forEach(control => { control.disabled = false; });
  dom.targetRoleSelect.value = protectedAdmin ? 'student' : user.role;
  dom.officePositionInput.value = user.officePosition || '';
  syncRbacEditorForRole(user.role, user);
  dom.accountStatusSelect.value = user.accountStatus;
  dom.effectiveDateInput.value = user.roleEffectiveDate || '';
  dom.studentStandingSelect.value = user.studentStanding || 'active';
  dom.verifiedToggle.checked = user.isVerifiedStudent;
  dom.activeToggle.checked = user.isActive;
  const inactiveStanding = (user.studentStanding || 'active') !== 'active';
  dom.activeToggle.disabled = protectedAdmin || inactiveStanding;
  dom.reactivateUserButton.title = inactiveStanding ? 'Set Student Standing to Active / Enrolled and save before reactivating access.' : '';
  dom.adminNotesInput.value = user.adminNotes || '';
  dom.roleChangeNote.value = '';
  const termNotice = document.getElementById('officerTermNotice');
  if (termNotice) termNotice.hidden = false;
  dom.officerPermissionGrid?.querySelectorAll('input').forEach(input => { input.disabled = true; });
  dom.targetRoleSelect.disabled = true;
  dom.effectiveDateInput.disabled = true;
  dom.officePositionInput.disabled = true;
  dom.approveUserButton.disabled = protectedAdmin;
  dom.suspendUserButton.disabled = protectedAdmin;
  dom.reactivateUserButton.disabled = protectedAdmin || inactiveStanding;
  dom.demoteToStudentButton.disabled = protectedAdmin;
  if (dom.resetUserPasswordButton) dom.resetUserPasswordButton.disabled = protectedAdmin || !['student', 'officer'].includes(user.role);
  dom.removeUserButton.hidden = protectedAdmin || user.accountStatus !== 'suspended' || user.isActive;
  dom.removeUserButton.textContent = user.accountRemovalPending ? 'Retry removal & unlink Gmail' : 'Remove account & unlink Gmail';
  if (user.accountRemovalPending) {
    dom.roleEditorForm.querySelectorAll('button, input, select, textarea').forEach(control => { control.disabled = true; });
    dom.removeUserButton.disabled = false;
  }
  updateRolePreview(protectedAdmin ? 'student' : user.role);
  void loadImportedYear(user);
}

let importedYearKey = '', importedYearRequest = 0;
async function loadImportedYear(user) {
  const key = JSON.stringify([user.uid, user.yearLevel, user.academicYear, user.academicRevision]);
  if (importedYearKey === key) return;
  importedYearKey = key;
  const requestId = ++importedYearRequest;
  const note = document.getElementById('importedYearNote');
  const display = (value, message) => { dom.yearLevelSelect.value = value; dom.selectedUserYearLevel.textContent = value; note.textContent = message; };
  if (user.role === 'admin') { display('Not applicable', 'Year level does not apply to administrator accounts.'); return; }
  if (!/^[0-9]{1,64}$/.test(user.studentId)) { display('Not recorded', 'Import this student through Student Records to set the year level.'); return; }
  display('Loading…', 'Reading the imported Student Record.');
  try {
    const { record, account } = await studentRecordCall('studentRegistrationLookup', { studentId: user.studentId });
    if (requestId !== importedYearRequest || selectedUserId !== user.uid) return;
    if (record && record.uid === user.uid && record.studentId === user.studentId && account?.uid === user.uid) {
      display(record.yearLevel || 'Not recorded', record.academicYear ? `Student Records · ${record.academicYear}` : 'Updated through Student Records imports.');
    } else display('Not recorded', 'No linked imported Student Record. Import this student to set the year level.');
  } catch {
    if (requestId !== importedYearRequest || selectedUserId !== user.uid) return;
    display('Unavailable', 'Year level could not be loaded. Reopen account details to retry.');
  }
}

function openUser(userId) {
  importedYearKey = '';
  selectedUserId = userId;
  fillEditor(getSelectedUser());
  renderTable();
  openUserEditorModal();
}


let latestTemporaryPassword = null;

function openPasswordResetResult(result) {
  if (result) result = { ...result, institutionalEmail: institutionalEmailForDisplay(result) };
  latestTemporaryPassword = result || null;
  if (!dom.passwordResetResultModal || !result) return;
  dom.passwordResetResultName.textContent = result.fullName || 'User';
  dom.passwordResetResultStudentId.textContent = result.studentId || 'N/A';
  dom.passwordResetResultEmail.textContent = result.institutionalEmail || 'Not Linked';
  dom.passwordResetResultPassword.textContent = result.temporaryPassword || '';
  dom.passwordResetResultModal.classList.remove('hidden');
  dom.passwordResetResultModal.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => dom.copyTemporaryPasswordButton?.focus({ preventScroll: true }));
}

function closePasswordResetResult() {
  if (!dom.passwordResetResultModal) return;
  dom.passwordResetResultModal.classList.add('hidden');
  dom.passwordResetResultModal.setAttribute('aria-hidden', 'true');
  latestTemporaryPassword = null;
}

async function copyTemporaryPassword() {
  const password = latestTemporaryPassword?.temporaryPassword || '';
  if (!password) return;
  try {
    await navigator.clipboard.writeText(password);
    const old = dom.copyTemporaryPasswordButton.innerHTML;
    dom.copyTemporaryPasswordButton.innerHTML = '<i class="fa-solid fa-check"></i> Copied';
    setTimeout(() => { if (dom.copyTemporaryPasswordButton) dom.copyTemporaryPasswordButton.innerHTML = old; }, 1400);
  } catch {
    const area = document.createElement('textarea');
    area.value = password;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
}

function printTemporaryPasswordSlip() {
  const data = latestTemporaryPassword;
  if (!data?.temporaryPassword) return;
  const win = window.open('', '_blank', 'noopener,noreferrer');
  if (!win) return alert('Allow pop-ups to print the temporary password slip.');
  const esc = escapeHtml;
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Password Reset Slip</title><style>body{font-family:Arial,sans-serif;margin:0;padding:34px;background:#f5f7fb;color:#10233f}.slip{max-width:720px;margin:auto;background:#fff;border:2px solid #183d72;padding:30px}.head{text-align:center;border-bottom:2px solid #183d72;padding-bottom:16px}.head h1{font-size:22px;margin:0 0 6px}.grid{display:grid;grid-template-columns:190px 1fr;gap:12px 16px;margin:24px 0}.value{font-weight:800;word-break:break-word}.password{font-family:Consolas,monospace;font-size:22px;letter-spacing:1px}.note{padding:14px;border:1px dashed #6b7c90;background:#f8fafc;line-height:1.5}.actions{text-align:center;margin-top:20px}.actions button{padding:10px 18px;font-weight:700}@media print{body{background:#fff;padding:0}.slip{max-width:none}.actions{display:none}}</style></head><body><article class="slip"><div class="head"><h1>SSU UNIVERSITY STUDENT COUNCIL</h1><strong>TEMPORARY PASSWORD RESET</strong></div><div class="grid"><span>User</span><span class="value">${esc(data.fullName || 'User')}</span><span>Student ID</span><span class="value">${esc(data.studentId || 'N/A')}</span><span>Institutional Email</span><span class="value">${esc(data.institutionalEmail || 'Not Linked')}</span><span>Temporary Password</span><span class="value password">${esc(data.temporaryPassword)}</span></div><div class="note"><strong>Important:</strong> Keep this temporary password private. Sign in using it, then open Profile → Change Password and replace it with a personal password.</div></article><div class="actions"><button onclick="window.print()">Print This Slip</button></div></body></html>`);
  win.document.close();
}

async function resetSelectedUserPassword() {
  const user = getSelectedUser();
  if (!user) return alert('Select a user first.');
  if (isProtectedAdmin(user) || !['student', 'officer'].includes(user.role)) {
    return alert('Only student and officer passwords can be reset from this directory.');
  }
  const display = user.fullName || user.studentId || user.email || 'this user';
  if (!window.confirm(`Issue a new temporary password for ${display}? The previous password will stop working and existing sessions will be revoked.`)) return;

  const button = dom.resetUserPasswordButton;
  if (button) {
    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Resetting...';
  }
  try {
    const result = await callSecure('adminResetUserPassword', {
      uid: user.uid,
      reason: dom.roleChangeNote?.value.trim() || 'Password reset requested by account holder.'
    });
    if (result?.emailResetSent === true) {
      const email = result.institutionalEmail || user.institutionalEmail || user.email || 'the registered email';
      alert(`Password recovery link sent to ${email}. The user can open that email and choose a new password.`);
      setFeedback(`Password recovery link sent to ${email}.`, 'success');
    } else {
      openPasswordResetResult(result);
      setFeedback(`Issued a new temporary password for ${display}.`, 'success');
    }
  } catch (error) {
    console.error('Admin password reset failed:', error);
    alert(error.message || 'Unable to reset this password.');
    setFeedback('Password reset failed.', 'error');
  } finally {
    if (button) {
      button.disabled = false;
      button.innerHTML = '<i class="fa-solid fa-key" aria-hidden="true"></i> Reset password';
    }
  }
}

async function saveSelectedUser(overrides = null) {
  const user = getSelectedUser();
  if (!user) {
    alert('Select a user first.');
    return;
  }
  if (!overrides && (dom.targetRoleSelect.value !== user.role
      || dom.accountStatusSelect.value !== user.accountStatus
      || dom.activeToggle.checked !== user.isActive
      || dom.studentStandingSelect.value !== (user.studentStanding || 'active'))) {
    if (!window.confirm(`Save access changes for ${user.fullName || user.studentId || 'this user'}? These changes may affect sign-in and dashboard permissions.`)) return;
  }
  isSaving = true;
  dom.saveRoleButton.disabled = true;
  dom.saveRoleButton.textContent = 'Saving...';
  try {
    const result = await updateSingleUser(user, {
      role: user.role,
      officePosition: user.officePosition,
      officerPermissions: user.officerPermissions,
      accountStatus: overrides?.accountStatus ?? dom.accountStatusSelect.value,
      roleEffectiveDate: overrides?.roleEffectiveDate ?? dom.effectiveDateInput.value,
      studentStanding: overrides?.studentStanding ?? dom.studentStandingSelect.value,
      isVerifiedStudent: typeof overrides?.isVerifiedStudent === 'boolean' ? overrides.isVerifiedStudent : dom.verifiedToggle.checked,
      isActive: typeof overrides?.isActive === 'boolean' ? overrides.isActive : dom.activeToggle.checked,
      adminNotes: overrides?.adminNotes ?? dom.adminNotesInput.value,
      changeReason: overrides?.changeReason ?? dom.roleChangeNote.value
    });
    setFeedback(result.message, 'success');
  } catch (error) {
    console.error(error);
    alert(error.message || 'Failed to save user changes.');
    setFeedback('Failed to save the selected user changes.', 'error');
  } finally {
    isSaving = false;
    dom.saveRoleButton.disabled = false;
    dom.saveRoleButton.textContent = 'Save user updates';
  }
}





function bind() {
  [dom.userSearchInput, dom.sortSelect]
    .forEach((element) => {
      element?.addEventListener('input', renderTable);
      element?.addEventListener('change', renderTable);
    });

  dom.accountStatusSelect.addEventListener('change', () => {
    if (dom.accountStatusSelect.value === 'suspended') dom.activeToggle.checked = false;
  });

  dom.studentStandingSelect?.addEventListener('change', () => {
    const inactive = dom.studentStandingSelect.value !== 'active';
    dom.activeToggle.disabled = inactive;
    dom.reactivateUserButton.disabled = inactive;
    if (inactive) {
      dom.activeToggle.checked = false;
      dom.verifiedToggle.checked = false;
      dom.reactivateUserButton.title = 'Set Student Standing to Active / Enrolled and save before reactivating access.';
    } else if (dom.accountStatusSelect.value !== 'suspended') {
      dom.activeToggle.checked = true;
      dom.reactivateUserButton.title = '';
    }
    if (dom.standingAccessNote) {
      dom.standingAccessNote.textContent = inactive
        ? 'This standing disables portal access as soon as you save.'
        : 'Active / Enrolled students may access the portal when their account is approved and active.';
    }
  });

  dom.roleEditorForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!isSaving) await saveSelectedUser();
  });

  dom.approveUserButton.addEventListener('click', async () => saveSelectedUser({ accountStatus: 'approved', isActive: true, changeReason: dom.roleChangeNote.value.trim() || 'Approved by admin.' }));
  dom.removeUserButton.addEventListener('click', async () => {
    const user = getSelectedUser();
    if (isSaving || !user || isProtectedAdmin(user) || user.accountStatus !== 'suspended' || user.isActive) return;
    if (!window.confirm(`Remove ${user.fullName || user.studentId || 'this account'} from the directory and unlink its personal Gmail? Sign-in will be disabled. Historical complaints and audit records will be retained.`)) return;
    isSaving = true;
    dom.removeUserButton.disabled = true;
    try {
      await callStudentEmailService('admin_remove_suspended_account', {uid:user.uid});
      closeUserEditorModal();
      setFeedback('Account removed and personal Gmail unlinked. Historical records were retained.', 'success');
    } catch (error) {
      setFeedback(error?.message || 'Removal failed. The account remains suspended; retry removal.', 'error');
    } finally {
      isSaving = false;
      if (dom.removeUserButton) dom.removeUserButton.disabled = false;
    }
  });
  dom.suspendUserButton.addEventListener('click', async () => {
    const user = getSelectedUser();
    if (!user || isProtectedAdmin(user)) return;
    if (window.confirm(`Suspend ${user.fullName || user.email || 'this user'}?`)) {
      await saveSelectedUser({ accountStatus: 'suspended', isActive: false, changeReason: dom.roleChangeNote.value.trim() || 'Suspended by admin.' });
    }
  });
  dom.reactivateUserButton.addEventListener('click', async () => saveSelectedUser({ accountStatus: 'approved', isActive: true, changeReason: dom.roleChangeNote.value.trim() || 'Reactivated by admin.' }));
  dom.demoteToStudentButton.addEventListener('click', async () => {
    const user = getSelectedUser();
    if (!user || isProtectedAdmin(user)) return;
    window.location.href = `officer-management.html?studentId=${encodeURIComponent(user.studentId || '')}`;
  });

  dom.resetUserPasswordButton?.addEventListener('click', resetSelectedUserPassword);


}


document.getElementById('cancelAccountDetailsButton')?.addEventListener('click', closeUserEditorModal);
dom.userEditorModalClose?.addEventListener('click', closeUserEditorModal);
dom.userEditorModalBackdrop?.addEventListener('click', closeUserEditorModal);
dom.passwordResetResultClose?.addEventListener('click', closePasswordResetResult);
dom.passwordResetResultBackdrop?.addEventListener('click', closePasswordResetResult);
dom.doneTemporaryPasswordButton?.addEventListener('click', closePasswordResetResult);
dom.copyTemporaryPasswordButton?.addEventListener('click', copyTemporaryPassword);
dom.printTemporaryPasswordButton?.addEventListener('click', printTemporaryPasswordSlip);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Tab' && !dom.userEditorModal?.classList.contains('hidden')
      && dom.passwordResetResultModal?.classList.contains('hidden')) {
    const controls = [...dom.userEditorModal.querySelectorAll('button, input, select, textarea, summary, [tabindex="0"]')]
      .filter(control => !control.disabled && control.offsetParent !== null && !control.classList.contains('user-editor-modal-backdrop'));
    const first = controls[0], last = controls.at(-1);
    if (first && event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (first && !event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  if (event.key === 'Escape') {
    if (!dom.passwordResetResultModal?.classList.contains('hidden')) return closePasswordResetResult();
    if (!dom.userEditorModal?.classList.contains('hidden')) closeUserEditorModal();
  }
});

setActiveAdminNav();
renderAdminIdentity();
buildPermissionEditor();
bind();
const directoryTable = bindDirectoryTable({
  body: dom.usersTableBody,
  scroller: document.getElementById('directoryTableScroll'),
  scrollbar: document.getElementById('directoryTopScroll'),
  slider: document.getElementById('directoryHorizontalScroll'),
  openAccount: openUser
});
subscribeUsers((value, error) => {
  const previousSelectedUser = getSelectedUser();
  users = value.map(user => ({ ...user, email: institutionalEmailForDisplay(user), institutionalEmail: institutionalEmailForDisplay(user) }));
  dom.listStatusText.textContent = error ? 'Unable to load accounts' : 'Up to date';
  renderTable();
  if (selectedUserId) {
    const current = getSelectedUser();
    // An academic-only import must not clear other unsaved editor fields.
    const academicOnly = previousSelectedUser && current && Object.keys(current).every(key =>
      ['yearLevel', 'academicYear', 'academicRevision'].includes(key) || JSON.stringify(current[key]) === JSON.stringify(previousSelectedUser[key]));
    if (academicOnly) void loadImportedYear(current);
    else fillEditor(current);
  }
});
subscribeComplaints((value) => { complaintSummaryByUid = value; renderTable(); if (selectedUserId) fillEditor(getSelectedUser()); });
