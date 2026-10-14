import { callSecure, auth } from "../../../shared/security-client.js?v=password-reset-fallback-1";
import { OFFICER_PERMISSION_DEFINITIONS, ALL_OFFICER_PERMISSIONS, DEFAULT_OFFICER_PERMISSIONS, hasKnownOfficerPositionPreset, isBaselineOfficerPermissionList, normalizeOfficerPermissions, permissionsForOfficerPosition } from "../../../shared/officer-permissions.js?v=programs-1";

import {
  complaintSummaryFor,
  escapeHtml,
  exportUsersCsv,
  formatDateOnly,
  formatDateTime,
  getBulkNoChangeValue,
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
  subscribeVotes,
  summarizeComplaintStates,
  updateSingleUser,
  applyBulkUpdates,
  voteSummaryFor
} from "./admin-core.js";


const uscAuthAllowed = await (globalThis.USC_AUTH_READY || Promise.resolve(false));
if (uscAuthAllowed !== true) await new Promise(() => {});


const BULK_NO_CHANGE = getBulkNoChangeValue();
const dom = {
  userSearchInput: document.getElementById("userSearchInput"),
  roleFilterSelect: document.getElementById("roleFilterSelect"),
  statusFilterSelect: document.getElementById("statusFilterSelect"),
  verifiedFilterSelect: document.getElementById("verifiedFilterSelect"),
  activeFilterSelect: document.getElementById("activeFilterSelect"),
  recentFilterSelect: document.getElementById("recentFilterSelect"),
  sortSelect: document.getElementById("sortSelect"),
  directoryCountBadge: document.getElementById("directoryCountBadge"),
  selectedCountBadge: document.getElementById("selectedCountBadge"),
  listStatusText: document.getElementById("listStatusText"),
  exportFilteredButton: document.getElementById("exportFilteredButton"),
  exportSelectedButton: document.getElementById("exportSelectedButton"),
  toggleAllUsers: document.getElementById("toggleAllUsers"),
  usersTableBody: document.getElementById("usersTableBody"),
  bulkRoleSelect: document.getElementById("bulkRoleSelect"),
  bulkStatusSelect: document.getElementById("bulkStatusSelect"),
  bulkVerificationSelect: document.getElementById("bulkVerificationSelect"),
  bulkActiveSelect: document.getElementById("bulkActiveSelect"),
  bulkOfficePositionInput: document.getElementById("bulkOfficePositionInput"),
  bulkEffectiveDateInput: document.getElementById("bulkEffectiveDateInput"),
  bulkReasonInput: document.getElementById("bulkReasonInput"),
  applyBulkButton: document.getElementById("applyBulkButton"),
  approveSelectedButton: document.getElementById("approveSelectedButton"),
  suspendSelectedButton: document.getElementById("suspendSelectedButton"),
  clearSelectionButton: document.getElementById("clearSelectionButton"),
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
  selectedUserCandidacy: document.getElementById("selectedUserCandidacy"),
  selectedUserActive: document.getElementById("selectedUserActive"),
  selectedUserComplaintCount: document.getElementById("selectedUserComplaintCount"),
  selectedUserComplaintStatus: document.getElementById("selectedUserComplaintStatus"),
  selectedUserVoteStatus: document.getElementById("selectedUserVoteStatus"),
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
  candidacyToggle: document.getElementById("candidacyToggle"),
  activeToggle: document.getElementById("activeToggle"),
  officerRbacEditor: document.getElementById("officerRbacEditor"),
  officerPermissionGrid: document.getElementById("officerPermissionGrid"),
  officerPermissionCount: document.getElementById("officerPermissionCount"),
  rbacDashboardOnlyButton: document.getElementById("rbacDashboardOnlyButton"),
  rbacFullAccessButton: document.getElementById("rbacFullAccessButton"),
  rbacApplyOfficeButton: document.getElementById("rbacApplyOfficeButton"),
  adminNotesInput: document.getElementById("adminNotesInput"),
  roleChangeNote: document.getElementById("roleChangeNote"),
  roleRoutePreview: document.getElementById("roleRoutePreview"),
  saveRoleButton: document.getElementById("saveRoleButton"),
  approveUserButton: document.getElementById("approveUserButton"),
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
let voteSummaryByStudentId = new Map();
let selectedUserId = "";
const selectedUserIds = new Set();
let isSaving = false;
const positionPresetSyncAttempted = new Set();
let positionPresetSyncRunning = false;

function buildPermissionEditor() {
  if (!dom.officerPermissionGrid) return;
  const groups = new Map();
  OFFICER_PERMISSION_DEFINITIONS.forEach((definition) => {
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
  const configured = user?.officerPermissionsConfigured === true;
  setOfficerPermissions(configured ? user.officerPermissions : (user ? ALL_OFFICER_PERMISSIONS : DEFAULT_OFFICER_PERMISSIONS));
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
    ? "Saved to Firestore."
    : tone === "error"
      ? "Update failed."
      : "Ready for admin updates.";
}

function updateSelectionCounters() {
  dom.selectedCountBadge.textContent = `${selectedUserIds.size} selected`;
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
    dom.usersTableBody.innerHTML = '<tr><td colspan="10"><div class="empty-state"><strong>No matching accounts</strong><span>Adjust the current filters and search terms.</span></div></td></tr>';
    dom.toggleAllUsers.checked = false;
    updateSelectionCounters();
    return;
  }

  dom.usersTableBody.innerHTML = visibleUsers.map((user) => {
    const selected = selectedUserIds.has(user.uid);
    const complaintSummary = complaintSummaryFor(user, complaintSummaryByUid);
    return `
      <tr class="directory-row ${selectedUserId === user.uid ? 'is-open' : ''}">
        <td><input type="checkbox" class="row-selector" data-user-id="${escapeHtml(user.uid)}" ${selected ? 'checked' : ''} ${isProtectedAdmin(user) ? 'disabled' : ''} /></td>
        <td><div class="directory-user-cell"><span class="directory-user-avatar" aria-hidden="true">${escapeHtml(getInitials(user.fullName, user.email))}</span><div class="table-name"><strong>${escapeHtml(user.fullName || 'Unnamed user')}</strong><small>${escapeHtml(user.email || 'No email')}</small></div></div></td>
        <td class="mono">${escapeHtml(user.studentId || 'N/A')}</td>
        <td><span class="role-badge ${roleClass(user.role)}">${escapeHtml(user.role)}</span></td>
        <td><span class="status-badge ${statusClass(user.accountStatus)}">${escapeHtml(user.accountStatus)}</span></td>
        <td><span class="verify-badge ${user.isVerifiedStudent ? 'verify-yes' : 'verify-no'}">${user.isVerifiedStudent ? 'Verified' : 'Unverified'}</span></td>
        <td><span class="active-badge ${user.isActive ? 'active-yes' : 'active-no'}">${user.isActive ? 'Active' : 'Inactive'}</span></td>
        <td>${escapeHtml(user.officePosition || '—')}</td>
        <td>${escapeHtml(formatDateTime(user.lastLoginAtMs))}</td>
        <td><div class="table-actions"><button type="button" class="open-btn ${selectedUserId === user.uid ? 'selected' : ''}" data-open-user="${escapeHtml(user.uid)}">Open</button><span class="mono">${complaintSummary.total} complaints</span></div></td>
      </tr>
    `;
  }).join("");

  const visibleSelectable = visibleUsers.filter((user) => !isProtectedAdmin(user));
  dom.toggleAllUsers.checked = Boolean(visibleSelectable.length) && visibleSelectable.every((user) => selectedUserIds.has(user.uid));

  dom.usersTableBody.querySelectorAll('.row-selector').forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      const userId = checkbox.getAttribute('data-user-id') || '';
      if (!userId) return;
      if (checkbox.checked) selectedUserIds.add(userId);
      else selectedUserIds.delete(userId);
      updateSelectionCounters();
    });
  });

  dom.usersTableBody.querySelectorAll('[data-open-user]').forEach((button) => {
    button.addEventListener('click', () => openUser(button.getAttribute('data-open-user') || ''));
  });

  updateSelectionCounters();
}

