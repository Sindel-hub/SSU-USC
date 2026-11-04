import { extendVotingSchedule } from "../../../shared/election-extension.js";
import { effectiveOfficerPermissions } from "../../../shared/officer-permissions.js";
import { auth, db } from "../../../firebase/firebase-config.js";
import { callSecure, openPrivateFile, resolveMediaUrl } from "../../../shared/security-client.js";
import {
  collection, doc, getDoc, getDocs
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";

const uscAuthAllowed = await (globalThis.USC_AUTH_READY || Promise.resolve(false));
if (uscAuthAllowed !== true) await new Promise(() => {});


const $ = (id) => document.getElementById(id);
const els = {
  activeElectionCount: $("activeElectionCount"), candidateCount: $("candidateCount"), votesCastCount: $("votesCastCount"),
  turnoutPercent: $("turnoutPercent"), turnoutProgressLabel: $("turnoutProgressLabel"), turnoutBar: $("turnoutBar"),
  electionResultsBody: $("electionResultsBody"), presidentAnalytics: $("presidentAnalytics"), viceAnalytics: $("viceAnalytics"),
  electionTitleInput: $("electionTitleInput"), electionStatusInput: $("electionStatusInput"),
  registrationStartInput: $("registrationStartInput"), registrationEndInput: $("registrationEndInput"),
  applicationReviewStartInput: $("applicationReviewStartInput"), applicationReviewEndInput: $("applicationReviewEndInput"),
  candidatePublicationStartInput: $("candidatePublicationStartInput"), candidatePublicationEndInput: $("candidatePublicationEndInput"),
  votingStartInput: $("votingStartInput"), votingEndInput: $("votingEndInput"),
  resultPublicationStartInput: $("resultPublicationStartInput"), resultPublicationEndInput: $("resultPublicationEndInput"),
  saveElectionSettingsBtn: $("saveElectionSettingsBtn"), activePhaseBadge: $("activePhaseBadge"), electionStatusTitle: $("electionStatusTitle"),
  scheduleValidationMessage: $("scheduleValidationMessage"), candidateReviewPhaseBadge: $("candidateReviewPhaseBadge"),
  candidateReviewList: $("candidateReviewList"), candidateApplicationTotal: $("candidateApplicationTotal"), candidateApprovedTotal: $("candidateApprovedTotal"),
  candidatePendingTotal: $("candidatePendingTotal"), candidateRejectedTotal: $("candidateRejectedTotal"),
  exportSummaryBtn: $("exportSummaryBtn"), viewFullTallyBtn: $("viewFullTallyBtn"),
  turnoutSnapshotText: $("turnoutSnapshotText"), candidateSnapshotText: $("candidateSnapshotText"),
  departmentTurnoutList: $("departmentTurnoutList"), departmentTurnoutTotal: $("departmentTurnoutTotal")
};
const scheduleInputs = {
  registrationStart: els.registrationStartInput, registrationEnd: els.registrationEndInput,
  applicationReviewStart: els.applicationReviewStartInput, applicationReviewEnd: els.applicationReviewEndInput,
  candidatePublicationStart: els.candidatePublicationStartInput, candidatePublicationEnd: els.candidatePublicationEndInput,
  votingStart: els.votingStartInput, votingEnd: els.votingEndInput,
  resultPublicationStart: els.resultPublicationStartInput, resultPublicationEnd: els.resultPublicationEndInput
};
let context = null;
let electionId = "";
let applications = [];
let candidates = [];
let turnout = { ballotsCast: 0, eligibleVoters: 0 };
let departmentTurnout = { totalVoters: 0, departments: [] };
let trustedClaims = {};
let canManageCandidates = false;
let canRemoveCandidates = false;

let scheduleFormDirty = false;
let scheduleEditorMode = "edit";
let scheduleEditorOriginal = null;
let scheduleEditorVersion = null;

function markScheduleDirty() {
  scheduleFormDirty = true;
}

function clean(v) { return String(v ?? "").trim(); }
function esc(v) { return clean(v).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]); }
function asLocalInput(ms) {
  if (!ms) return "";
  const d = new Date(Number(ms));
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}
function msg(text, type = "") {
  if (!els.scheduleValidationMessage) return;
  els.scheduleValidationMessage.textContent = text;
  els.scheduleValidationMessage.classList.toggle("is-error", type === "error");
  els.scheduleValidationMessage.classList.toggle("is-success", type === "success");
}
function lifecycleDescription() {
  if (!context) return "No active election is currently verified by the server.";
  const map = {
    Draft: "Draft: schedule exists, sensitive election actions remain locked.",
    Registration: "Registration: verified students may submit candidate applications.",
    Review: "Review: authorized officers may approve or reject candidate applications.",
    Published: "Published: approved candidates are visible to students.",
    Voting: "Voting: anonymous ballots are being accepted. Candidate totals are hidden.",
    "Voting Closed": "Voting Closed: no more ballots are accepted. Finalization is required before canvassing.",
    Canvassing: "Canvassing: the election is finalized and authorized canvassers may inspect tallies.",
    "Results Published": "Results Published: official candidate totals are now student-readable.",
    Archived: "Archived: official results are preserved. Authorized officers may still manage candidate profiles."
  };
  return map[context.lifecycle] || context.lifecycle;
}

function installHardeningPanels() {
  const review = document.getElementById("candidateReviewCard");
  if (review && !$("masterlistImportCard")) {
    review.insertAdjacentHTML("beforebegin", `<section class="card" id="masterlistImportCard" style="margin-bottom:18px"><div class="card-head"><div><h3>School Student Accounts & Voter Masterlist</h3><span>Import the school-issued Student ID and institutional email. The same file securely provisions student login accounts and election eligibility.</span></div><span class="phase-status-pill">Admin only</span></div><div class="card-body"><div class="field"><label>Masterlist CSV</label><input id="masterlistCsvInput" type="file" accept=".csv,text/csv"><small>Required columns: studentId, fullName, institutionalEmail, program, college, yearLevel, studentStanding, eligible. Student standing may be active, leave, inactive, graduated, transferred, withdrawn, or eliminated. The legacy headers <strong>email</strong> and <strong>enrollmentStatus</strong> are still accepted.</small></div><div class="row-actions"><button class="mini-btn primary" id="importMasterlistBtn" type="button">Import & Provision School Accounts</button><a class="mini-btn light" href="../../data/voter-masterlist-template.csv" download>Download CSV Template</a></div><p id="masterlistImportMessage"></p></div></section>`);
  }
}

async function loadContext() {
  try {
    context = await callSecure("getElectionContext");
    electionId = context.electionId;
  } catch (error) {
    console.warn("No active election context:", error);
    context = null;
    const pointer = await getDoc(doc(db, "election_config", "current")).catch(() => null);
    electionId = pointer?.exists?.() ? clean(pointer.data().electionId) : "";
  }
}

