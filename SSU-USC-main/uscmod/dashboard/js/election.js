import { auth, db } from "../../firebase/firebase-config.js";
import { callSecure, secureUpload, hydrateMediaImages } from "../../shared/security-client.js";
import {
  collection,
  doc,
  getDoc,
  getDocs
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import { signOut } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";

const uscAuthAllowed = await (globalThis.USC_AUTH_READY || Promise.resolve(false));
if (uscAuthAllowed !== true) await new Promise(() => {});


const app = document.getElementById("electionApp");
const POSITION_ORDER = [
  "President", "Vice President", "Secretary", "Treasurer", "Auditor",
  "Public Relations Officer (PRO)", "Business Manager", "Sgt. at Arms", "Department Representative"
];
const PHASES = [
  ["Registration", "registrationStart", "registrationEnd"],
  ["Review", "applicationReviewStart", "applicationReviewEnd"],
  ["Candidates", "candidatePublicationStart", "candidatePublicationEnd"],
  ["Voting", "votingStart", "votingEnd"],
  ["Results", "resultPublicationStart", "resultPublicationEnd"]
];
let student = null;
let context = null;
let application = null;
let candidates = [];
let voterStatus = null;
let turnout = { ballotsCast: 0, eligibleVoters: 0 };
let currentView = "landing";
let candidateRegistrationStep = 1;
let candidateDraft = null;

function createCandidateDraft() {
  return {
    position: "",
    partylist: "",
    platform: "",
    statement: "",
    photoFile: null,
    supportingFiles: []
  };
}

function clean(v, fallback = "") { return String(v ?? fallback).trim(); }
function esc(v) { return clean(v).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]); }
function sessionProfile() { try { return JSON.parse(sessionStorage.getItem("studentProfile") || "null"); } catch { return null; } }
function formatTime(ms) {
  if (!ms) return "Not set";
  const d = new Date(Number(ms));
  return d.toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}
function phaseMessage() {
  if (!context) return "Election services temporarily unavailable.";
  const map = {
    Draft: "Election schedule configured. Sensitive actions remain locked.",
    Registration: "Candidate registration is open.",
    Review: "Candidate applications are being reviewed.",
    Published: "Approved candidates have been published.",
    Voting: "Official voting is open.",
    "Voting Closed": "Voting has closed. Ballots are awaiting finalization and canvassing.",
    Canvassing: "The election has been finalized and is under canvassing.",
    "Results Published": "Official election results have been published.",
    Archived: "This election is archived."
  };
  return map[context.lifecycle] || "Election information is available.";
}
function electionActionEligibility() {
  if (!student) return { allowed: false, reason: "closed", message: "Election is not open." };
  if (student.electionEligibilityUnavailable === true || !context?.electionId) {
    return { allowed: false, reason: "closed", message: "Election is not open." };
  }
  // Every active, approved school-provisioned student can vote. Candidacy approval
  // is a separate administrator-controlled permission.
  return { allowed: true, reason: "eligible", message: "" };
}

function eligibilityNotice() {
  const eligibility = electionActionEligibility();
  const redirectedMessage = sessionStorage.getItem("electionAccessMessage") || "";
  if (redirectedMessage) sessionStorage.removeItem("electionAccessMessage");
  if (eligibility.allowed) return "";
  const message = redirectedMessage || eligibility.message || "Election is not open.";
  return `<div class="election-eligibility-compact" role="status"><i class="fa-solid fa-circle-info" aria-hidden="true"></i><span>${esc(message)}</span></div>`;
}

function photo(candidate) {
  return clean(
    candidate.campaignPhotoUrl ||
    candidate.campaignPhoto ||
    candidate.campaignPhotoPath ||
    candidate.photoUrl ||
    candidate.profilePhotoUrl ||
    candidate.imageUrl ||
    candidate.photoURL ||
    candidate.photo
  ) || "assets/USClogo.webp";
}
function candidatesFor(position) {
  return candidates.filter((c) => c.position === position && c.approved !== false && (position !== "Department Representative" || clean(c.department) === clean(student.college)));
}

async function loadSecureState() {
  const liveProfileId = student?.uid || auth.currentUser?.uid || "";
  if (liveProfileId) {
    const liveProfileSnap = await getDoc(doc(db, "users", liveProfileId));
    if (liveProfileSnap.exists()) {
      const liveProfile = liveProfileSnap.data();
      student = { ...student, ...liveProfile, uid: liveProfileId, candidacyApproved: liveProfile.candidacyApproved === true };
      sessionStorage.setItem("studentProfile", JSON.stringify({ ...sessionProfile(), candidacyApproved: student.candidacyApproved }));
    }
  }
  context = await callSecure("getElectionContext");
  const electionId = context.electionId;
  if (!electionId) {
    application = null;
    voterStatus = null;
    candidates = [];
    turnout = { ballotsCast: 0, eligibleVoters: 0 };
    return;
  }
  const [appSnap, statusSnap, turnoutSnap] = await Promise.all([
    getDoc(doc(db, "elections", electionId, "applications", student.uid)),
    getDoc(doc(db, "elections", electionId, "voterStatus", student.uid)),
    getDoc(doc(db, "elections", electionId, "turnout", "public"))
  ]);
  application = appSnap.exists() ? { id: appSnap.id, ...appSnap.data() } : null;
  voterStatus = statusSnap.exists() ? statusSnap.data() : null;
  turnout = turnoutSnap.exists() ? turnoutSnap.data() : { ballotsCast: 0, eligibleVoters: context.eligibleVoterCount || 0 };
  if (context.candidateVisible) {
    const snap = await getDocs(collection(db, "elections", electionId, "candidates"));
    candidates = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((c) => c.approved !== false);
  } else {
    candidates = [];
  }
}

