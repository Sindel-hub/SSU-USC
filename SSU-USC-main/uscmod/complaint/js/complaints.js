import {callStudentEmailService} from "../../shared/supabase-email-service.js";
import {hasVerifiedNotificationEmail,showEmailVerificationRequired} from "../../shared/verified-email.js";
import {saveComplaintDraft,restoreComplaintDraft,clearComplaintDraft,draftAttachmentPreview} from "../../shared/complaint-drafts.js";
import { auth, db } from "../../firebase/firebase-config.js";
import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import { signOut } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";

const uscAuthAllowed = await (globalThis.USC_AUTH_READY || Promise.resolve(false));
if (uscAuthAllowed !== true) await new Promise(() => {});

const SESSION_FLAG_KEY = "activeSession";
const SESSION_PROFILE_KEY = "studentProfile";
const SESSION_EXPIRES_AT_KEY = "sessionExpiresAt";
const LAST_ACTIVITY_AT_KEY = "lastActivityAt";

// Local burst control supplements the trusted service's atomic server-time cooldown.
const SUBMISSION_COOLDOWN_MS = 20_000;
const LOCAL_LOCK_TTL_MS = 90_000;
const MAX_SUBMIT_ATTEMPTS = 4;
const IMAGE_MAX_BYTES = 3 * 1024 * 1024;
const DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_ATTACHMENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
]);
const TRANSIENT_FIRESTORE_CODES = new Set([
  "aborted",
  "cancelled",
  "deadline-exceeded",
  "internal",
  "resource-exhausted",
  "unavailable",
  "unknown"
]);

function profile() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_PROFILE_KEY) || "null"); }
  catch { return null; }
}

function clearStudentSession() {
  sessionStorage.removeItem(SESSION_FLAG_KEY);
  sessionStorage.removeItem(SESSION_PROFILE_KEY);
  sessionStorage.removeItem(SESSION_EXPIRES_AT_KEY);
  sessionStorage.removeItem(LAST_ACTIVITY_AT_KEY);
}

function getInitials(fullName) {
  return String(fullName || "").trim().split(/\s+/).filter(Boolean).slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase()).join("") || "ST";
}

async function logout() {
  clearStudentSession();
  try { await signOut(auth); } catch {}
  window.location.href = "../index/index.html";
}
window.logout = logout;

function hydrateStudentIdentity() {
  const p = profile();
  if (!p) return;
  const fullName = p.fullName || "Student";
  document.getElementById("dashboardUserName")?.replaceChildren(document.createTextNode(fullName));
  const initials = document.getElementById("dashboardUserInitials");
  if (initials) initials.textContent = getInitials(fullName);
  const deptInput = document.getElementById("department");
  if (deptInput) deptInput.value = p.department || p.program || p.course || p.college || "Not specified";
}

function ensureProtectedSession() {
  if (sessionStorage.getItem(SESSION_FLAG_KEY) !== "true") {
    window.location.href = "../index/index.html";
    return false;
  }
  const p = profile();
  if (!p?.uid) {
    clearStudentSession();
    window.location.href = "../index/index.html";
    return false;
  }
  hydrateStudentIdentity();
  return true;
}

const detailsInput = document.getElementById("details");
const charCount = document.getElementById("charCount");
const attachmentInput = document.getElementById("attachment");
const fileName = document.getElementById("fileName");
const attachmentError = document.getElementById("attachmentError");
const complaintForm = document.getElementById("complaintForm");
const submitButton = document.getElementById("submitComplaintBtn") || complaintForm?.querySelector('button[type="submit"]');
const modal = document.getElementById("complaintSuccessModal");
const modalCloseButtons = [
  document.getElementById("complaintModalClose"),
  document.getElementById("closeComplaintStatusBtn")
].filter(Boolean);
let previewObjectUrl = "";
let submissionInFlight = false;
let activeDraftId=crypto.randomUUID(),restoredAttachment=null,formTouched=false;
const formMessage=document.getElementById("complaintFormMessage");
complaintForm?.addEventListener("input",()=>{formTouched=true});

function humanBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 1024 * 1024 ? 1 : 2)} MB`;
}

function setAttachmentError(message = "") {
  if (!attachmentError) return;
  attachmentError.textContent = message;
  attachmentError.hidden = !message;
}

function clearAttachmentPreview() {
  if (previewObjectUrl) {
    URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = "";
  }
  const preview = document.getElementById("attachmentSelectedPreview");
  if (preview) {
    preview.removeAttribute("src");
    preview.hidden = true;
  }
}

function validateAttachment(file) {
  if (!file) return;
  if (!ALLOWED_ATTACHMENT_TYPES.has(file.type)) {
    throw new Error("Allowed files: JPG, PNG, WEBP, PDF, DOC, or DOCX only.");
  }
  const isImage = file.type.startsWith("image/");
  const limit = isImage ? IMAGE_MAX_BYTES : DOCUMENT_MAX_BYTES;
  if (file.size > limit) {
    throw new Error(`${isImage ? "Images" : "Documents"} must not exceed ${humanBytes(limit)}.`);
  }
}

function renderSelectedAttachment(file) {
  clearAttachmentPreview();
  if (!file) {
    if (fileName) fileName.textContent = "No file selected";
    setAttachmentError("");
    return;
  }
  validateAttachment(file);
  if (fileName) fileName.textContent = `${file.name} (${humanBytes(file.size)})`;
  setAttachmentError("");
  const preview = document.getElementById("attachmentSelectedPreview");
  if (preview && file.type.startsWith("image/")) {
    previewObjectUrl = URL.createObjectURL(file);
    preview.src = previewObjectUrl;
    preview.hidden = false;
  }
}

detailsInput?.addEventListener("input", () => {
  if (charCount) charCount.textContent = String(detailsInput.value.length);
});

attachmentInput?.addEventListener("change", () => {
  const file = attachmentInput.files?.[0] || null;
  restoredAttachment=null;
  try {
    renderSelectedAttachment(file);
  } catch (error) {
    attachmentInput.value = "";
    clearAttachmentPreview();
    if (fileName) fileName.textContent = "No file selected";
    setAttachmentError(error.message || "The selected attachment is not allowed.");
  }
});

const FIRESTORE_ATTACHMENT_CHUNK_BYTES = 600 * 1024;

function bytesToBase64(bytes) {
  let binary = "";
  const STEP = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += STEP) {
    const slice = bytes.subarray(offset, Math.min(offset + STEP, bytes.length));
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

async function prepareComplaintAttachment(file) {
  if (!file) return { storageMode: "", chunks: [] };
  validateAttachment(file);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const chunks = [];
  for (let offset = 0, index = 0; offset < bytes.length; offset += FIRESTORE_ATTACHMENT_CHUNK_BYTES, index += 1) {
    chunks.push({
      index,
      payload: bytesToBase64(bytes.subarray(offset, Math.min(offset + FIRESTORE_ATTACHMENT_CHUNK_BYTES, bytes.length)))
    });
  }
  return { storageMode: "firestore-chunks", chunks };
}

function openModal() {
  modal?.classList.remove("hidden");
  document.body.classList.add("modal-open");
}
function closeModal() {
  modal?.classList.add("hidden");
  document.body.classList.remove("modal-open");
}
modalCloseButtons.forEach((btn) => btn.addEventListener("click", closeModal));
document.querySelector("#complaintSuccessModal .student-modal-backdrop")?.addEventListener("click", closeModal);
document.getElementById("viewComplaintStatusBtn")?.addEventListener("click", () => {
  window.location.href = "../dashboard/tracklist.html";
});

function localLockKey(uid) { return `usc:complaint-submit-lock:${uid}`; }

function acquireLocalSubmissionLock(uid) {
  const key = localLockKey(uid);
  const now = Date.now();
  try {
    const current = JSON.parse(localStorage.getItem(key) || "null");
    if (current?.expiresAt > now) {
      throw new Error("A complaint submission is already in progress in another tab. Please wait a moment.");
    }
  } catch (error) {
    if (error instanceof SyntaxError) localStorage.removeItem(key);
    else throw error;
  }
  const token = globalThis.crypto?.randomUUID?.() || `${now}-${Math.random()}`;
  localStorage.setItem(key, JSON.stringify({ token, expiresAt: now + LOCAL_LOCK_TTL_MS }));
  return { key, token };
}

function releaseLocalSubmissionLock(lock) {
  if (!lock) return;
  try {
    const current = JSON.parse(localStorage.getItem(lock.key) || "null");
    if (current?.token === lock.token) localStorage.removeItem(lock.key);
  } catch {
    localStorage.removeItem(lock.key);
  }
}

function lastSubmissionMs(snapshot) {
  const value = snapshot?.data?.()?.lastSubmittedAt;
  return typeof value?.toMillis === "function" ? value.toMillis() : typeof value === "number" ? value : Date.parse(value)||0;
}

function cooldownRemainingMs(snapshot) {
  const last = lastSubmissionMs(snapshot);
  return last > 0 ? Math.max(0, SUBMISSION_COOLDOWN_MS - (Date.now() - last)) : 0;
}

async function preflightCooldown(uid) {
  const snapshot = await getDoc(doc(db, "complaint_rate_limits", uid));
  const remaining = cooldownRemainingMs(snapshot);
  if (remaining > 0) throw new Error(`Please wait ${Math.ceil(remaining / 1000)} seconds before submitting another complaint.`);
}

function normalizedErrorCode(error) {
  return String(error?.code || "").replace(/^firestore\//, "").replace(/^functions\//, "");
}

function isTransientError(error) {
  return TRANSIENT_FIRESTORE_CODES.has(normalizedErrorCode(error));
}

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function withTransientRetry(operation) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_SUBMIT_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientError(error) || attempt === MAX_SUBMIT_ATTEMPTS) throw error;
      const backoff = Math.min(4000, 350 * (2 ** (attempt - 1))) + Math.floor(Math.random() * 250);
      await delay(backoff);
    }
  }
  throw lastError;
}

function setSubmittingState(isSubmitting) {
  submissionInFlight = isSubmitting;
  if (!submitButton) return;
  submitButton.disabled = isSubmitting;
  submitButton.setAttribute("aria-busy", String(isSubmitting));
  submitButton.textContent = isSubmitting ? "Submitting…" : "Submit complaint";
}

function submissionFields(){return {submissionType:document.getElementById('submissionType')?.value||'Complaint',category:document.getElementById('category')?.value||'',incidentDate:document.getElementById('incidentDate')?.value||'',subject:document.getElementById('subject')?.value.trim()||'',details:detailsInput?.value.trim()||''};}
async function saveFormProgress(){
 const uid=auth.currentUser?.uid;if(uid!==profile()?.uid)throw new Error('Your account changed. Sign in again.');
 const file=attachmentInput?.files?.[0]||null;let attachment=restoredAttachment,preparedChunks=null;
 if(file){validateAttachment(file);const prepared=await prepareComplaintAttachment(file);preparedChunks=prepared.chunks;attachment={attachmentName:file.name,attachmentType:file.type,attachmentSize:file.size,chunkCount:prepared.chunks.length};}
 else if(!attachment){attachment={attachmentName:'',attachmentType:'',attachmentSize:0,chunkCount:0};preparedChunks=[];}
 await saveComplaintDraft({uid,requestId:activeDraftId,fields:submissionFields(),attachment,chunks:preparedChunks});
 return uid;
}
async function verifyComplaintEmail(){
 if(await hasVerifiedNotificationEmail())return true;
 await showEmailVerificationRequired({label:'Complaint / Feedback',description:'Before submitting your complaint or feedback, connect and verify one Gmail or institutional email address to receive important updates about your submission.',saveProgress:saveFormProgress});return false;
}
async function commitComplaintAtomically(){return withTransientRetry(()=>callStudentEmailService('complaint_submit',{requestId:activeDraftId}));}
function syncSubmissionType(){const feedback=document.getElementById('submissionType')?.value==='Feedback';const heading=document.getElementById('complaintFormTitle');if(heading)heading.textContent=feedback?'Submit Feedback':'Submit a Complaint';if(submitButton&&!submissionInFlight)submitButton.textContent=feedback?'Submit feedback':'Submit complaint';}
document.getElementById('submissionType')?.addEventListener('change',syncSubmissionType);
async function restoreFormProgress(){
 const uid=auth.currentUser?.uid;if(!uid)return;const draft=await restoreComplaintDraft(uid);if(!draft||formTouched||auth.currentUser?.uid!==uid)return;
 activeDraftId=draft.requestId;
 for(const key of ['submissionType','category','incidentDate','subject','details']){const input=document.getElementById(key);if(input)input.value=draft[key]||'';}
 if(charCount)charCount.textContent=String(draft.details?.length||0);
 restoredAttachment={attachmentName:draft.attachmentName||'',attachmentType:draft.attachmentType||'',attachmentSize:draft.attachmentSize||0,chunkCount:draft.chunkCount||0};
 if(fileName)fileName.textContent=draft.attachmentName||'No file selected';syncSubmissionType();
 if(draft.attachmentType?.startsWith('image/')){const preview=await draftAttachmentPreview(uid,draft);if(!formTouched&&auth.currentUser?.uid===uid){clearAttachmentPreview();previewObjectUrl=preview;const img=document.getElementById('attachmentSelectedPreview');if(img&&preview){img.src=preview;img.hidden=false}}else if(preview)URL.revokeObjectURL(preview);}
 if(formMessage)formMessage.textContent='Your saved form is restored. Review it before submitting.';
}
window.addEventListener('usc:profile-closed',async()=>{if(!formTouched&&!restoredAttachment)return;try{const verified=await hasVerifiedNotificationEmail();if(formMessage)formMessage.textContent=verified?'Email verified. Review your form and submit when ready.':'Your form is preserved. Finish verifying an email before submitting.';}catch{if(formMessage)formMessage.textContent='Email verification could not refresh. Your form is preserved.';}});

complaintForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (submissionInFlight || !ensureProtectedSession()) return;

  const storedProfile = profile();
  const authenticatedUid = String(auth.currentUser?.uid || "").trim();
  if (!authenticatedUid) {
    alert("Your signed-in student account could not be verified. Please sign in again.");
    return;
  }
  const p = { ...storedProfile, uid: authenticatedUid };
  const category = document.getElementById("category")?.value || "";
  const incidentDate = document.getElementById("incidentDate")?.value || "";
  const subject = document.getElementById("subject")?.value.trim() || "";
  const details = document.getElementById("details")?.value.trim() || "";
  const attachmentFile = attachmentInput?.files?.[0] || null;
  const attachmentName = attachmentFile?.name || "";
  const department = document.getElementById("department")?.value.trim() || "";

  if (!category || !incidentDate || !subject || !details) {
    alert("Please complete all required fields.");
    return;
  }

  let localLock = null;
  setSubmittingState(true);
  try {
    validateAttachment(attachmentFile);
    localLock = acquireLocalSubmissionLock(p.uid);

    if(!await verifyComplaintEmail())return;
    await preflightCooldown(p.uid);
    await saveFormProgress();
    if(auth.currentUser?.uid!==p.uid)throw new Error('Your account changed. Reopen this form.');
    const result=await commitComplaintAtomically();
    await clearComplaintDraft(p.uid,activeDraftId).catch(()=>{});
    activeDraftId=crypto.randomUUID();restoredAttachment=null;formTouched=false;
    const reference=document.getElementById('complaintSuccessReference');if(reference)reference.textContent=result.complaintRef||'';
    complaintForm.reset();if(formMessage)formMessage.textContent="";
    clearAttachmentPreview();
    setAttachmentError("");
    if (fileName) fileName.textContent = "No file selected";
    if (charCount) charCount.textContent = "0";
    const deptInput = document.getElementById("department");
    if (deptInput) deptInput.value = department;
    openModal();
  } catch (error) {
    if(error.code==='email-verification-required'){await showEmailVerificationRequired({label:'Complaint / Feedback',description:'Connect and verify a Gmail or institutional email before submitting your complaint or feedback.',saveProgress:saveFormProgress});return;}
    const code = normalizedErrorCode(error);
    const message = code === "permission-denied"
      ? "The complaint was blocked by the secure submission rules. Please try submitting your complaint again."
      : (error?.message || "Failed to submit complaint. Please try again.");
    alert(message);
  } finally {
    releaseLocalSubmissionLock(localLock);
    setSubmittingState(false);syncSubmissionType();
  }
});

if(ensureProtectedSession())restoreFormProgress().catch(()=>{if(formMessage)formMessage.textContent="Saved forms are temporarily unavailable. You can continue using this form.";});