async function loadData() {
  applications = [];
  candidates = [];
  turnout = { ballotsCast: 0, eligibleVoters: context?.eligibleVoterCount || 0 };
  departmentTurnout = { totalVoters: 0, departments: [] };
  if (!electionId) return;
  const [appSnap, candidateSnap, turnoutSnap, departmentResult] = await Promise.all([
    getDocs(collection(db, "elections", electionId, "applications")).catch(() => null),
    getDocs(collection(db, "elections", electionId, "candidates")).catch(() => null),
    getDoc(doc(db, "elections", electionId, "turnout", "public")).catch(() => null),
    callSecure("getElectionDepartmentTurnout", { electionId }).catch((error) => {
      console.warn("Department turnout analytics unavailable:", error);
      return null;
    })
  ]);
  if (appSnap) applications = appSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (candidateSnap) candidates = candidateSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (turnoutSnap?.exists?.()) turnout = turnoutSnap.data();
  if (departmentResult) departmentTurnout = departmentResult;
}

function formatScheduleDate(value) {
  const ms = Number(value || 0);
  if (!ms) return "Not set";
  return new Intl.DateTimeFormat("en-US", {
    month: "2-digit", day: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  }).format(new Date(ms));
}

const phaseSummaryDefinitions = [
  ["registration", "Candidate Registration", "registrationStart", "registrationEnd", "savedRegistrationFrom", "savedRegistrationUntil"],
  ["review", "Application Review", "applicationReviewStart", "applicationReviewEnd", "savedReviewFrom", "savedReviewUntil"],
  ["publication", "Candidate Publication", "candidatePublicationStart", "candidatePublicationEnd", "savedPublicationFrom", "savedPublicationUntil"],
  ["voting", "Voting", "votingStart", "votingEnd", "savedVotingFrom", "savedVotingUntil"],
  ["results", "Result Publication", "resultPublicationStart", "resultPublicationEnd", "savedResultsFrom", "savedResultsUntil"]
];

function setButtonState(button, disabled) {
  if (!button || button.dataset.rbacDisabledByScript === "true") return;
  button.disabled = Boolean(disabled);
}

function renderSavedSchedule() {
  const hasSchedule = Boolean(electionId && context?.scheduleComplete);
  const title = context?.title || "USC Election";
  const lifecycle = context?.lifecycle || "Not configured";
  const setText = (id, value) => { const node = $(id); if (node) node.textContent = value; };
  setText("savedElectionTitle", hasSchedule ? title : "No saved schedule");
  setText("savedElectionId", hasSchedule ? electionId : "Not configured");
  setText("savedElectionPhase", lifecycle);
  setText("currentScheduleStatus", hasSchedule ? lifecycle : "Not configured");
  setText("currentScheduleDescription", hasSchedule ? "Active election schedule." : "Create an election schedule to begin.");
  setText("savedScheduleUpdated", hasSchedule ? "Times shown in local time." : "No active schedule is currently saved.");
  const state = $("savedScheduleState");
  if (state) {
    state.innerHTML = hasSchedule
      ? '<i class="fa-solid fa-circle-check"></i> Saved schedule'
      : '<i class="fa-regular fa-circle"></i> No schedule saved';
    state.classList.toggle("is-empty", !hasSchedule);
  }

  const activeMap = { Registration: "registration", Review: "review", Published: "publication", Voting: "voting", "Results Published": "results" };
  document.querySelectorAll("[data-phase-summary]").forEach((row) => row.classList.toggle("is-active", row.dataset.phaseSummary === activeMap[lifecycle]));
  const summaryRows = [];
  phaseSummaryDefinitions.forEach(([key, label, fromField, untilField, fromId, untilId], index) => {
    const from = hasSchedule ? formatScheduleDate(context?.[fromField]) : "Not set";
    const until = hasSchedule ? formatScheduleDate(context?.[untilField]) : "Not set";
    setText(fromId, from);
    setText(untilId, until);
    summaryRows.push(`<div class="schedule-summary-row"><span>${index + 1}</span><strong>${esc(label)}</strong><small>${esc(from)} → ${esc(until)}</small></div>`);
  });
  const summary = $("scheduleSummaryList");
  if (summary) summary.innerHTML = hasSchedule ? summaryRows.join("") : '<div class="schedule-summary-empty">No saved schedule yet.</div>';

  const scheduleLocked = context?.finalized || context?.resultsPublished || context?.archived;
  setButtonState($("editScheduleBtn"), !hasSchedule || scheduleLocked);
  setButtonState($("extendVotingBtn"), !hasSchedule || scheduleLocked);
  setButtonState($("deleteCurrentScheduleBtn"), !hasSchedule || context?.finalized || context?.resultsPublished || context?.archived);
  setButtonState($("deleteScheduleFromEditorBtn"), !hasSchedule || context?.finalized || context?.resultsPublished || context?.archived);
}

function populateScheduleEditor({ blank = false } = {}) {
  if (els.electionTitleInput) els.electionTitleInput.value = blank ? "USC Election" : (context?.title || "USC General Election");
  const idInput = $("electionIdInput");
  if (idInput) idInput.value = electionId || `usc-${new Date().getFullYear()}-general`;
  for (const [field, input] of Object.entries(scheduleInputs)) {
    if (!input) continue;
    input.value = blank ? "" : asLocalInput(context?.[field]);
  }
  if (els.electionStatusInput) els.electionStatusInput.value = context?.lifecycle || "Not configured";
  scheduleFormDirty = false;
}

function openScheduleEditor(mode = "edit") {
  const dialog = $("scheduleEditorDialog");
  if (!dialog) return;
  const hasSchedule = Boolean(electionId && context?.scheduleComplete);
  if (hasSchedule && (context?.finalized || context?.resultsPublished || context?.archived)) return alert("Officially finalized, published, or archived elections cannot be rescheduled.");
  scheduleEditorMode = mode;
  scheduleEditorOriginal = hasSchedule ? {...context} : null;
  scheduleEditorVersion = hasSchedule ? Number(context?.scheduleVersion || 0) : null;
  const blank = mode === "create" && !hasSchedule;
  populateScheduleEditor({ blank });
  const title = $("scheduleEditorTitle");
  const description = $("scheduleEditorDescription");
  if (title) title.textContent = mode === "extend" ? "Extend Voting Time" : hasSchedule ? "Edit Election Schedule" : "Create Election Schedule";
  if (description) description.textContent = hasSchedule
    ? (mode === "extend" ? "Choose a later Voting Until time. If needed, result publication moves to the new closing time while keeping its duration. Review the displayed times before saving." : "Update the existing election's dates. Candidates, recorded votes, and turnout are preserved; every saved change is audited.")
    : "Configure the election dates. You can edit the saved schedule later, until the election is finalized.";
  if (els.saveElectionSettingsBtn) els.saveElectionSettingsBtn.textContent = mode === "extend" ? "Save Extended Voting Time" : hasSchedule ? "Save Schedule Changes" : "Save Election Schedule";
  if ($("deleteScheduleFromEditorBtn")) $("deleteScheduleFromEditorBtn").hidden = !hasSchedule || mode === "extend";
  $("electionIdInput").disabled = hasSchedule;
  if (els.electionTitleInput) els.electionTitleInput.disabled = mode === "extend";
  for (const [field,input] of Object.entries(scheduleInputs)) if (input) input.disabled = mode === "extend" && field !== "votingEnd";
  msg("");
  if (typeof dialog.showModal === "function") dialog.showModal(); else dialog.setAttribute("open", "");
  if (mode === "extend") { els.votingEndInput?.focus(); els.votingEndInput?.scrollIntoView({block:"center"}); }
}