function timeline() {
  if (!context) return `<div class="election-phase-legacy"><strong>Election services unavailable</strong><span>Sensitive election actions are locked until the server can verify the active election.</span></div>`;
  return `<div class="election-phase-timeline">${PHASES.map(([label,start,end]) => `<div class="election-phase-step ${context.lifecycle.toLowerCase().includes(label.toLowerCase().split(" ")[0]) ? "active" : ""}"><span>${esc(label)}</span><small>${esc(formatTime(context[start]))}<br>to ${esc(formatTime(context[end]))}</small></div>`).join("")}</div>`;
}

function detailsCard() {
  return `<aside class="candidate-registration-details">
    <h3><i class="fa-regular fa-calendar-days" aria-hidden="true"></i> Election Details</h3>
    <dl>
      <div><dt>Election Name</dt><dd>${esc(context?.title || "University Student Council Election")}</dd></div>
      <div><dt>Registration Period</dt><dd>${esc(formatTime(context?.registrationStart))}<br>– ${esc(formatTime(context?.registrationEnd))}</dd></div>
      <div><dt>Election Date</dt><dd>${esc(formatTime(context?.votingStart))}</dd></div>
    </dl>
    <button type="button" class="candidate-details-link" id="registrationElectionDetails">View Election Details <i class="fa-solid fa-arrow-right"></i></button>
  </aside>`;
}

function candidateStepper(step) {
  return `<div class="candidate-registration-stepper" aria-label="Candidate registration progress">
    ${[1,2,3,4].map((number) => `<div class="candidate-registration-step ${number < step ? "done" : ""} ${number === step ? "active" : ""}"><span>${number}</span></div>`).join("")}
  </div>`;
}

function registrationShell(step, body) {
  return `<section class="candidate-registration-page">
    <div class="candidate-registration-heading">
      <span>Election</span>
      <h2>Candidate Registration</h2>
    </div>
    ${candidateStepper(step)}
    <div class="candidate-registration-layout">
      <section class="candidate-registration-card">
        <div class="candidate-registration-tip">
          <i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>
          <div><strong>Before you start</strong><span>Please make sure you meet all the qualifications and have the required documents ready.</span></div>
        </div>
        ${body}
      </section>
      ${detailsCard()}
    </div>
  </section>`;
}

function candidatePhotoPreviewUrl() {
  if (!candidateDraft?.photoFile) return "assets/USClogo.webp";
  try { return URL.createObjectURL(candidateDraft.photoFile); } catch { return "assets/USClogo.webp"; }
}

function candidateReviewDocumentRows() {
  const docs = candidateDraft?.supportingFiles || [];
  if (!docs.length) return `<span class="candidate-review-empty">No supporting documents added</span>`;
  return docs.map((file) => `<div class="candidate-review-document"><i class="fa-regular fa-file-pdf"></i><span>${esc(file.name)}</span><i class="fa-solid fa-circle-check"></i></div>`).join("");
}

function wireRegistrationDetailsButton() {
  document.getElementById("registrationElectionDetails")?.addEventListener("click", renderLanding);
}

function failClosed(error) {
  console.error(error);
  context = null;
  currentView = "unavailable";
  app.innerHTML = `<section class="registration-card" style="max-width:860px;margin:35px auto"><div class="registration-tip"><i class="fa-solid fa-shield-halved"></i><div><strong>Election services temporarily unavailable</strong><span>The system could not verify the active election with the server. Registration, voting, and results remain locked. Please try again.</span></div></div><div class="registration-actions"><button class="btn-next" id="retryElection">Try Again</button></div></section>`;
  document.getElementById("retryElection")?.addEventListener("click", initialize);
}

function electionSchedulePreview() {
  if (!context?.scheduleComplete) return "";

  const now = Number(context?.serverNowMs || Date.now());
  const phases = PHASES
    .map(([label, startField, endField], index) => ({
      label,
      start: Number(context?.[startField] || 0),
      end: Number(context?.[endField] || 0),
      index
    }))
    .filter((phase) => phase.start > 0 && phase.end > 0);

  if (!phases.length) return "";

  const nextPhase = phases.find((phase) => now < phase.start);
  const rows = phases.map((phase) => {
    const active = now >= phase.start && now < phase.end;
    const complete = now >= phase.end;
    const next = !active && !complete && nextPhase?.index === phase.index;
    const stateClass = active ? "is-active" : complete ? "is-complete" : next ? "is-next" : "is-upcoming";
    const stateLabel = active ? "In progress" : complete ? "Completed" : next ? "Next" : "Upcoming";

    return `<article class="election-public-schedule-phase ${stateClass}">
      <div class="election-public-schedule-phase-top">
        <span class="election-public-schedule-number">${phase.index + 1}</span>
        <span class="election-public-schedule-state">${esc(stateLabel)}</span>
      </div>
      <strong>${esc(phase.label)}</strong>
      <span class="election-public-schedule-date"><i class="fa-regular fa-calendar-days" aria-hidden="true"></i>${esc(formatTime(phase.start))}</span>
      <span class="election-public-schedule-date"><i class="fa-regular fa-clock" aria-hidden="true"></i>Until ${esc(formatTime(phase.end))}</span>
    </article>`;
  }).join("");

  return `<section class="election-public-schedule" aria-label="Official election schedule">
    <div class="election-public-schedule-head">
      <div class="election-public-schedule-head-icon" aria-hidden="true"><i class="fa-solid fa-calendar-check"></i></div>
      <div>
        <span>Official Election Schedule</span>
        <h3>${esc(context?.title || "USC Election")}</h3>
      </div>
      <span class="election-public-schedule-live"><span></span> Live schedule</span>
    </div>
    <div class="election-public-schedule-grid">${rows}</div>
  </section>`;
}