function openUserEditorModal() {
  if (!dom.userEditorModal) return;
  dom.userEditorModal.classList.remove('hidden');
  dom.userEditorModal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('user-editor-modal-open');
  requestAnimationFrame(() => dom.userEditorModalClose?.focus({ preventScroll: true }));
}

function closeUserEditorModal() {
  if (!dom.userEditorModal) return;
  dom.userEditorModal.classList.add('hidden');
  dom.userEditorModal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('user-editor-modal-open');
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
  const voteSummary = voteSummaryFor(user, voteSummaryByStudentId);
  const protectedAdmin = isProtectedAdmin(user);
  dom.selectedUserRestrictionBanner.classList.toggle('hidden', !protectedAdmin);
  dom.selectedUserInitials.textContent = getInitials(user.fullName, user.email);
  dom.selectedUserName.textContent = user.fullName || 'Unnamed user';
  dom.selectedUserEmail.textContent = user.email || 'No email saved';
  dom.selectedUserId.textContent = `Student ID: ${user.studentId || 'N/A'}`;
  dom.selectedUserRole.textContent = `Role: ${user.role}`;
  dom.selectedUserRole.className = `role-badge ${roleClass(user.role)}`;
  dom.selectedUserStatus.textContent = `Status: ${user.accountStatus}`;
  dom.selectedUserStatus.className = `status-badge ${statusClass(user.accountStatus)}`;
  dom.selectedUserRoute.textContent = routeLabel(user.role);
  dom.selectedUserOfficePosition.textContent = user.officePosition || '—';
  if (dom.selectedUserPermissionSummary) {
    const count = user.role === 'officer' ? normalizeOfficerPermissions(user.officerPermissions, { legacyFullAccess: user.officerPermissionsConfigured !== true }).length : 0;
    dom.selectedUserPermissionSummary.textContent = user.role === 'officer' ? `${count} granted permission${count === 1 ? '' : 's'}` : 'Not applicable';
  }
  dom.selectedUserRegisteredAt.textContent = formatDateTime(user.createdAtMs);
  dom.selectedUserLastLogin.textContent = formatDateTime(user.lastLoginAtMs);
  dom.selectedUserLastActivity.textContent = formatDateTime(user.lastActivityAtMs);
  dom.selectedUserEffectiveDate.textContent = formatDateOnly(user.roleEffectiveDate);
  dom.selectedUserYearLevel.textContent = user.yearLevel || '—';
  dom.selectedUserStanding.textContent = user.studentStandingLabel || user.studentStanding || 'Active / Enrolled';
  dom.selectedUserVerified.textContent = user.isVerifiedStudent ? 'Verified' : 'Unverified';
  if (dom.selectedUserCandidacy) dom.selectedUserCandidacy.textContent = user.candidacyApproved ? 'Approved to register' : 'Not approved';
  dom.selectedUserActive.textContent = user.isActive ? 'Active' : 'Inactive';
  dom.selectedUserComplaintCount.textContent = `${complaintSummary.total} total`;
  dom.selectedUserComplaintStatus.textContent = summarizeComplaintStates(complaintSummary);
  dom.selectedUserVoteStatus.textContent = voteSummary ? `Submitted (${formatDateTime(voteSummary.submittedAtMs)})` : 'Not submitted';
  dom.selectedUserLastUpdate.textContent = user.updatedAtMs ? `${formatDateTime(user.updatedAtMs)}${user.lastRoleUpdatedBy ? ` • by ${user.lastRoleUpdatedBy}` : ''}` : '—';
  dom.targetRoleSelect.value = protectedAdmin ? 'student' : user.role;
  dom.officePositionInput.value = user.officePosition || '';
  syncRbacEditorForRole(user.role, user);
  dom.accountStatusSelect.value = user.accountStatus;
  dom.effectiveDateInput.value = user.roleEffectiveDate || '';
  dom.yearLevelSelect.value = user.yearLevel || '';
  dom.studentStandingSelect.value = user.studentStanding || 'active';
  dom.verifiedToggle.checked = user.isVerifiedStudent;
  if (dom.candidacyToggle) dom.candidacyToggle.checked = user.candidacyApproved === true;
  dom.activeToggle.checked = user.isActive;
  const inactiveStanding = (user.studentStanding || 'active') !== 'active';
  dom.activeToggle.disabled = protectedAdmin || inactiveStanding;
  if (dom.candidacyToggle) dom.candidacyToggle.disabled = protectedAdmin || inactiveStanding || user.role !== 'student';
  dom.reactivateUserButton.title = inactiveStanding ? 'Set Student Standing to Active / Enrolled and save before reactivating access.' : '';
  dom.adminNotesInput.value = user.adminNotes || '';
  dom.roleChangeNote.value = '';
  dom.targetRoleSelect.disabled = protectedAdmin;
  dom.officePositionInput.disabled = protectedAdmin;
  dom.approveUserButton.disabled = protectedAdmin;
  dom.suspendUserButton.disabled = protectedAdmin;
  dom.reactivateUserButton.disabled = protectedAdmin || inactiveStanding;
  dom.demoteToStudentButton.disabled = protectedAdmin;
  if (dom.resetUserPasswordButton) dom.resetUserPasswordButton.disabled = protectedAdmin || !['student', 'officer'].includes(user.role);
  updateRolePreview(protectedAdmin ? 'student' : user.role);
}