function closeScheduleEditor() {
  const dialog = $("scheduleEditorDialog");
  if (!dialog) return;
  if (typeof dialog.close === "function" && dialog.open) dialog.close(); else dialog.removeAttribute("open");
  scheduleFormDirty = false;
}

function fillSchedule(force = false) {
  renderSavedSchedule();
  if (scheduleFormDirty && !force) return;
  populateScheduleEditor({ blank: !context?.scheduleComplete });

  if (els.electionStatusTitle) els.electionStatusTitle.textContent = context?.title || "USC Election";
  if (els.activePhaseBadge) els.activePhaseBadge.textContent = context?.lifecycle || "Not configured";
  if ($("secureLifecycleBadge")) $("secureLifecycleBadge").textContent = context?.lifecycle || "Not configured";
  if ($("secureLifecycleDescription")) $("secureLifecycleDescription").textContent = lifecycleDescription();
  if (els.candidateReviewPhaseBadge) {
    els.candidateReviewPhaseBadge.textContent = context?.reviewOpen ? "Review open · server verified" : "Review locked";
    els.candidateReviewPhaseBadge.classList.toggle("is-active", context?.reviewOpen === true);
  }
  scheduleFormDirty = false;
}

function renderDepartmentTurnout() {
  if (!els.departmentTurnoutList) return;
  const rows = Array.isArray(departmentTurnout?.departments) ? departmentTurnout.departments : [];
  const total = Math.max(0, Number(departmentTurnout?.totalVoters || turnout.ballotsCast || 0));
  if (els.departmentTurnoutTotal) els.departmentTurnoutTotal.textContent = `${total.toLocaleString()} voted`;
  if (!rows.length) {
    els.departmentTurnoutList.innerHTML = `<div class="department-turnout-empty">No department voting activity yet.</div>`;
    return;
  }
  const maxVotes = Math.max(1, ...rows.map((row) => Number(row.voted || 0)));
  els.departmentTurnoutList.innerHTML = rows.map((row, index) => {
    const voted = Math.max(0, Number(row.voted || 0));
    const share = total > 0 ? voted / total * 100 : 0;
    const width = voted > 0 ? Math.max(6, voted / maxVotes * 100) : 0;
    return `<article class="department-turnout-row">
      <div class="department-turnout-row-head"><span><b>${index + 1}</b>${esc(row.department || "Unspecified department")}</span><strong>${voted.toLocaleString()}</strong></div>
      <div class="department-turnout-bar" role="img" aria-label="${esc(row.department || "Unspecified department")}: ${voted} students voted"><i style="width:${width.toFixed(1)}%"></i></div>
      <small>${share.toFixed(1)}% of ballots cast</small>
    </article>`;
  }).join("");
}

function renderStats() {
  const ballots = Number(turnout.ballotsCast || 0);
  const eligible = Number(turnout.eligibleVoters || context?.eligibleVoterCount || 0);
  const percent = eligible > 0 ? Math.min(100, ballots / eligible * 100) : 0;
  // Presentation only: reuse aggregate turnout; never expose candidate choices.
  const pie = $("electionTurnoutPie");
  if (pie) {
    pie.style.background = eligible > 0
      ? `conic-gradient(#35bce3 0% ${percent}%, #e5edf5 ${percent}% 100%)` : '#e5edf5';
    pie.setAttribute('aria-label', eligible > 0 ? `${ballots} voted; ${Math.max(0, eligible - ballots)} not yet voted` : 'No eligible voter data');
  }
  const chartStatus = $("electionTurnoutChartStatus");
  if (chartStatus) chartStatus.textContent = eligible > 0 ? `${percent.toFixed(1)}% turnout · ${ballots} of ${eligible}` : 'No eligible voter data';
  if (els.activeElectionCount) els.activeElectionCount.textContent = electionId ? "01" : "00";
  if (els.candidateCount) els.candidateCount.textContent = String(candidates.filter((c) => !c.removed).length);
  if (els.votesCastCount) els.votesCastCount.textContent = String(ballots);
  if (els.turnoutPercent) els.turnoutPercent.textContent = `${percent.toFixed(1)}%`;
  if (els.turnoutProgressLabel) els.turnoutProgressLabel.textContent = `${ballots} / ${eligible}`;
  if (els.turnoutBar) { els.turnoutBar.style.width = `${percent}%`; els.turnoutBar.textContent = `${percent.toFixed(1)}%`; }
  if (els.turnoutSnapshotText) els.turnoutSnapshotText.textContent = `${ballots} of ${eligible} ballots cast`;
  if (els.candidateSnapshotText) els.candidateSnapshotText.textContent = `${candidates.filter((c) => !c.removed).length} validated`;
  // Deliberately suppress live candidate totals for ordinary officers.
  if (els.presidentAnalytics) els.presidentAnalytics.innerHTML = `<div class="note-box"><strong>Candidate totals protected</strong><p>${context?.lifecycle === "Voting" ? "Voting is active. Only turnout and system health are shown." : "Candidate tallies are available only to an authorized canvasser after finalization."}</p></div>`;
  if (els.viceAnalytics) els.viceAnalytics.innerHTML = `<div class="note-box"><strong>Secret-ballot administration</strong><p>The officer dashboard never displays which student selected which candidate.</p></div>`;
  if (els.electionResultsBody) els.electionResultsBody.innerHTML = `<tr><td colspan="5">${context?.resultsVisible ? "Official published results are available through the secure results record." : "Candidate-level results are not published yet."}</td></tr>`;
}


const candidatePreviewUrlCache = new Map();

async function candidatePrivatePreviewUrl(path) {
  const value = clean(path);
  if (!value) return "";
  if (candidatePreviewUrlCache.has(value)) return candidatePreviewUrlCache.get(value);
  let url = "";
  if (value.startsWith("firestore-media://")) {
    url = await resolveMediaUrl(value);
  } else {
    const result = await callSecure("createPrivateDownloadUrl", { path: value });
    url = clean(result?.url);
  }
  if (!url) throw new Error("The private campaign image could not be loaded.");
  candidatePreviewUrlCache.set(value, url);
  return url;
}

async function hydrateCandidatePreviewImages(root = document) {
  const images = [...(root?.querySelectorAll?.("img[data-private-candidate-image]") || [])];
  await Promise.all(images.map(async (img) => {
    const path = clean(img.dataset.privateCandidateImage);
    if (!path || img.dataset.previewLoaded === "true") return;
    img.dataset.previewLoaded = "loading";
    try {
      img.src = await candidatePrivatePreviewUrl(path);
      img.dataset.previewLoaded = "true";
      img.closest(".candidate-photo-preview, .candidate-preview-photo-frame, .candidate-photo-dialog-stage")?.classList.add("is-loaded");
    } catch (error) {
      console.warn("Candidate campaign photo preview unavailable:", error);
      img.dataset.previewLoaded = "error";
      img.removeAttribute("src");
      img.alt = "Campaign photo preview unavailable";
      img.closest(".candidate-photo-preview, .candidate-preview-photo-frame, .candidate-photo-dialog-stage")?.classList.add("is-error");
    }
  }));
}