function renderElectionBlockingState(message, reason = "closed") {
  app.classList.add("election-ineligible-active");

  const lifecycle = clean(context?.lifecycle);
  const statusLabel = lifecycle || (reason === "closed" ? "Election inactive" : "Election access");
  const supportingCopy = lifecycle
    ? phaseMessage()
    : "Candidate profiles, voting, and official election results will appear here once the election period opens.";
  const footerCopy = lifecycle === "Archived"
    ? "This election cycle is no longer active."
    : context?.scheduleComplete
      ? "Follow the official schedule below for the next election phase."
      : "Check back during the official election schedule.";

  app.innerHTML = `<section class="election-page-shell election-page-ineligible" data-election-state="${esc(reason)}">
    <div class="election-hero election-ineligible-hero">
      <div class="election-ineligible-stack">
        <div class="election-ineligible-overlay-message election-ineligible-polish" role="status" aria-live="polite">
          <div class="election-ineligible-status">
            <span class="election-ineligible-status-dot" aria-hidden="true"></span>
            <span>${esc(statusLabel)}</span>
          </div>
          <div class="election-ineligible-icon" aria-hidden="true">
            <i class="fa-solid fa-lock"></i>
          </div>
          <span class="election-ineligible-kicker">SSU University Student Council</span>
          <h2>${esc(message)}</h2>
          <p>${esc(supportingCopy)}</p>
          <div class="election-ineligible-note">
            <i class="fa-regular fa-calendar" aria-hidden="true"></i>
            <span>${esc(footerCopy)}</span>
          </div>
        </div>
        ${electionSchedulePreview()}
      </div>
    </div>
  </section>`;
}

function renderLanding() {
  currentView = "landing";
  app.classList.remove("election-ineligible-active");
  const eligibility = electionActionEligibility();
  if (!eligibility.allowed) {
    renderElectionBlockingState(eligibility.message, eligibility.reason);
    return;
  }

  // The election is considered open to students when at least one public/interactive
  // phase is active. Registration controls candidacy only; voting remains available
  // to every active student during the voting window.
  const electionOpen = Boolean(
    context?.registrationOpen || context?.candidateVisible || context?.votingOpen || context?.resultsVisible
  );
  if (!electionOpen) {
    renderElectionBlockingState("Election is not open.", "closed");
    return;
  }

  const hasApplication = Boolean(application);
  const candidacyApproved = student?.candidacyApproved === true;
  const secondaryActions = [];
  let applicationAction = "";

  if (context?.registrationOpen) {
    const label = hasApplication
      ? "Already Registered"
      : candidacyApproved
        ? "Register as Candidate"
        : "Candidacy Approval Required";
    applicationAction = `<button type="button" class="election-reference-primary" id="landingApplication" ${(!hasApplication && !candidacyApproved) ? "disabled" : ""}>${esc(label)}</button>`;
  }

  if (context?.candidateVisible) secondaryActions.push(`<button type="button" class="election-reference-secondary" id="landingCandidates">View Candidates</button>`);
  if (context?.votingOpen) secondaryActions.push(`<button type="button" class="election-reference-secondary" id="landingVote" ${voterStatus?.hasVoted ? "disabled" : ""}>${voterStatus?.hasVoted ? "Already Voted" : "Vote Now"}</button>`);
  if (context?.resultsVisible) secondaryActions.push(`<button type="button" class="election-reference-secondary" id="landingResults">View Results</button>`);

  app.innerHTML = `<section class="election-reference-landing">
    <div class="election-reference-landing-bg" aria-hidden="true"></div>
    <div class="election-reference-landing-shade" aria-hidden="true"></div>
    <div class="election-ineligible-stack">
      <div class="election-reference-landing-content">
        <div class="election-ineligible-status"><span class="election-ineligible-status-dot"></span>${esc(context?.lifecycle || "Election open")}</div>
        <img class="election-reference-logo" src="assets/USClogo.webp" alt="University Student Council seal">
        <span class="election-ineligible-kicker">SSU University Student Council</span>
        <h2>${esc(context?.title || "USC Election")}</h2>
        <p>${esc(phaseMessage())}</p>
        <div class="election-reference-actions">
          ${applicationAction}
          ${secondaryActions.join("")}
        </div>
      </div>
      ${electionSchedulePreview()}
    </div>
  </section>`;

  document.getElementById("landingApplication")?.addEventListener("click", () => {
    if (application) renderApplicationStatus();
    else if (context?.registrationOpen && student?.candidacyApproved === true) renderRegistration(1, true);
  });
  document.getElementById("landingCandidates")?.addEventListener("click", renderCandidates);
  document.getElementById("landingVote")?.addEventListener("click", () => { if (!voterStatus?.hasVoted) renderBallot(); });
  document.getElementById("landingResults")?.addEventListener("click", renderResults);
}

