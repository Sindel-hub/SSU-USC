import { auth } from "../firebase/firebase-config.js";
import { callStudentEmailService, isSupabaseEmailConfigured } from "./supabase-email-service.js";

const canonicalGmail = value => {
  const email = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9.]+(?:\+[a-z0-9._-]+)?@gmail\.com$/.test(email)) throw new Error("Enter a valid @gmail.com address.");
  return email.split("@")[0].split("+")[0].replaceAll(".", "") + "@gmail.com";
};

export async function initializeEmailSettings(root) {
  if (!root || !await globalThis.USC_AUTH_READY || !auth.currentUser) return;

  const drawerRole = String(root.closest(".usc-profile-drawer")?.dataset?.profileRole || "student").toLowerCase();
  const profileRole = drawerRole === "officer" ? "officer" : "student";
  const isOfficer = profileRole === "officer";
  const selfServiceLabel = isOfficer ? "Officer self-service" : "Student self-service";
  const complaintTitle = isOfficer ? "Complaint activity" : "Complaint updates";
  const complaintDetail = isOfficer ? "New and updated complaint cases" : "Feedback and status changes";
  const complaintAria = isOfficer ? "New and updated complaint case notifications" : "Complaint feedback and status updates";

  root.innerHTML = `
    <div class="gmail-card-head">
      <div class="gmail-card-title-wrap">
        <span class="gmail-card-icon" aria-hidden="true"><i class="fa-solid fa-envelope"></i></span>
        <div>
          <strong>Recovery & Email Alerts</strong>
          <span>Personal Gmail</span>
        </div>
      </div>
      <small class="gmail-self-service-badge">${selfServiceLabel}</small>
    </div>

    <p class="gmail-card-intro">
      Add a personal Gmail for recovery and USC email alerts. Your school login stays unchanged.
    </p>

    <div id="gmailState" class="gmail-status-card" data-state="loading" role="status" aria-live="polite">
      <span class="gmail-status-icon" aria-hidden="true"><i class="fa-solid fa-circle-notch fa-spin"></i></span>
      <span class="gmail-status-copy">
        <strong>Loading Gmail settings</strong>
        <small>Please wait while we check your saved recovery email.</small>
      </span>
    </div>

    <form id="gmailForm" class="gmail-editor-form">
      <fieldset>
        <label class="gmail-field-label" for="gmailAddress">Personal Gmail address</label>
        <div class="gmail-input-wrap">
          <span class="gmail-input-icon" aria-hidden="true"><i class="fa-brands fa-google"></i></span>
          <input id="gmailAddress" type="email" placeholder="ssuuniversitystudentcouncil@gmail.com" autocomplete="email" maxlength="254" required>
        </div>
        <p class="gmail-field-help">We’ll send a verification link. Recovery and alerts activate after you confirm it.</p>

        <div class="gmail-preferences-head">
          <div>
            <strong>Email preferences</strong>
            <small>Choose which USC alerts to receive.</small>
          </div>
        </div>

        <div class="gmail-options">
          <label class="gmail-option-row">
            <span class="gmail-option-icon"><i class="fa-regular fa-message"></i></span>
            <span class="gmail-option-copy"><strong>${complaintTitle}</strong><small>${complaintDetail}</small></span>
            <input id="gmailComplaints" type="checkbox" checked aria-label="${complaintAria}">
          </label>
          <label class="gmail-option-row">
            <span class="gmail-option-icon"><i class="fa-solid fa-check-to-slot"></i></span>
            <span class="gmail-option-copy"><strong>Election updates</strong><small>${isOfficer ? "Election phase and result activity" : "Voting opening and published results"}</small></span>
            <input id="gmailElections" type="checkbox" checked aria-label="Election opening and published results">
          </label>
          <label class="gmail-option-row">
            <span class="gmail-option-icon"><i class="fa-regular fa-calendar-check"></i></span>
            <span class="gmail-option-copy"><strong>Announcements, events & programs</strong><small>New USC announcements, university events, and external program notices</small></span>
            <input id="gmailNews" type="checkbox" checked aria-label="New announcements, events, and programs">
          </label>
          <label class="gmail-option-row gmail-option-row-important">
            <span class="gmail-option-icon"><i class="fa-solid fa-key"></i></span>
            <span class="gmail-option-copy"><strong>Password recovery</strong><small>Receive reset links through this verified Gmail</small></span>
            <input id="gmailRecovery" type="checkbox" checked aria-label="Allow password recovery through this Gmail">
          </label>
        </div>

        <div class="gmail-actions">
          <button type="submit" class="gmail-save-button"><i class="fa-solid fa-floppy-disk"></i><span>Save Gmail</span></button>
          <button id="gmailRemove" type="button" class="gmail-remove-button"><i class="fa-regular fa-trash-can"></i><span>Remove Gmail</span></button>
        </div>
      </fieldset>
    </form>

    <div class="gmail-security-note">
      <i class="fa-solid fa-shield-halved" aria-hidden="true"></i>
      <p><strong>Your school login stays the same.</strong> This Gmail is only for recovery and enabled alerts.</p>
    </div>

    <p id="gmailMessage" class="gmail-message" role="status" aria-live="polite"></p>
  `;

  const el = id => root.querySelector(`#${id}`);
  const fieldset = root.querySelector("fieldset");
  let settings = null;

  function setStatus(stateName, title, detail, iconClass) {
    const state = el("gmailState");
    if (!state) return;
    state.dataset.state = stateName;
    const icon = state.querySelector(".gmail-status-icon i");
    const titleEl = state.querySelector(".gmail-status-copy strong");
    const detailEl = state.querySelector(".gmail-status-copy small");
    if (icon) icon.className = iconClass;
    if (titleEl) titleEl.textContent = title;
    if (detailEl) detailEl.textContent = detail;
  }

  function setMessage(message = "", kind = "") {
    const messageEl = el("gmailMessage");
    if (!messageEl) return;
    messageEl.textContent = message;
    messageEl.dataset.kind = kind;
  }

  function renderState() {
    if (!isSupabaseEmailConfigured()) {
      setStatus(
        "error",
        "Email service unavailable",
        "The Supabase email function is not configured on this deployment yet.",
        "fa-solid fa-triangle-exclamation"
      );
      return;
    }
    if (!settings?.requestedEmail) {
      setStatus(
        "empty",
        "No personal Gmail connected",
        "Enter your Gmail below, save it, then confirm the message sent to your inbox.",
        "fa-regular fa-envelope"
      );
      return;
    }
    if (settings.active) {
      setStatus(
        "active",
        "Gmail verified and active",
        settings.verifiedEmail || settings.requestedEmail,
        "fa-solid fa-circle-check"
      );
      return;
    }
    if (settings.verificationSentAt) {
      setStatus(
        "pending",
        "Confirmation email sent",
        `Open ${settings.requestedEmail} and click the confirmation link. No administrator approval is required.`,
        "fa-regular fa-paper-plane"
      );
      return;
    }
    setStatus(
      "pending",
      "Waiting for Gmail confirmation",
      `${settings.requestedEmail} has been saved but still needs email confirmation.`,
      "fa-regular fa-clock"
    );
  }

  function hydrate(next) {
    settings = next || {};
    el("gmailAddress").value = settings.requestedEmail || "";
    el("gmailComplaints").checked = settings.complaints !== false;
    el("gmailElections").checked = settings.elections !== false;
    el("gmailNews").checked = settings.news !== false;
    el("gmailRecovery").checked = settings.recovery !== false;
    renderState();
  }

  async function load() {
    fieldset.disabled = true;
    setMessage("");
    try {
      const response = await callStudentEmailService("get");
      hydrate(response.settings);
    } catch (error) {
      const detail = String(error?.message || "Could not load email settings.").trim();
      setStatus(
        "error",
        "Could not load Gmail settings",
        detail || "Check the Supabase Edge Function deployment and email-service SQL setup.",
        "fa-solid fa-triangle-exclamation"
      );
      setMessage(detail || "Could not load email settings.", "error");
    } finally {
      fieldset.disabled = false;
    }
  }

  async function save(remove = false) {
    setMessage("");
    try {
      if (remove && !window.confirm("Remove this Gmail from notifications and password recovery?")) return;
      fieldset.disabled = true;
      const response = remove
        ? await callStudentEmailService("remove")
        : await callStudentEmailService("save", {
            email: canonicalGmail(el("gmailAddress").value),
            complaints: el("gmailComplaints").checked,
            elections: el("gmailElections").checked,
            news: el("gmailNews").checked,
            recovery: el("gmailRecovery").checked,
          });
      hydrate(response.settings);
      setMessage(response.message || (remove ? "Gmail removed." : "Gmail saved."), "success");
    } catch (error) {
      setMessage(error.message || "Could not save Gmail settings.", "error");
    } finally {
      fieldset.disabled = false;
    }
  }

  el("gmailForm").addEventListener("submit", event => { event.preventDefault(); save(false); });
  el("gmailRemove").addEventListener("click", () => save(true));
  await load();
}