function closeCandidatePhotoPreview() {
  const dialog = $("candidatePhotoDialog");
  if (dialog?.open) dialog.close();
}

async function openCandidatePhotoPreview(uid) {
  const application = applications.find((item) => clean(item.id) === clean(uid));
  const dialog = $("candidatePhotoDialog");
  const body = $("candidatePhotoDialogBody");
  if (!application || !dialog || !body) return;

  const name = clean(application.fullName || "Candidate");

  body.innerHTML = application.campaignPhotoPath
    ? `<div class="candidate-photo-dialog-stage">
        <div class="candidate-photo-dialog-loading" aria-label="Loading campaign photo">
          <i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i>
        </div>
        <img data-private-candidate-image="${esc(application.campaignPhotoPath)}" alt="Campaign photo of ${esc(name)}" />
      </div>`
    : `<div class="candidate-photo-dialog-empty"><i class="fa-regular fa-image" aria-hidden="true"></i><strong>No campaign photo</strong></div>`;

  if (dialog.open) dialog.close();
  dialog.showModal();
  await hydrateCandidatePreviewImages(dialog);
}

function previewDetailRow(icon, label, value) {
  return `<div class="candidate-preview-detail-row"><i class="${icon}" aria-hidden="true"></i><span>${esc(label)}</span><strong>${esc(value || "—")}</strong></div>`;
}

function closeCandidatePreview() {
  const dialog = $("candidatePreviewDialog");
  if (dialog?.open) dialog.close();
}

async function submitCandidatePreviewDecision(application, decision, trigger) {
  const approving = decision === "approve";
  const note = prompt(`${approving ? "Approval" : "Rejection"} note (optional):`) || "";
  const buttons = [...document.querySelectorAll("[data-preview-decision]")];
  buttons.forEach((button) => { button.disabled = true; });
  if (trigger) trigger.classList.add("is-working");
  try {
    await callSecure("reviewCandidateApplication", {
      applicantUid: application.id,
      decision,
      reviewNote: note
    });
    closeCandidatePreview();
    await refreshAll();
  } catch (error) {
    alert(error.message);
    buttons.forEach((button) => { button.disabled = false; });
    if (trigger) trigger.classList.remove("is-working");
  }
}

async function removeCandidateApplication(application) {
  const candidate = candidates.find((c) => c.id === application.candidateId);
  if (candidate) return removeElectionCandidate(candidate);
  if (!canManageCandidates || application.status !== "Under Review") return;
  if (!confirm(`Remove the pending application for ${application.fullName}? This action will be audited.`)) return;
  if (!confirm(`Are you absolutely sure you want to remove the pending application for ${application.fullName}?`)) return;
  try {
    await callSecure("removeCandidateApplication", {applicantUid:application.id});
    closeCandidatePreview();
    await refreshAll();
  } catch (error) { alert(error.message); }
}

async function removeElectionCandidate(candidate) {
  if (!canRemoveCandidates || !candidate || candidate.removed) return;
  if (!confirm(`Remove ${candidate.fullName} (${candidate.position || "candidate"}) from this election?`)) return;
  if (!confirm(`Are you absolutely sure you want to remove ${candidate.fullName}? This will hide this candidate from the Student Dashboard candidate list and future ballot choices. Existing votes, audit history, and official results will be preserved.`)) return;
  try {
    await callSecure("removeElectionCandidate", {electionId, candidateId:candidate.id});
    closeCandidatePreview();
    await refreshAll();
  } catch (error) { alert(error.message); }
}

async function deleteRemovedCandidate(candidate) {
  if (!canRemoveCandidates || !candidate || candidate.removed !== true || candidate.managementHidden === true) return;
  if (!confirm(`Delete ${candidate.fullName || "this candidate"} from Candidate Review? The card will disappear from this module. Approval records, votes, official results, and audit history will be retained.`)) return;
  try {
    await callSecure("dismissElectionCandidate", {electionId, candidateId:candidate.id});
    closeCandidatePreview();
    await refreshAll();
  } catch (error) { alert(error.message); }
}

function openCandidateEditor(candidate) {
  if (!canManageCandidates || !candidate || candidate.removed) return;
  let dialog = $("candidateEditDialog");
  if (!dialog) {
    document.body.insertAdjacentHTML("beforeend", `<dialog id="candidateEditDialog" class="candidate-edit-dialog"></dialog>`);
    dialog = $("candidateEditDialog");
  }
  const locked = Date.now() >= Number(context?.votingStart || 0) && Date.now() < Number(context?.votingEnd || 0);
  const fields = [["fullName","Full name",120],["position","Position",80],["department","Department",160],["partylist","Partylist",100],["campaignPhotoUrl","Campaign photo HTTPS URL",1000],["platform","Platform and advocacy",5000]];
  const positions = ["President","Vice President","Secretary","Treasurer","Auditor","Public Relations Officer","Business Manager","Sgt. at Arms","Department Representative"];
  dialog.innerHTML = `<form><h3>Edit Candidate</h3><p>Profile changes do not rewrite historical results. Position and department remain fixed while voting is active.</p>${fields.map(([key,label,max]) => `<label class="field">${label}${key === "position" ? `<select name="${key}" ${locked ? "disabled" : ""}>${positions.map((v) => `<option ${v === candidate.position ? "selected" : ""}>${esc(v)}</option>`).join("")}</select>` : key === "platform" ? `<textarea name="${key}" maxlength="${max}">${esc(candidate[key])}</textarea>` : `<input name="${key}" value="${esc(candidate[key])}" maxlength="${max}" ${key === "fullName" ? "required" : ""} ${key === "department" && locked ? "disabled" : ""}>`}</label>`).join("")}<p role="alert" id="candidateEditError"></p><div class="row-actions"><button type="button" class="mini-btn light" data-cancel>Cancel</button><button type="submit" class="mini-btn primary">Save changes</button></div></form>`;
  dialog.querySelector("[data-cancel]").onclick = () => dialog.close();
  dialog.querySelector("form").onsubmit = async (event) => {
    event.preventDefault();
    const button = dialog.querySelector('[type="submit"]');
    button.disabled = true;
    const details = Object.fromEntries(fields.map(([key]) => [key, dialog.querySelector(`[name="${key}"]`).value]));
    try {
      await callSecure("updateElectionCandidate", {electionId, candidateId:candidate.id, details});
      dialog.close();
      await refreshAll();
    } catch (error) { $("candidateEditError").textContent = error.message; button.disabled = false; }
  };
  dialog.showModal();
}