function renderRegistration(step = 1, resetDraft = false) {
  if (!electionActionEligibility().allowed || !context?.registrationOpen || student?.candidacyApproved !== true) return renderLanding();
  if (resetDraft || !candidateDraft) candidateDraft = createCandidateDraft();
  currentView = "registration";
  candidateRegistrationStep = Math.max(1, Math.min(4, Number(step) || 1));

  const standing = clean(student.studentStandingLabel || student.studentStanding || student.enrollmentStatus, "Active / Enrolled");
  const contact = clean(student.contactNumber || student.phoneNumber || student.phone, "Not provided");
  const status = clean(student.status || student.accountStatus, "Verified Student");
  const email = clean(student.email || student.institutionalEmail, "Institutional email on file");

  let body = "";
  if (candidateRegistrationStep === 1) {
    body = `<div class="candidate-registration-body">
      <h3>PERSONAL INFORMATION <span>(auto-filled)</span></h3>
      <div class="candidate-personal-grid">
        <label>Student ID<input value="${esc(student.studentId)}" readonly></label>
        <label>Contact Number<input value="${esc(contact)}" readonly></label>
        <label>Full Name<input value="${esc(student.fullName)}" readonly></label>
        <label>Status<input value="${esc(status)}" readonly></label>
        <label>Email<input value="${esc(email)}" readonly></label>
        <label>Enrollment Status<input value="${esc(standing)}" readonly></label>
        <label>Program / Course<input value="${esc(student.program || "Verified program")}" readonly></label>
        <div class="candidate-eligibility-check">
          <strong>Eligibility Check</strong>
          <span><i class="fa-solid fa-circle-check"></i> You are an enrolled student.</span>
          <span><i class="fa-solid fa-circle-check"></i> All active students are eligible to vote.</span>
          <span><i class="fa-solid fa-circle-check"></i> Your candidacy registration is approved by the System Administrator.</span>
          <span><i class="fa-solid fa-circle-check"></i> Candidate registration is open.</span>
          <span><i class="fa-solid fa-circle-check"></i> Your verified college is ${esc(student.college || "on file")}.</span>
          <div>You are eligible to apply!<br>Click “Next” to continue your application.</div>
        </div>
        <label>Year Level<input value="${esc(student.yearLevel || "Not specified")}" readonly></label>
      </div>
      <div class="candidate-registration-actions"><span></span><button class="candidate-next-btn" type="button" id="candidateNext">Next <i class="fa-solid fa-chevron-right"></i></button></div>
    </div>`;
  } else if (candidateRegistrationStep === 2) {
    body = `<div class="candidate-registration-body">
      <h3>PLATFORM &amp; DOCUMENTATION</h3>
      <div class="candidate-step-two-grid">
        <label class="candidate-wide-field">Position Applying for:
          <select id="candidatePosition" required><option value="">Choose a position</option>${POSITION_ORDER.map((p) => `<option value="${esc(p)}" ${candidateDraft.position === p ? "selected" : ""}>${esc(p)}</option>`).join("")}</select>
        </label>
        <label class="candidate-wide-field">Party / Affiliation <span>(optional)</span><input id="candidateParty" maxlength="100" value="${esc(candidateDraft.partylist)}" placeholder="Independent or party name"></label>
        <div class="candidate-wide-field">
          <span class="candidate-field-label">Campaign Photo</span>
          <label class="candidate-photo-upload" for="campaignPhoto">
            <input id="campaignPhoto" type="file" accept="image/jpeg,image/png,image/webp">
            <i class="fa-regular fa-image"></i>
            <strong>${candidateDraft.photoFile ? esc(candidateDraft.photoFile.name) : "Upload a photo"}</strong>
            <small>Upload jpg, png or webp (maximum 5MB)</small>
          </label>
          <div class="candidate-photo-guidelines"><strong>Photo Guidelines:</strong><ul><li>Clear image of your face</li><li>Formal or semi-formal attire</li><li>No sunglasses or props</li></ul></div>
        </div>
      </div>
      <p class="candidate-form-message" id="candidateStepMessage" aria-live="polite"></p>
      <div class="candidate-registration-actions"><button class="candidate-back-btn" type="button" id="candidateBack"><i class="fa-solid fa-chevron-left"></i> Back</button><button class="candidate-next-btn" type="button" id="candidateNext">Next <i class="fa-solid fa-chevron-right"></i></button></div>
    </div>`;
  } else if (candidateRegistrationStep === 3) {
    body = `<div class="candidate-registration-body">
      <h3>PLATFORM &amp; DOCUMENTATION</h3>
      <div class="candidate-platform-layout">
        <div class="candidate-platform-copy">
          <label>Platform &amp; Advocacy<textarea id="candidatePlatform" maxlength="1600" placeholder="Describe your plans, advocacies, and goals if elected.">${esc(candidateDraft.platform)}</textarea><small><span id="platformCount">${candidateDraft.platform.length}</span> / 1600</small></label>
          <label>Statement of Intent<textarea id="candidateStatement" maxlength="1600" placeholder="Explain why you want to serve the student body.">${esc(candidateDraft.statement)}</textarea><small><span id="statementCount">${candidateDraft.statement.length}</span> / 1600</small></label>
        </div>
        <div class="candidate-documents-panel">
          <span class="candidate-field-label">Supporting Documents <em>(Optional)</em></span>
          <label class="candidate-document-upload" for="supportingDocuments">
            <input id="supportingDocuments" type="file" multiple accept=".pdf,image/jpeg,image/png">
            <i class="fa-solid fa-plus"></i><strong>Add Document</strong>
          </label>
          <div class="candidate-selected-docs">${candidateDraft.supportingFiles.length ? candidateDraft.supportingFiles.map((f) => `<span><i class="fa-regular fa-file"></i>${esc(f.name)}</span>`).join("") : ""}</div>
          <div class="candidate-doc-guidelines"><strong>Accepted Files:</strong><ul><li>Certificate of enrollment</li><li>Good Moral</li><li>Other supporting documents</li></ul><p>File types: PDF, JPG, PNG<br>Maximum file size: 5MB</p></div>
        </div>
      </div>
      <p class="candidate-form-message" id="candidateStepMessage" aria-live="polite"></p>
      <div class="candidate-registration-actions"><button class="candidate-back-btn" type="button" id="candidateBack"><i class="fa-solid fa-chevron-left"></i> Back</button><button class="candidate-next-btn" type="button" id="candidateNext">Next <i class="fa-solid fa-chevron-right"></i></button></div>
    </div>`;
  } else {
    body = `<div class="candidate-registration-body candidate-review-body">
      <h3>REVIEW &amp; SUBMIT</h3>
      <div class="candidate-review-top">
        <section>
          <h4>Candidate Information</h4>
          <div class="candidate-review-person"><img src="${candidatePhotoPreviewUrl()}" alt="Selected campaign photo"><div><strong>${esc(student.fullName)}</strong><span>${esc(student.studentId)}</span><span>${esc(student.program || "")}</span><span>${esc(email)}</span><span>${esc(contact)}</span></div></div>
        </section>
        <section><h4>Position</h4><p>${esc(candidateDraft.position)}</p><h4>Party / Affiliation</h4><p>${esc(candidateDraft.partylist || "Independent")}</p></section>
        <section><h4>Documents</h4><div class="candidate-review-documents">${candidateReviewDocumentRows()}</div></section>
      </div>
      <div class="candidate-review-text"><h4>Platform &amp; Advocacy</h4><p>${esc(candidateDraft.platform)}</p><h4>Statement of Intent</h4><p>${esc(candidateDraft.statement)}</p></div>
      <p class="candidate-form-message" id="candidateSubmitMessage" aria-live="polite"></p>
      <div class="candidate-registration-actions"><button class="candidate-back-btn" type="button" id="candidateBack"><i class="fa-solid fa-chevron-left"></i> Back</button><button class="candidate-submit-btn" type="button" id="submitCandidateApplication">SUBMIT</button></div>
    </div>`;
  }

  app.innerHTML = registrationShell(candidateRegistrationStep, body);
  wireRegistrationDetailsButton();
  document.getElementById("candidateBack")?.addEventListener("click", () => renderRegistration(candidateRegistrationStep - 1));

  if (candidateRegistrationStep === 1) {
    document.getElementById("candidateNext")?.addEventListener("click", () => renderRegistration(2));
  }

  if (candidateRegistrationStep === 2) {
    const photoInput = document.getElementById("campaignPhoto");
    photoInput?.addEventListener("change", () => {
      const file = photoInput.files?.[0];
      if (file) {
        candidateDraft.position = clean(document.getElementById("candidatePosition")?.value);
        candidateDraft.partylist = clean(document.getElementById("candidateParty")?.value);
        candidateDraft.photoFile = file;
        renderRegistration(2);
      }
    });
    document.getElementById("candidateNext")?.addEventListener("click", () => {
      const message = document.getElementById("candidateStepMessage");
      const position = clean(document.getElementById("candidatePosition")?.value);
      const party = clean(document.getElementById("candidateParty")?.value);
      if (!position) { message.textContent = "Choose the position you are applying for."; return; }
      if (!candidateDraft.photoFile) { message.textContent = "Upload a campaign photo before continuing."; return; }
      if (candidateDraft.photoFile.size > 5 * 1024 * 1024) { message.textContent = "Campaign photo must be 5MB or smaller."; return; }
      candidateDraft.position = position;
      candidateDraft.partylist = party;
      renderRegistration(3);
    });
  }

  if (candidateRegistrationStep === 3) {
    const platform = document.getElementById("candidatePlatform");
    const statement = document.getElementById("candidateStatement");
    const docsInput = document.getElementById("supportingDocuments");
    const updateCounts = () => {
      const pc = document.getElementById("platformCount"); if (pc) pc.textContent = String(platform?.value.length || 0);
      const sc = document.getElementById("statementCount"); if (sc) sc.textContent = String(statement?.value.length || 0);
    };
    platform?.addEventListener("input", updateCounts);
    statement?.addEventListener("input", updateCounts);
    docsInput?.addEventListener("change", () => {
      const selected = [...(docsInput.files || [])].slice(0, 8);
      const tooLarge = selected.find((file) => file.size > 5 * 1024 * 1024);
      if (tooLarge) { document.getElementById("candidateStepMessage").textContent = `${tooLarge.name} is larger than 5MB.`; return; }
      candidateDraft.supportingFiles = selected;
      candidateDraft.platform = platform?.value || candidateDraft.platform;
      candidateDraft.statement = statement?.value || candidateDraft.statement;
      renderRegistration(3);
    });
    document.getElementById("candidateNext")?.addEventListener("click", () => {
      const message = document.getElementById("candidateStepMessage");
      const platformValue = clean(platform?.value);
      const statementValue = clean(statement?.value);
      if (!platformValue) { message.textContent = "Add your platform and advocacy before continuing."; return; }
      if (!statementValue) { message.textContent = "Add your statement of intent before continuing."; return; }
      candidateDraft.platform = platformValue;
      candidateDraft.statement = statementValue;
      renderRegistration(4);
    });
  }

  if (candidateRegistrationStep === 4) {
    document.getElementById("submitCandidateApplication")?.addEventListener("click", submitApplication);
  }
}