function openUser(userId) {
  selectedUserId = userId;
  fillEditor(getSelectedUser());
  renderTable();
  openUserEditorModal();
}


let latestTemporaryPassword = null;

function openPasswordResetResult(result) {
  latestTemporaryPassword = result || null;
  if (!dom.passwordResetResultModal || !result) return;
  dom.passwordResetResultName.textContent = result.fullName || 'User';
  dom.passwordResetResultStudentId.textContent = result.studentId || 'N/A';
  dom.passwordResetResultEmail.textContent = result.institutionalEmail || 'N/A';
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
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Password Reset Slip</title><style>body{font-family:Arial,sans-serif;margin:0;padding:34px;background:#f5f7fb;color:#10233f}.slip{max-width:720px;margin:auto;background:#fff;border:2px solid #183d72;padding:30px}.head{text-align:center;border-bottom:2px solid #183d72;padding-bottom:16px}.head h1{font-size:22px;margin:0 0 6px}.grid{display:grid;grid-template-columns:190px 1fr;gap:12px 16px;margin:24px 0}.value{font-weight:800;word-break:break-word}.password{font-family:Consolas,monospace;font-size:22px;letter-spacing:1px}.note{padding:14px;border:1px dashed #6b7c90;background:#f8fafc;line-height:1.5}.actions{text-align:center;margin-top:20px}.actions button{padding:10px 18px;font-weight:700}@media print{body{background:#fff;padding:0}.slip{max-width:none}.actions{display:none}}</style></head><body><article class="slip"><div class="head"><h1>SSU UNIVERSITY STUDENT COUNCIL</h1><strong>TEMPORARY PASSWORD RESET</strong></div><div class="grid"><span>User</span><span class="value">${esc(data.fullName || 'User')}</span><span>Student ID</span><span class="value">${esc(data.studentId || 'N/A')}</span><span>Institutional Email</span><span class="value">${esc(data.institutionalEmail || 'N/A')}</span><span>Temporary Password</span><span class="value password">${esc(data.temporaryPassword)}</span></div><div class="note"><strong>Important:</strong> Keep this temporary password private. Sign in using it, then open Profile → Change Password and replace it with a personal password.</div></article><div class="actions"><button onclick="window.print()">Print This Slip</button></div></body></html>`);
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
  isSaving = true;
  dom.saveRoleButton.disabled = true;
  dom.saveRoleButton.textContent = 'Saving...';
  try {
    const result = await updateSingleUser(user, {
      role: overrides?.role ?? dom.targetRoleSelect.value,
      officePosition: overrides?.officePosition ?? dom.officePositionInput.value,
      officerPermissions: overrides?.officerPermissions ?? (dom.targetRoleSelect.value === 'officer' ? selectedOfficerPermissions() : []),
      accountStatus: overrides?.accountStatus ?? dom.accountStatusSelect.value,
      roleEffectiveDate: overrides?.roleEffectiveDate ?? dom.effectiveDateInput.value,
      yearLevel: overrides?.yearLevel ?? dom.yearLevelSelect.value,
      studentStanding: overrides?.studentStanding ?? dom.studentStandingSelect.value,
      isVerifiedStudent: typeof overrides?.isVerifiedStudent === 'boolean' ? overrides.isVerifiedStudent : dom.verifiedToggle.checked,
      candidacyApproved: typeof overrides?.candidacyApproved === 'boolean' ? overrides.candidacyApproved : Boolean(dom.candidacyToggle?.checked),
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

async function handleBulk(overrides = {}) {
  const targets = users.filter((user) => selectedUserIds.has(user.uid));
  try {
    const result = await applyBulkUpdates(targets, {
      role: (overrides.role ?? dom.bulkRoleSelect.value) || undefined,
      accountStatus: (overrides.accountStatus ?? dom.bulkStatusSelect.value) || undefined,
      verification: overrides.verification ?? dom.bulkVerificationSelect.value ?? BULK_NO_CHANGE,
      activeState: overrides.activeState ?? dom.bulkActiveSelect.value ?? BULK_NO_CHANGE,
      officePosition: overrides.officePosition ?? dom.bulkOfficePositionInput.value,
      roleEffectiveDate: overrides.roleEffectiveDate ?? dom.bulkEffectiveDateInput.value,
      adminNotes: overrides.adminNotes,
      changeReason: overrides.changeReason ?? dom.bulkReasonInput.value
    });
    setFeedback(result.message, 'success');
  } catch (error) {
    console.error(error);
    alert(error.message || 'Failed to apply bulk changes.');
    setFeedback('Bulk update failed.', 'error');
  }
}



async function syncLegacyPositionPresets() {
  if (positionPresetSyncRunning) return;
  const targets = users.filter((user) => {
    if (user.role !== 'officer' || user.officerPermissionSource === 'custom') return false;
    if (!hasKnownOfficerPositionPreset(user.officePosition)) return false;
    if (positionPresetSyncAttempted.has(user.uid)) return false;
    return user.officerPermissionsConfigured !== true || isBaselineOfficerPermissionList(user.storedOfficerPermissions);
  });
  if (!targets.length) return;

  positionPresetSyncRunning = true;
  try {
    for (const officer of targets) {
      positionPresetSyncAttempted.add(officer.uid);
      try {
        await updateSingleUser(officer, {
          officerPermissions: permissionsForOfficerPosition(officer.officePosition),
          officerPermissionSource: 'position-default',
          changeReason: `Applied the default RBAC permissions for ${officer.officePosition}.`
        });
      } catch (error) {
        console.warn(`Unable to synchronize RBAC preset for ${officer.fullName || officer.uid}:`, error);
      }
    }
  } finally {
    positionPresetSyncRunning = false;
  }
}

function bind() {
  [dom.userSearchInput, dom.sortSelect]
    .forEach((element) => {
      element?.addEventListener('input', renderTable);
      element?.addEventListener('change', renderTable);
    });

  dom.toggleAllUsers.addEventListener('change', () => {
    const visibleUsers = getFilteredDirectory().filter((user) => !isProtectedAdmin(user));
    if (dom.toggleAllUsers.checked) visibleUsers.forEach((user) => selectedUserIds.add(user.uid));
    else visibleUsers.forEach((user) => selectedUserIds.delete(user.uid));
    renderTable();
  });

  dom.targetRoleSelect.addEventListener('change', () => {
    const nextRole = dom.targetRoleSelect.value === 'officer' ? 'officer' : 'student';
    if (nextRole === 'student') dom.officePositionInput.value = '';
    if (nextRole === 'officer' && !dom.officePositionInput.value.trim()) dom.officePositionInput.value = 'USC Officer';
    syncRbacEditorForRole(nextRole, nextRole === getSelectedUser()?.role ? getSelectedUser() : null);
    updateRolePreview(nextRole);
  });

  dom.officePositionInput?.addEventListener('change', () => {
    if (dom.targetRoleSelect.value !== 'officer') return;
    const selected = getSelectedUser();
    const sameSavedOffice = selected?.role === 'officer'
      && String(selected.officePosition || '').trim().toLowerCase() === String(dom.officePositionInput.value || '').trim().toLowerCase();
    if (sameSavedOffice && selected?.officerPermissionSource === 'custom') return;
    setOfficerPermissions(permissionsForOfficerPosition(dom.officePositionInput.value));
  });

  dom.accountStatusSelect.addEventListener('change', () => {
    if (dom.accountStatusSelect.value === 'suspended') dom.activeToggle.checked = false;
  });

  dom.studentStandingSelect?.addEventListener('change', () => {
    const inactive = dom.studentStandingSelect.value !== 'active';
    dom.activeToggle.disabled = inactive;
    if (dom.candidacyToggle) dom.candidacyToggle.disabled = inactive || dom.targetRoleSelect.value !== 'student';
    dom.reactivateUserButton.disabled = inactive;
    if (inactive) {
      dom.activeToggle.checked = false;
      dom.verifiedToggle.checked = false;
      if (dom.candidacyToggle) dom.candidacyToggle.checked = false;
      dom.reactivateUserButton.title = 'Set Student Standing to Active / Enrolled and save before reactivating access.';
    } else if (dom.accountStatusSelect.value !== 'suspended') {
      dom.activeToggle.checked = true;
      dom.reactivateUserButton.title = '';
    }
    if (dom.standingAccessNote) {
      dom.standingAccessNote.textContent = inactive
        ? 'This standing disables portal access and election eligibility as soon as you save.'
        : 'Active / Enrolled students may access the portal; election eligibility follows the verified-voter setting.';
    }
  });

  dom.rbacDashboardOnlyButton?.addEventListener('click', () => setOfficerPermissions(DEFAULT_OFFICER_PERMISSIONS));
  dom.rbacFullAccessButton?.addEventListener('click', () => setOfficerPermissions(ALL_OFFICER_PERMISSIONS));
  dom.rbacApplyOfficeButton?.addEventListener('click', async () => {
    const selected = getSelectedUser();
    if (!selected || selected.role !== 'officer') return alert('Select a USC officer first.');
    const savedOffice = String(selected.officePosition || '').trim();
    const editorOffice = String(dom.officePositionInput.value || '').trim();
    if (!savedOffice) return alert('Save an Office Position for this officer before applying office-wide RBAC.');
    if (editorOffice && editorOffice.toLowerCase() !== savedOffice.toLowerCase()) {
      return alert('The Office Position was changed in the editor. Save the user first, then apply RBAC to that office.');
    }
    const sameOffice = users.filter((user) => user.role === 'officer' && String(user.officePosition || '').trim().toLowerCase() === savedOffice.toLowerCase());
    if (!sameOffice.length) return alert(`No officer accounts are assigned to ${savedOffice}.`);
    if (!confirm(`Apply this permission set to all ${sameOffice.length} officer account${sameOffice.length === 1 ? '' : 's'} assigned to ${savedOffice}?`)) return;
    const permissions = selectedOfficerPermissions();
    const reason = dom.roleChangeNote.value.trim() || `RBAC permissions synchronized for office: ${savedOffice}.`;
    let updated = 0;
    for (const officer of sameOffice) {
      await updateSingleUser(officer, { officerPermissions: permissions, changeReason: reason });
      updated += 1;
    }
    setFeedback(`Applied RBAC permissions to all ${updated} officer account${updated === 1 ? '' : 's'} in ${savedOffice}.`, 'success');
  });

  dom.roleEditorForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!isSaving) await saveSelectedUser();
  });

  dom.approveUserButton.addEventListener('click', async () => saveSelectedUser({ accountStatus: 'approved', isActive: true, changeReason: dom.roleChangeNote.value.trim() || 'Approved by admin.' }));
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
    if (window.confirm(`Return ${user.fullName || user.email || 'this user'} to student access?`)) {
      await saveSelectedUser({ role: 'student', officePosition: '', roleEffectiveDate: new Date().toISOString(), changeReason: dom.roleChangeNote.value.trim() || 'Returned to student access by admin.' });
    }
  });

  dom.resetUserPasswordButton?.addEventListener('click', resetSelectedUserPassword);

  dom.applyBulkButton.addEventListener('click', async () => handleBulk());
  dom.approveSelectedButton.addEventListener('click', async () => handleBulk({ accountStatus: 'approved', activeState: 'active', changeReason: dom.bulkReasonInput.value.trim() || 'Approved in bulk by admin.' }));
  dom.suspendSelectedButton.addEventListener('click', async () => {
    if (!selectedUserIds.size) {
      alert('Select users first.');
      return;
    }
    if (window.confirm(`Suspend ${selectedUserIds.size} selected user${selectedUserIds.size === 1 ? '' : 's'}?`)) {
      await handleBulk({ accountStatus: 'suspended', activeState: 'inactive', changeReason: dom.bulkReasonInput.value.trim() || 'Suspended in bulk by admin.' });
    }
  });
  dom.clearSelectionButton.addEventListener('click', () => {
    selectedUserIds.clear();
    renderTable();
  });

  dom.exportFilteredButton.addEventListener('click', () => {
    try {
      exportUsersCsv(getFilteredDirectory(), complaintSummaryByUid, voteSummaryByStudentId, 'usc-users-filtered.csv');
    } catch (error) {
      alert(error.message || 'Nothing to export.');
    }
  });
  dom.exportSelectedButton.addEventListener('click', () => {
    try {
      exportUsersCsv(users.filter((user) => selectedUserIds.has(user.uid)), complaintSummaryByUid, voteSummaryByStudentId, 'usc-users-selected.csv');
    } catch (error) {
      alert(error.message || 'Nothing to export.');
    }
  });
}