async function openCandidatePreview(uid) {
  const application = applications.find((item) => clean(item.id) === clean(uid));
  const dialog = $("candidatePreviewDialog");
  const body = $("candidatePreviewBody");
  const footer = $("candidatePreviewFooter");
  if (!application || !dialog || !body || !footer) return;

  const name = clean(application.fullName || "Candidate");
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("") || "C";
  const linkedCandidate = candidates.find((c) => c.id === application.candidateId);
  const status = linkedCandidate?.removed === true ? "Removed" : clean(application.status || "Under Review");
  const statusKey = status.toLowerCase().replace(/\s+/g, "-");
  const canReview = Boolean(canManageCandidates && context?.reviewOpen && status.toLowerCase() === "under review");
  const documents = Array.isArray(application.supportingDocumentPaths) ? application.supportingDocumentPaths : [];

  body.innerHTML = `
    <div class="candidate-preview-grid">
      <section class="candidate-preview-profile-card">
        <div class="candidate-preview-person">
          <div class="candidate-preview-avatar" aria-hidden="true">${esc(initials)}</div>
          <div><h3>${esc(name)}</h3><p>${esc(application.position || "Position not specified")}${application.department ? ` · ${esc(application.department)}` : ""}</p></div>
          <b class="candidate-status-label status-${esc(statusKey)}">${esc(status)}</b>
        </div>
        <div class="candidate-preview-details">
          ${previewDetailRow("fa-regular fa-id-card", "Student ID", application.studentId)}
          ${previewDetailRow("fa-solid fa-graduation-cap", "Program", application.program)}
          ${previewDetailRow("fa-regular fa-building", "College / Campus", application.college)}
          ${previewDetailRow("fa-solid fa-users", "Party / Affiliation", application.partylist || "Independent")}
        </div>
        ${application.platform ? `<div class="candidate-preview-platform"><span>Platform &amp; Advocacy</span><p>${esc(application.platform)}</p></div>` : ""}
      </section>
      <section class="candidate-preview-media-card">
        <div class="candidate-preview-section-title">Campaign Photo</div>
        ${application.campaignPhotoPath ? `
          <div class="candidate-preview-photo-frame">
            <div class="candidate-photo-loading"><i class="fa-regular fa-image"></i><span>Loading private campaign photo…</span></div>
            <img data-private-candidate-image="${esc(application.campaignPhotoPath)}" alt="Campaign photo of ${esc(name)}" />
          </div>` : `<div class="candidate-preview-no-photo"><i class="fa-regular fa-image"></i><span>No campaign photo was submitted.</span></div>`}
        <div class="candidate-preview-section-title candidate-preview-doc-title">Attached Document(s)</div>
        <div class="candidate-preview-documents">
          ${documents.length ? documents.map((path, index) => `<button type="button" class="candidate-preview-document" data-preview-private-path="${esc(path)}"><i class="fa-regular fa-file-lines"></i><span><strong>Document ${index + 1}</strong><small>Private candidate document</small></span><i class="fa-solid fa-arrow-up-right-from-square"></i></button>`).join("") : `<div class="candidate-preview-no-docs">No supporting documents submitted.</div>`}
        </div>
      </section>
    </div>`;

  footer.innerHTML = `
    <div class="candidate-preview-footer-note">${canReview ? `<i class="fa-solid fa-shield-halved"></i> Review the application before recording a decision.` : `<i class="fa-solid fa-lock"></i> ${status.toLowerCase() === "under review" ? "Decisions are available only during the scheduled review window." : `This application is already ${esc(status.toLowerCase())}.`}`}</div>
    <div class="candidate-preview-footer-actions">
      <button class="mini-btn light" type="button" data-candidate-preview-close>Close</button>
      ${canReview ? `<button class="mini-btn danger candidate-preview-return" type="button" data-rbac-permission="elections.review" data-preview-decision="reject"><i class="fa-solid fa-rotate-left"></i> Reject</button><button class="mini-btn primary candidate-preview-approve" type="button" data-rbac-permission="elections.review" data-preview-decision="approve"><i class="fa-solid fa-check"></i> Approve</button>` : ""}
      ${canRemoveCandidates && linkedCandidate?.removed === true && !linkedCandidate.managementHidden ? `<button class="mini-btn danger" type="button" data-delete-removed-candidate="${esc(linkedCandidate.id)}">Delete from Review</button>` : ""}
      ${((canManageCandidates && application.status === "Under Review") || (canRemoveCandidates && candidates.some((c) => c.id === application.candidateId && !c.removed))) ? `<button class="mini-btn danger" type="button" data-remove-candidate="${esc(application.id)}"><i class="fa-solid fa-trash"></i> Remove</button>` : ""}
    </div>`;

  if (dialog.open) dialog.close();
  dialog.showModal();
  dialog.querySelectorAll("[data-candidate-preview-close]").forEach((button) => button.addEventListener("click", closeCandidatePreview));
  dialog.querySelectorAll("[data-preview-private-path]").forEach((button) => button.addEventListener("click", () => openPrivateFile(button.dataset.previewPrivatePath).catch((error) => alert(error.message))));
  dialog.querySelectorAll("[data-preview-decision]").forEach((button) => button.addEventListener("click", () => submitCandidatePreviewDecision(application, button.dataset.previewDecision, button)));
  dialog.querySelector("[data-delete-removed-candidate]")?.addEventListener("click", () => deleteRemovedCandidate(linkedCandidate));
  dialog.querySelector("[data-remove-candidate]")?.addEventListener("click", () => removeCandidateApplication(application));
  await hydrateCandidatePreviewImages(dialog);
}