async function submitApplication() {
  const button = document.getElementById("submitCandidateApplication");
  const message = document.getElementById("candidateSubmitMessage");
  if (!button || !candidateDraft) return;
  button.disabled = true;
  message.textContent = "Server-verifying registration window and securely uploading files...";
  try {
    context = await callSecure("getElectionContext");
    if (!context.registrationOpen) throw new Error("Candidate registration is no longer open according to server time.");
    if (!candidateDraft.photoFile) throw new Error("Campaign photo is required.");
    const photoTicket = await secureUpload(candidateDraft.photoFile, "candidate-photo");
    const docTickets = [];
    for (const file of candidateDraft.supportingFiles.slice(0, 8)) docTickets.push(await secureUpload(file, "candidate-document"));
    const combinedPlatform = `Platform & Advocacy:
${candidateDraft.platform}

Statement of Intent:
${candidateDraft.statement}`.slice(0, 4000);
    const result = await callSecure("submitCandidateApplication", {
      position: candidateDraft.position,
      partylist: candidateDraft.partylist,
      platform: combinedPlatform,
      campaignPhotoPath: photoTicket.path,
      supportingDocumentPaths: docTickets.map((ticket) => ticket.path)
    });
    await loadSecureState();
    document.getElementById("applicationSuccess")?.classList.remove("hidden");
    message.textContent = `Application submitted: ${result.status}.`;
  } catch (error) {
    console.error(error);
    message.textContent = error.message || "Unable to submit the application.";
    button.disabled = false;
  }
}