dom.userEditorModalClose?.addEventListener('click', closeUserEditorModal);
dom.userEditorModalBackdrop?.addEventListener('click', closeUserEditorModal);
dom.passwordResetResultClose?.addEventListener('click', closePasswordResetResult);
dom.passwordResetResultBackdrop?.addEventListener('click', closePasswordResetResult);
dom.doneTemporaryPasswordButton?.addEventListener('click', closePasswordResetResult);
dom.copyTemporaryPasswordButton?.addEventListener('click', copyTemporaryPassword);
dom.printTemporaryPasswordButton?.addEventListener('click', printTemporaryPasswordSlip);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (!dom.passwordResetResultModal?.classList.contains('hidden')) return closePasswordResetResult();
    if (!dom.userEditorModal?.classList.contains('hidden')) closeUserEditorModal();
  }
});

setActiveAdminNav();
renderAdminIdentity();
buildPermissionEditor();
bind();
subscribeUsers((value, error) => {
  users = value;
  dom.listStatusText.textContent = error ? 'Unable to load accounts' : 'Live from Firestore';
  renderTable();
  if (selectedUserId) fillEditor(getSelectedUser());
  if (!error) void syncLegacyPositionPresets();
});
subscribeComplaints((value) => { complaintSummaryByUid = value; renderTable(); if (selectedUserId) fillEditor(getSelectedUser()); });
subscribeVotes((value) => { voteSummaryByStudentId = value; if (selectedUserId) fillEditor(getSelectedUser()); });