function renderApplications() {
  const visibleApplications = applications.filter((a) => {
    const candidate = candidates.find((c) => c.id === a.candidateId);
    return !(candidate?.removed === true && candidate.managementHidden === true);
  });
  const counts = { approved: 0, pending: 0, rejected: 0 };
  for (const item of visibleApplications) {
    const status = clean(item.status).toLowerCase();
    if (status === "approved") counts.approved += 1; else if (status === "rejected") counts.rejected += 1; else counts.pending += 1;
  }
  if (els.candidateApplicationTotal) els.candidateApplicationTotal.textContent = String(visibleApplications.length);
  if (els.candidateApprovedTotal) els.candidateApprovedTotal.textContent = String(counts.approved);
  if (els.candidatePendingTotal) els.candidatePendingTotal.textContent = String(counts.pending);
  if (els.candidateRejectedTotal) els.candidateRejectedTotal.textContent = String(counts.rejected);
  if (!els.candidateReviewList) return;
  if (!visibleApplications.length) { els.candidateReviewList.innerHTML = `<div class="review-empty-state">No candidate applications to display for this election.</div>`; return; }
  els.candidateReviewList.innerHTML = visibleApplications.map((a) => {
    const linkedCandidate = candidates.find((c) => c.id === a.candidateId);
    const removed = linkedCandidate?.removed === true;
    const normalizedStatus = removed ? "removed" : clean(a.status || "Under Review").toLowerCase();
    const canReview = canManageCandidates && context?.reviewOpen && normalizedStatus === "under review";
    const status = removed ? "Removed" : esc(a.status || "Under Review");
    const statusKey = normalizedStatus.replace(/\s+/g, "-");
    const name = clean(a.fullName || "Candidate");
    const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("") || "C";
    const documents = Array.isArray(a.supportingDocumentPaths) ? a.supportingDocumentPaths : [];

    return `
      <article class="candidate-review-item">
        <div class="candidate-review-avatar" aria-hidden="true">${esc(initials)}</div>
        <div class="candidate-review-copy">
          <div class="candidate-review-name-row">
            <div>
              <strong>${esc(name)}</strong>
              <span class="candidate-review-position">${esc(a.position || "Position not specified")}${a.department ? ` · ${esc(a.department)}` : ""}</span>
            </div>
            <b class="candidate-status-label status-${esc(statusKey)}">${status}</b>
          </div>
          <div class="candidate-review-meta">
            <span><i class="fa-regular fa-id-card" aria-hidden="true"></i><small>Student ID</small><strong>${esc(a.studentId || "—")}</strong></span>
            <span><i class="fa-solid fa-graduation-cap" aria-hidden="true"></i><small>Program</small><strong>${esc(a.program || "—")}</strong></span>
            ${a.college ? `<span><i class="fa-regular fa-building" aria-hidden="true"></i><small>College / Campus</small><strong>${esc(a.college)}</strong></span>` : ""}
            ${a.partylist ? `<span><i class="fa-solid fa-users" aria-hidden="true"></i><small>Party / Affiliation</small><strong>${esc(a.partylist)}</strong></span>` : ""}
          </div>
        </div>
        <div class="candidate-review-action-panel">
          <span class="candidate-review-action-title"><i class="fa-solid fa-paperclip" aria-hidden="true"></i><span>Attachments & actions</span><em>${documents.length} ${documents.length === 1 ? "document" : "documents"}</em></span>
          <div class="candidate-review-media-row">
            ${a.campaignPhotoPath ? `<button class="candidate-photo-preview" type="button" data-candidate-photo-preview="${esc(a.id)}" aria-label="Preview campaign photo for ${esc(name)}"><div class="candidate-photo-loading"><i class="fa-regular fa-image"></i><span>Campaign photo</span></div><img data-private-candidate-image="${esc(a.campaignPhotoPath)}" alt="Campaign photo of ${esc(name)}" /><span class="candidate-photo-badge"><i class="fa-regular fa-image" aria-hidden="true"></i> Campaign photo</span></button>` : `<div class="candidate-photo-preview is-empty"><i class="fa-regular fa-image"></i><span>No campaign photo</span></div>`}
            <div class="candidate-review-documents">
              <span class="candidate-documents-label">Supporting documents</span>
              ${documents.length ? documents.map((path, index) => `<button type="button" class="mini-btn light candidate-file-btn" data-private-path="${esc(path)}"><i class="fa-regular fa-file-lines candidate-file-icon" aria-hidden="true"></i><span class="candidate-file-copy"><strong>Document ${index + 1}</strong><small>Open secure attachment</small></span><i class="fa-solid fa-arrow-up-right-from-square candidate-file-open-icon" aria-hidden="true"></i></button>`).join("") : `<span class="candidate-no-files"><i class="fa-regular fa-folder-open" aria-hidden="true"></i><span>No supporting documents</span></span>`}
            </div>
          </div>
          <div class="candidate-review-actions">
            <button class="mini-btn ${canReview ? "primary" : "light"} candidate-preview-btn" type="button" data-candidate-preview="${esc(a.id)}"><i class="fa-regular fa-eye" aria-hidden="true"></i><span>${canReview ? "Review application" : "View application"}</span><i class="fa-solid fa-arrow-right candidate-preview-arrow" aria-hidden="true"></i></button>
            ${canManageCandidates && linkedCandidate && !removed ? `<button class="mini-btn light" type="button" data-edit-reviewed-candidate="${esc(linkedCandidate.id)}"><i class="fa-solid fa-pen" aria-hidden="true"></i> Edit</button>` : ""}
            ${canRemoveCandidates && normalizedStatus === "approved" && linkedCandidate ? `<button class="mini-btn danger" type="button" data-remove-approved-candidate="${esc(a.id)}" aria-label="Remove approved candidate ${esc(name)}"><i class="fa-solid fa-trash" aria-hidden="true"></i> Remove</button>` : ""}
            ${canRemoveCandidates && removed ? `<button class="mini-btn danger" type="button" data-delete-removed-candidate="${esc(linkedCandidate.id)}"><i class="fa-solid fa-trash-can" aria-hidden="true"></i> Delete from Review</button>` : ""}
          </div>
          ${removed ? `<small class="candidate-review-lock-note"><i class="fa-solid fa-box-archive" aria-hidden="true"></i><span><strong>Candidate removed</strong> The approval record, existing votes, and official results are preserved.</span></small>` : canReview
            ? `<small class="candidate-review-lock-note is-ready"><i class="fa-solid fa-circle-check" aria-hidden="true"></i><span><strong>Ready for review</strong> Open the application to approve or reject it.</span></small>`
            : normalizedStatus === "approved"
              ? `<small class="candidate-review-lock-note status-approved"><i class="fa-solid fa-circle-check" aria-hidden="true"></i><span><strong>Application approved</strong> This candidate has already been approved.</span></small>`
              : normalizedStatus === "rejected"
                ? `<small class="candidate-review-lock-note status-rejected"><i class="fa-solid fa-circle-xmark" aria-hidden="true"></i><span><strong>Application rejected</strong> This application is already closed.</span></small>`
                : `<small class="candidate-review-lock-note status-pending"><i class="fa-solid fa-clock" aria-hidden="true"></i><span><strong>Awaiting review window</strong> Review actions will unlock during the scheduled review period.</span></small>`}
        </div>
      </article>`;
  }).join("");
  els.candidateReviewList.querySelectorAll("[data-delete-removed-candidate]").forEach((btn) => btn.addEventListener("click", () => deleteRemovedCandidate(candidates.find((c) => c.id === btn.dataset.deleteRemovedCandidate))));
  els.candidateReviewList.querySelectorAll("[data-edit-reviewed-candidate]").forEach((btn) => btn.addEventListener("click", () => openCandidateEditor(candidates.find((c) => c.id === btn.dataset.editReviewedCandidate))));
  els.candidateReviewList.querySelectorAll("[data-remove-approved-candidate]").forEach((btn) => btn.addEventListener("click", () => removeCandidateApplication(applications.find((a) => a.id === btn.dataset.removeApprovedCandidate))));
  els.candidateReviewList.querySelectorAll("[data-private-path]").forEach((btn) => btn.addEventListener("click", () => openPrivateFile(btn.dataset.privatePath).catch((e) => alert(e.message))));
  els.candidateReviewList.querySelectorAll("[data-candidate-photo-preview]").forEach((btn) => btn.addEventListener("click", () => openCandidatePhotoPreview(btn.dataset.candidatePhotoPreview).catch((e) => alert(e.message))));
  els.candidateReviewList.querySelectorAll("[data-candidate-preview]").forEach((btn) => btn.addEventListener("click", () => openCandidatePreview(btn.dataset.candidatePreview).catch((e) => alert(e.message))));
  hydrateCandidatePreviewImages(els.candidateReviewList).catch((error) => console.warn("Candidate image previews unavailable:", error));
}
function schedulePayload() {
  const schedule = {};
  for (const [field,input] of Object.entries(scheduleInputs)) {
    if (!input?.value) throw new Error(`Please complete ${field}.`);
    schedule[field] = new Date(input.value).toISOString();
  }
  return schedule;
}