function renderApplicationStatus() {
  if (!application) return renderLanding();
  currentView = "status";
  app.innerHTML = `<section class="registration-card" style="max-width:850px;margin:35px auto"><div class="registration-tip"><i class="fa-solid fa-circle-info"></i><div><strong>Application Status: ${esc(application.status || "Under Review")}</strong><span>Private supporting documents are not exposed on public candidate pages.</span></div></div><div class="registration-body"><div class="review-grid"><div class="review-panel"><h4>Candidate</h4><p><strong>${esc(application.fullName || student.fullName)}</strong><br>${esc(application.studentId || student.studentId)}<br>${esc(application.program || student.program || "")}</p></div><div class="review-panel"><h4>Position</h4><p>${esc(application.position)}</p>${application.department ? `<h4>Verified College</h4><p>${esc(application.department)}</p>` : ""}<h4>Party</h4><p>${esc(application.partylist || "Independent")}</p></div><div class="review-panel"><h4>Review</h4><p>${esc(application.reviewNote || "No review note has been posted.")}</p></div></div><div class="registration-actions"><button class="btn-back" id="backFromStatus">Back</button>${context?.candidateVisible ? '<button class="btn-next" id="viewCandidatesFromStatus">View Candidates</button>' : ""}</div></div></section>`;
  document.getElementById("backFromStatus")?.addEventListener("click", renderLanding);
  document.getElementById("viewCandidatesFromStatus")?.addEventListener("click", renderCandidates);
}

function candidateGalleryHeading(position) {
  const labels = {
    "President": "The Presidents",
    "Vice President": "The Vice Presidents",
    "Secretary": "The Secretaries",
    "Treasurer": "The Treasurers",
    "Auditor": "The Auditors",
    "Public Relations Officer": "The Public Relations Officers",
    "Business Manager": "The Business Managers",
    "Sergeant at Arms": "The Sergeants at Arms",
    "Department Representative": "Department Representatives"
  };
  return labels[position] || position;
}

function candidateSlantCard(candidate) {
  const candidatePhoto = photo(candidate);
  const party = clean(candidate.partylist || "Independent");
  const department = clean(candidate.department || candidate.college || "");
  const platform = clean(candidate.platform || "No platform statement provided.");
  return `<button class="candidate-slant-card" type="button"
    data-candidate-id="${esc(candidate.id)}"
    aria-label="Select ${esc(candidate.fullName)}">
      <img src="${esc(candidatePhoto)}" data-media-ref="${esc(candidatePhoto)}" alt="Campaign photo of ${esc(candidate.fullName)}" onerror="this.src='assets/USClogo.webp'">
      <span class="candidate-slant-caption">
        <strong>${esc(candidate.fullName)}</strong>
        <span>${esc(party)}${department ? ` · ${esc(department)}` : ""}</span>
        <small>${esc(platform)}</small>
      </span>
    </button>`;
}

function candidateGalleryGroup(position, rows) {
  if (!rows.length) return "";
  const heading = position === "Department Representative"
    ? `${candidateGalleryHeading(position)} · ${esc(student.college)}`
    : candidateGalleryHeading(position);

  const chunks = [];
  for (let index = 0; index < rows.length; index += 4) {
    chunks.push(rows.slice(index, index + 4));
  }

  return `<section class="candidate-view-section" data-position="${esc(position)}">
    <h2>${heading}</h2>
    ${chunks.map((chunk) => `<div class="candidate-slant-grid candidate-slant-grid-four" data-candidate-accordion data-candidate-count="${chunk.length}">
      ${chunk.map(candidateSlantCard).join("")}
    </div>`).join("")}
  </section>`;
}

function clearCandidateAccordion(grid, { unlock = false } = {}) {
  if (!grid) return;
  if (unlock) delete grid.dataset.lockedCandidate;
  if (grid.dataset.lockedCandidate && !unlock) return;
  grid.classList.remove("is-accordion-active");
  grid.querySelectorAll(".candidate-slant-card").forEach((card) => {
    card.classList.remove("is-expanded", "is-collapsed");
    card.setAttribute("aria-expanded", "false");
  });
}

function activateCandidateAccordion(grid, activeCard, { lock = false } = {}) {
  if (!grid || !activeCard) return;
  const cards = [...grid.querySelectorAll(".candidate-slant-card")];
  if (!cards.length) return;
  if (lock) grid.dataset.lockedCandidate = clean(activeCard.dataset.candidateId);
  grid.classList.add("is-accordion-active");
  cards.forEach((card) => {
    const expanded = card === activeCard;
    card.classList.toggle("is-expanded", expanded);
    card.classList.toggle("is-collapsed", !expanded);
    card.setAttribute("aria-expanded", expanded ? "true" : "false");
  });
}


function closeCandidateProfile() {
  document.querySelector(".candidate-profile-overlay")?.remove();

  // Reset any previously opened candidate flashcard state.
  // Without this, the previous candidate remains locked after closing the modal.
  document.querySelectorAll("[data-candidate-accordion]").forEach((grid) => {
    clearCandidateAccordion(grid, { unlock: true });
    delete grid.dataset.lockedCandidate;
  });

  document.querySelectorAll(".candidate-slant-card").forEach((card) => {
    card.classList.remove("is-expanded", "is-collapsed");
    card.setAttribute("aria-expanded", "false");
  });
}

function showCandidateProfile(candidateId) {
  const candidate = candidates.find((item) => clean(item.id) === clean(candidateId));
  if (!candidate) return;

  const photoUrl = photo(candidate);
  const platform = clean(candidate.platform || "No platform statement provided.");
  const department = clean(candidate.department || candidate.college || "");
  const party = clean(candidate.partylist || "Independent");
  const statement = clean(candidate.statement || "");

  closeCandidateProfile();

  const overlay = document.createElement("div");
  overlay.className = "candidate-profile-overlay";
  overlay.innerHTML = `
    <div class="candidate-profile-modal" role="dialog" aria-modal="true">
      <button class="candidate-profile-close" type="button" aria-label="Close">
        <i class="fa-solid fa-xmark"></i>
      </button>
      <div class="candidate-profile-cover">
        <img src="${esc(photoUrl)}" data-media-ref="${esc(photoUrl)}" alt="Campaign photo of ${esc(candidate.fullName)}" onerror="this.src='assets/USClogo.webp'">
      </div>
      <div class="candidate-profile-body">
        <div class="candidate-profile-avatar">${esc((candidate.fullName || "C").slice(0,1).toUpperCase())}</div>
        <h2>${esc(candidate.fullName || "Candidate")}</h2>
        <p class="candidate-profile-position">${esc(candidate.position || "")}</p>
        <div class="candidate-profile-tags">
          <span>${esc(party)}</span>
          ${department ? `<span>${esc(department)}</span>` : ""}
        </div>

        <div class="candidate-profile-section">
          <h3><i class="fa-solid fa-bullhorn"></i> Platform & Advocacy</h3>
          <p>${esc(platform)}</p>
        </div>

        ${statement ? `
        <div class="candidate-profile-section">
          <h3><i class="fa-solid fa-quote-left"></i> Statement of Intent</h3>
          <p>${esc(statement)}</p>
        </div>` : ""}
      </div>
    </div>`;

  document.body.appendChild(overlay);

  hydrateMediaImages(overlay).catch(() => {});

  const profileImage = overlay.querySelector(".candidate-profile-cover img");
  profileImage?.addEventListener("error", () => {
    profileImage.src = "assets/USClogo.webp";
  });

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay || event.target.closest(".candidate-profile-close")) {
      closeCandidateProfile();
    }
  });
}

function wireCandidateFlashcardFlow() {
  app.querySelectorAll("[data-candidate-accordion]").forEach((grid) => {
    const cards = [...grid.querySelectorAll(".candidate-slant-card")];
    if (!cards.length) return;

    cards.forEach((card) => {
      card.setAttribute("aria-expanded", "false");

      /* Hover/focus expansion is handled by CSS so the row does not constantly
         collapse/reflow underneath the pointer. Clicking still locks a card open. */
      card.addEventListener("click", (event) => {
        event.preventDefault();
        const id = clean(card.dataset.candidateId);
        showCandidateProfile(id);
        if (grid.dataset.lockedCandidate === id) {
          clearCandidateAccordion(grid, { unlock: true });
          return;
        }
        activateCandidateAccordion(grid, card, { lock: true });
      });
    });

    grid.addEventListener("mouseleave", () => clearCandidateAccordion(grid));
    grid.addEventListener("focusout", () => {
      requestAnimationFrame(() => {
        if (!grid.contains(document.activeElement)) clearCandidateAccordion(grid);
      });
    });
  });

  app.addEventListener("click", (event) => {
    if (event.target.closest?.(".candidate-slant-card")) return;
    app.querySelectorAll("[data-candidate-accordion]").forEach((grid) => {
      clearCandidateAccordion(grid, { unlock: true });
    });
  }, { once: true });
}

function renderCandidates() {
  if (!context?.candidateVisible) return renderLanding();
  currentView = "candidates";

  const grouped = POSITION_ORDER.map((position) => (
    candidateGalleryGroup(position, candidatesFor(position))
  )).join("");

  const status = voterStatus?.hasVoted
    ? "Already Voted"
    : (context.votingOpen ? "Vote Now!" : "Voting Not Open");

  app.innerHTML = `<section class="candidate-view-shell">
    <div class="candidate-view-background" aria-hidden="true"></div>
    <div class="candidate-view-content">
      <div class="candidate-view-topline">
        <h1 class="candidate-view-label">Candidates</h1>
        <button class="candidate-gallery-back" id="backCandidates" type="button">
          <i class="fa-solid fa-arrow-left"></i><span>Back</span>
        </button>
      </div>
      <div class="candidate-vote-zone" aria-label="Voting status">
        <button class="candidate-vote-button ${voterStatus?.hasVoted ? "already-voted" : (!context.votingOpen ? "voting-closed" : "")}" id="floatingVoteStatus" ${!context.votingOpen || voterStatus?.hasVoted ? "disabled" : ""}>${esc(status)}</button>
      </div>
      ${grouped || '<div class="candidate-gallery-empty">No approved candidates are published.</div>'}
      <div class="candidate-gallery-scroll-cue" aria-hidden="true">
        <span>Scroll down</span><i class="fa-solid fa-chevron-down"></i>
      </div>
    </div>
  </section>`;

  hydrateMediaImages(app).catch(() => {});
  wireCandidateFlashcardFlow();

  document.getElementById("backCandidates")?.addEventListener("click", renderLanding);
  document.getElementById("floatingVoteStatus")?.addEventListener("click", () => {
    if (context.votingOpen && !voterStatus?.hasVoted) renderBallot();
  });
}

function renderBallot() {
  if (!context?.votingOpen || voterStatus?.hasVoted) return renderLanding();
  currentView = "ballot";
  const positionMarkup = POSITION_ORDER.map((position) => {
    const rows = candidatesFor(position);
    return `<div class="form-field full"><label>${esc(position)}${position === "Department Representative" ? ` · ${esc(student.college)}` : ""}</label><select class="ballot-select" data-position="${esc(position)}" required><option value="">Select candidate</option>${rows.map((c) => `<option value="${esc(c.id)}">${esc(c.fullName)}${c.partylist ? ` · ${esc(c.partylist)}` : ""}</option>`).join("")}</select>${!rows.length ? '<small class="field-help">No eligible approved candidate is available for this position.</small>' : ""}</div>`;
  }).join("");
  app.innerHTML = `<section class="registration-card" style="max-width:900px;margin:30px auto"><div class="registration-tip"><i class="fa-solid fa-lock"></i><div><strong>Secret ballot</strong><span>Your voter participation record is separate from the anonymous ballot document. The ballot stores candidate IDs only and does not store your UID, Student ID, name, email, college, or receipt.</span></div></div><form class="registration-body" id="secureBallotForm"><h3>OFFICIAL BALLOT</h3><div class="form-grid">${positionMarkup}</div><p id="ballotMessage" aria-live="polite"></p><div class="registration-actions"><button class="btn-back" type="button" id="cancelBallot">Cancel</button><button class="btn-next" type="submit">Submit Vote</button></div></form></section>`;
  document.getElementById("cancelBallot")?.addEventListener("click", renderCandidates);
  document.getElementById("secureBallotForm")?.addEventListener("submit", submitBallot);
}