function previewVotingExtension() {
  const original = scheduleEditorOriginal;
  if (!original) throw new Error("Open the saved election schedule first.");
  const base = Object.fromEntries(Object.keys(scheduleInputs).map((key)=>[key,new Date(Number(original[key])).toISOString()]));
  const proposed = extendVotingSchedule({...base,votingEnd:new Date(els.votingEndInput.value).toISOString()},original.votingEnd);
  scheduleInputs.resultPublicationStart.value = asLocalInput(new Date(proposed.resultPublicationStart).getTime());
  scheduleInputs.resultPublicationEnd.value = asLocalInput(new Date(proposed.resultPublicationEnd).getTime());
  msg("Review the new Voting Until and Result Publication times, then save. Existing votes remain recorded.");
  return proposed;
}

async function saveSchedule() {
  setButtonState(els.saveElectionSettingsBtn, true);
  msg("Validating the schedule update...");
  try {
    const id = clean($("electionIdInput")?.value).toLowerCase();
    const schedule = scheduleEditorMode === "extend" ? previewVotingExtension() : schedulePayload();
    if (scheduleEditorOriginal && !confirm(`Save the updated schedule for ${scheduleEditorOriginal.title || id}?\nVoting closes: ${new Date(schedule.votingEnd).toLocaleString()}\nResult publication: ${new Date(schedule.resultPublicationStart).toLocaleString()} → ${new Date(schedule.resultPublicationEnd).toLocaleString()}\nExisting candidates, votes, and turnout will be preserved.`)) return;
    const result = await callSecure("saveElectionSchedule", {
      electionId: id,
      title: clean(els.electionTitleInput?.value) || "USC General Election",
      schedule,
      ...(scheduleEditorVersion === null ? {} : {expectedScheduleVersion:scheduleEditorVersion})
    });
    electionId = result.electionId;
    msg(`Election ${result.electionId} saved. Lifecycle: ${result.lifecycle}.`, "success");
    scheduleFormDirty = false;
    await refreshAll(true);
    setTimeout(closeScheduleEditor, 350);
  } catch (error) {
    msg(error.message || "Unable to save schedule.", "error");
  } finally {
    setButtonState(els.saveElectionSettingsBtn, false);
  }
}

async function deleteCurrentSchedule() {
  if (!electionId || !context?.scheduleComplete) return alert("There is no saved schedule to delete.");
  if (context.finalized || context.resultsPublished || context.archived) return alert("A finalized, published-result, or archived election schedule cannot be deleted.");
  if (!confirm("Delete the current saved election schedule? The action will be recorded in the audit trail. Candidate and turnout records are preserved, but there will be no active schedule until a new one is saved.")) return;
  const buttons = [$("deleteCurrentScheduleBtn"), $("deleteScheduleFromEditorBtn")];
  buttons.forEach((button) => setButtonState(button, true));
  try {
    await callSecure("deleteElectionSchedule", { electionId });
    closeScheduleEditor();
    context = null;
    electionId = "";
    scheduleFormDirty = false;
    await refreshAll(true);
  } catch (error) {
    alert(error.message || "Unable to delete the schedule.");
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i=0;i<text.length;i++) {
    const c=text[i], n=text[i+1];
    if (c==='"' && quoted && n==='"') { cell+='"'; i++; continue; }
    if (c==='"') { quoted=!quoted; continue; }
    if (c===',' && !quoted) { row.push(cell); cell=""; continue; }
    if ((c==='\n' || c==='\r') && !quoted) { if (c==='\r' && n==='\n') i++; row.push(cell); cell=""; if (row.some((v)=>v.trim())) rows.push(row); row=[]; continue; }
    cell+=c;
  }
  if (cell || row.length) { row.push(cell); if (row.some((v)=>v.trim())) rows.push(row); }
  if (rows.length < 2) return [];
  const headers = rows[0].map((h)=>h.trim());
  return rows.slice(1).map((values)=>Object.fromEntries(headers.map((h,i)=>[h,(values[i]||"").trim()])));
}