async function submitBallot(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const message = document.getElementById("ballotMessage");
  const selections = {};
  form.querySelectorAll(".ballot-select").forEach((select) => { selections[select.dataset.position] = select.value; });
  if (Object.values(selections).some((id) => !id)) return message.textContent = "Select one candidate for every ballot position.";
  if (!confirm("Submit this ballot? You can vote only once. Your selections cannot be changed after the server records the ballot.")) return;
  button.disabled = true;
  message.textContent = "Server-validating election time, candidates, active student status, and one-vote status...";
  try {
    const result = await callSecure("submitAnonymousBallot", { electionId: context.electionId, selections });
    await loadSecureState();
    app.innerHTML = `<section class="registration-card" style="max-width:760px;margin:45px auto;text-align:center"><div class="vote-success-check"><i class="fa-solid fa-check"></i></div><h2>Ballot Recorded</h2><p>Your anonymous ballot was accepted by the election server.</p><div class="success-note"><strong>Participation Receipt</strong><br><code style="font-size:1.05rem">${esc(result.receiptReference)}</code><br><small>This receipt proves the system recorded your participation. It does not reveal or identify your candidate selections.</small></div><div class="registration-actions" style="justify-content:center"><button class="btn-next" id="backAfterVote">Return to Election</button></div></section>`;
    document.getElementById("backAfterVote")?.addEventListener("click", renderLanding);
  } catch (error) {
    console.error(error);
    message.textContent = error.message || "The server rejected this ballot.";
    button.disabled = false;
  }
}

function resultRows(results) {
  const grouped = new Map(POSITION_ORDER.map((p) => [p, []]));
  for (const row of results || []) if (grouped.has(row.position)) grouped.get(row.position).push(row);
  return POSITION_ORDER.map((position) => {
    const rows = grouped.get(position).sort((a,b) => Number(b.votes||0)-Number(a.votes||0));
    if (!rows.length) return "";
    const top = Number(rows[0].votes || 0);
    return `<section class="election-result-position"><h3>${esc(position)}</h3><div class="election-result-list">${rows.map((row,index) => `<article class="election-result-row ${top > 0 && Number(row.votes||0) === top ? "leader" : ""}"><span class="result-rank">${index+1}</span><div><strong>${esc(row.fullName)}</strong><small>${esc(row.department || "")}</small></div><b>${Number(row.votes||0)} vote${Number(row.votes||0)===1?"":"s"}</b></article>`).join("")}</div></section>`;
  }).join("");
}

async function renderResults() {
  if (!context?.resultsVisible) return renderLanding();
  currentView = "results";
  app.innerHTML = `<div class="page-loading"><i class="fa-solid fa-spinner fa-spin"></i><br>Loading published official results...</div>`;
  try {
    const snap = await getDoc(doc(db, "elections", context.electionId, "results", "official"));
    if (!snap.exists()) throw new Error("Official results are not published.");
    const data = snap.data();
    const resultTurnout = data.turnout || turnout;
    app.innerHTML = `<section class="election-results-shell"><header class="election-results-header"><div><small>OFFICIAL ELECTION RESULTS</small><h1>${esc(data.title || context.title)}</h1><p>These candidate totals were released only after finalization and deliberate result publication.</p></div><button id="backResults" type="button"><i class="fa-solid fa-arrow-left"></i> Back</button></header><div class="election-results-summary"><strong>${Number(resultTurnout.ballotsCast || 0)}</strong><span>Total ballots recorded</span><b>${Number(resultTurnout.eligibleVoters || context.eligibleVoterCount || 0)} eligible voters</b></div>${resultRows(data.results)}</section>`;
    document.getElementById("backResults")?.addEventListener("click", renderLanding);
  } catch (error) { failClosed(error); }
}

async function initialize() {
  student = sessionProfile();
  if (!student) return location.replace("../index/index.html");
  document.getElementById("dashboardUserName").textContent = student.fullName || "Student";
  document.getElementById("dashboardUserInitials").textContent = (student.fullName || "ST").split(/\s+/).map((p) => p[0]).join("").slice(0,2).toUpperCase();
  app.innerHTML = `<div class="page-loading"><i class="fa-solid fa-spinner fa-spin"></i><br>Verifying election state with the server...</div>`;
  try { await loadSecureState(); renderLanding(); }
  catch (error) { failClosed(error); }
}

document.getElementById("closeSuccess")?.addEventListener("click", async () => { document.getElementById("applicationSuccess")?.classList.add("hidden"); await loadSecureState(); renderLanding(); });
document.getElementById("successX")?.addEventListener("click", async () => { document.getElementById("applicationSuccess")?.classList.add("hidden"); await loadSecureState(); renderLanding(); });
document.getElementById("viewApplicationStatus")?.addEventListener("click", async () => { document.getElementById("applicationSuccess")?.classList.add("hidden"); await loadSecureState(); renderApplicationStatus(); });
document.getElementById("studentLogout")?.addEventListener("click", async () => { sessionStorage.clear(); try { await signOut(auth); } catch {} location.replace("../index/index.html"); });

await initialize();
setInterval(async () => {
  if (!context) return;
  try {
    const previousLifecycle = context.lifecycle;
    await loadSecureState();
    if (currentView === "landing" || previousLifecycle !== context.lifecycle) renderLanding();
    else if (currentView === "candidates") renderCandidates();
    else if (currentView === "registration" && !context.registrationOpen) renderLanding();
    else if (currentView === "ballot" && !context.votingOpen) renderLanding();
    else if (currentView === "results" && !context.resultsVisible) renderLanding();
  } catch (error) { failClosed(error); }
}, 15000);