function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadIssuedCredentials(rows) {
  const header = ["studentId","fullName","institutionalEmail","temporaryPassword"];
  const csv = [header.join(","), ...rows.map((row) => header.map((key) => csvEscape(row[key])).join(","))].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `SSU_School_Account_Credentials_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importMasterlist() {
  const input = $("masterlistCsvInput"), message = $("masterlistImportMessage"), button = $("importMasterlistBtn");
  const file = input?.files?.[0];
  if (!file) return message.textContent = "Choose a CSV file first.";
  if (!electionId) return message.textContent = "Create/save the election schedule before importing its voter roster.";
  button.disabled = true;
  try {
    const rows = parseCsv(await file.text());
    if (!rows.length) throw new Error("CSV has no data rows.");
    const ids = rows.map((row) => clean(row.studentId));
    const duplicateIds = [...new Set(ids.filter((id, index) => id && ids.indexOf(id) !== index))];
    if (duplicateIds.length) throw new Error(`Duplicate Student ID(s) found in the CSV: ${duplicateIds.slice(0, 8).join(", ")}${duplicateIds.length > 8 ? "…" : ""}`);
    const started = await callSecure("startVoterRosterImport", { electionId });
    const importId = started.importId;
    let imported=0;
    for (let i=0;i<rows.length;i+=200) {
      const result = await callSecure("importVoterMasterlist", { electionId, importId, rows: rows.slice(i,i+200) });
      imported += result.imported;
      message.textContent = `Secure import ${importId}: ${imported} of ${rows.length} rows staged...`;
    }
    const finalized = await callSecure("finalizeVoterRosterImport", { electionId, importId });
    message.textContent = `Roster finalized. Provisioning school login accounts...`;
    const issuedCredentials = [];
    let provisioned = 0;
    let newlyIssued = 0;
    for (let i=0;i<rows.length;i+=100) {
      const provision = await callSecure("provisionSchoolAccounts", { rows: rows.slice(i,i+100) });
      provisioned += Number(provision.processed || 0);
      newlyIssued += Number(provision.created || 0);
      if (Array.isArray(provision.credentials)) issuedCredentials.push(...provision.credentials);
      message.textContent = `School accounts: ${provisioned} of ${rows.length} synchronized...`;
    }
    if (issuedCredentials.length) downloadIssuedCredentials(issuedCredentials);
    message.textContent = `Completed: ${finalized.rows} roster rows, ${finalized.eligibleVoterCount} eligible voters, ${provisioned} school accounts synchronized, ${newlyIssued} new/default passwords issued.${issuedCredentials.length ? " A private credential CSV was downloaded for distribution." : ""}`;
    await refreshAll();
  } catch (error) { message.textContent = error.message || "Masterlist import failed."; }
  finally { button.disabled = false; }
}

async function lifecycleAction(name) {
  const el = $("lifecycleActionMessage");
  try {
    const result = await callSecure(name);
    el.textContent = `${name}: completed for ${result.electionId || electionId}.`;
    await refreshAll();
  } catch (error) { el.textContent = error.message || `${name} failed.`; }
}

async function showTallies() {
  if (!electionId) return;
  const canCanvass = trustedClaims.role === "admin" || trustedClaims.canvasser === true;
  if (!canCanvass || !["Canvassing","Results Published","Archived"].includes(context?.lifecycle)) return alert("Candidate-level tallies are restricted to authorized canvassing personnel after finalization.");
  try {
    const official = await getDoc(doc(db, "elections", electionId, "results", "official"));
    if (official.exists() && Array.isArray(official.data().results)) {
      const rows = official.data().results;
      return alert(rows.map((r)=>`${r.position}: ${r.fullName} — ${Number(r.votes||0)}`).join("\n") || "No tallies recorded.");
    }
    const [ballots, candidateSnap] = await Promise.all([
      getDocs(collection(db, "elections", electionId, "ballots")),
      getDocs(collection(db, "elections", electionId, "candidates"))
    ]);
    const counts = new Map();
    ballots.forEach((d)=>Object.values(d.data().selections||{}).forEach((id)=>counts.set(String(id),(counts.get(String(id))||0)+1)));
    const rows = candidateSnap.docs.filter((d)=>d.data().approved===true).map((d)=>({ ...(d.data().resultIdentity || d.data()), id:d.id, votes:counts.get(d.id)||0 })).sort((a,b)=>clean(a.position).localeCompare(clean(b.position)) || Number(b.votes||0)-Number(a.votes||0));
    alert(rows.map((r)=>`${r.position}: ${r.fullName} — ${Number(r.votes||0)}`).join("\n") || "No tallies recorded.");
  } catch (error) { alert(error.message || "Tallies are not available."); }
}

function exportSummary() {
  const safe = {
    electionId,
    title: context?.title || "USC Election",
    lifecycle: context?.lifecycle || "Unavailable",
    ballotsCast: Number(turnout.ballotsCast || 0),
    eligibleVoters: Number(turnout.eligibleVoters || context?.eligibleVoterCount || 0),
    candidateCount: candidates.length,
    generatedAt: new Date().toISOString(),
    note: "This administrative export intentionally excludes voter identities, ballot selections, and unpublished candidate tallies."
  };
  callSecure("recordAdminAuditAction", { action: "ADMIN_EXPORT", target: `${electionId || "usc-election"}-turnout-summary.json`, details: { electionId, lifecycle: context?.lifecycle || "Unavailable", exportType: "turnout-summary" } })
    .catch((error) => console.warn("Unable to record export audit event:", error));
  const blob = new Blob([JSON.stringify(safe,null,2)], {type:"application/json"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=`${electionId || "usc-election"}-turnout-summary.json`; a.click(); URL.revokeObjectURL(a.href);
}

async function refreshAll(forceSchedule = false) {
  await loadContext();
  await loadData();

  const masterlistCard = $("masterlistImportCard");
  if (masterlistCard) masterlistCard.hidden = trustedClaims.role !== "admin";

  fillSchedule(forceSchedule);
  renderStats();
  renderDepartmentTurnout();
  renderApplications();

  const finalize = $("finalizeElectionBtn");
  const publish = $("publishResultsBtn");
  const archive = $("archiveElectionBtn");
  const canCanvass = trustedClaims.role === "admin" || trustedClaims.canvasser === true;
  setButtonState(finalize, !canCanvass || !context || !["Voting Closed", "Canvassing"].includes(context.lifecycle));
  setButtonState(publish, !canCanvass || context?.lifecycle !== "Canvassing");
  setButtonState(archive, trustedClaims.role !== "admin" || context?.lifecycle !== "Results Published");
  renderSavedSchedule();
}

installHardeningPanels();
/* =========================================================
   PROTECT UNSAVED ELECTION SCHEDULE
   ========================================================= */

[
  els.electionTitleInput,
  $("electionIdInput"),
  ...Object.values(scheduleInputs)
]
.filter(Boolean)
.forEach((input) => {

  input.addEventListener(
    "input",
    markScheduleDirty
  );

  input.addEventListener(
    "change",
    markScheduleDirty
  );

});
{
  const tokenClaims = (await auth.currentUser?.getIdTokenResult(true))?.claims || {};
  const profileSnap = auth.currentUser ? await getDoc(doc(db, "users", auth.currentUser.uid)).catch(() => null) : null;
  const profile = profileSnap?.exists?.() ? profileSnap.data() : {};
  canManageCandidates = effectiveOfficerPermissions(profile).includes("elections.review") || String(tokenClaims.role || profile.role).toLowerCase() === "admin";
  canRemoveCandidates = canManageCandidates || effectiveOfficerPermissions(profile).includes("elections.view");
  trustedClaims = {
    ...tokenClaims,
    role: String(tokenClaims.role || profile.role || "").toLowerCase(),
    canvasser: tokenClaims.canvasser === true || profile.canvasser === true
  };
}
els.saveElectionSettingsBtn?.addEventListener("click", saveSchedule);
$("extendVotingBtn")?.addEventListener("click", () => openScheduleEditor("extend"));
els.votingEndInput?.addEventListener("change", () => {
  if (scheduleEditorMode !== "extend") return;
  try { previewVotingExtension(); } catch (error) { msg(error.message,"error"); }
});
$("editScheduleBtn")?.addEventListener("click", () => openScheduleEditor("edit"));
$("createNewScheduleBtn")?.addEventListener("click", () => openScheduleEditor("create"));
$("deleteCurrentScheduleBtn")?.addEventListener("click", deleteCurrentSchedule);
$("deleteScheduleFromEditorBtn")?.addEventListener("click", deleteCurrentSchedule);
$("closeScheduleEditorBtn")?.addEventListener("click", closeScheduleEditor);
$("cancelScheduleEditorBtn")?.addEventListener("click", closeScheduleEditor);
$("candidatePhotoDialogCloseBtn")?.addEventListener("click", closeCandidatePhotoPreview);
$("candidatePhotoDialogDoneBtn")?.addEventListener("click", closeCandidatePhotoPreview);
$("candidatePhotoDialog")?.addEventListener("click", (event) => {
  if (event.target === $("candidatePhotoDialog")) closeCandidatePhotoPreview();
});
$("candidatePreviewCloseBtn")?.addEventListener("click", closeCandidatePreview);
$("candidatePreviewDialog")?.addEventListener("click", (event) => {
  if (event.target === $("candidatePreviewDialog")) closeCandidatePreview();
});
$("scheduleEditorDialog")?.addEventListener("click", (event) => {
  if (event.target === $("scheduleEditorDialog")) closeScheduleEditor();
});
$("importMasterlistBtn")?.addEventListener("click", importMasterlist);
$("finalizeElectionBtn")?.addEventListener("click", () => lifecycleAction("finalizeElection"));
$("publishResultsBtn")?.addEventListener("click", () => lifecycleAction("publishElectionResults"));
$("archiveElectionBtn")?.addEventListener("click", () => lifecycleAction("archiveElection"));
els.viewFullTallyBtn?.addEventListener("click", showTallies);
els.exportSummaryBtn?.addEventListener("click", exportSummary);
$("openScheduleManagerBtn")?.addEventListener("click", () => openScheduleEditor(context?.scheduleComplete ? "edit" : "create"));
$("scrollToCandidateReviewBtn")?.addEventListener("click", () => document.getElementById("candidateReviewCard")?.scrollIntoView({behavior:"smooth",block:"start"}));
await refreshAll();
setInterval(() => refreshAll().catch(console.error), 30000);
