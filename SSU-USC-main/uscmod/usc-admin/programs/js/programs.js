import {mountParticipationTracklist} from "../../../shared/participation-tracklist.js";
import {bindParticipationForm} from "../../../shared/participation-form.js";
import {mountParticipationOfficer} from "../../../shared/participation-officer.js";
import { trackedOfficerAction, activityAttributionText, activityHistoryHref } from '../../../shared/officer-activity-client.js';
import { classifyEngagement } from "../../../shared/engagement-report-model.mjs";
import { mountEngagementAnalytics } from "../../../shared/engagement-analytics.js?v=3";
import { hasOfficerPermission } from "../../shared/js/officer-rbac.js?v=programs-1";
import { db, auth } from "../../../firebase/firebase-config.js";
import { secureUpload, hydrateMediaImages } from "../../../shared/security-client.js?v=program-media-1";
import {
  addDoc,
  updateDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";

const uscAuthAllowed = await (globalThis.USC_AUTH_READY || Promise.resolve(false));
if (uscAuthAllowed !== true) await new Promise(() => {});

const engagementAnalytics = mountEngagementAnalytics(document.getElementById("engagementAnalytics"), { kind: "programs", canGenerate: () => hasOfficerPermission("reports.generate") });
const reportRegistrations = new Map();
let eventsFeedReady = false;

const eventsCollection = collection(db, "programs");

const eventForm = document.getElementById("eventForm");
const participationForm = bindParticipationForm(eventForm,"programs");
if (hasOfficerPermission("programs.manage")) {
  mountParticipationOfficer("programs");
  mountParticipationTracklist("programs");
}
const eventTitleInput = document.getElementById("eventTitle");
const eventDateInput = document.getElementById("eventDate");
const eventVenueInput = document.getElementById("eventVenue");
const eventStartTimeInput = document.getElementById("eventStartTime");
const eventEndTimeInput = document.getElementById("eventEndTime");
const eventCategoryInput = document.getElementById("eventCategory");
const eventDescriptionInput = document.getElementById("eventDescription");
const eventAudienceInput = document.getElementById("eventAudience");
const eventReminderEnabledInput = document.getElementById("eventReminderEnabled");
const eventRegistrationModeInput = document.getElementById("eventRegistrationMode");
const eventRegistrationDeadlineInput = document.getElementById("eventRegistrationDeadline");
const eventRegistrationDeadlineField = document.getElementById("eventRegistrationDeadlineField");
const eventExternalRegistrationField = document.getElementById("eventExternalRegistrationField");
const eventExternalRegistrationUrlInput = document.getElementById("eventExternalRegistrationUrl");
const eventParticipationNotesInput = document.getElementById("eventParticipationNotes");
const programHostOrganizationInput = document.getElementById("programHostOrganization");
const eventBackgroundImageInput = document.getElementById("eventBackgroundImage");
const eventImagePickerBtn = document.getElementById("eventImagePickerBtn");
const eventImageFileName = document.getElementById("eventImageFileName");
const eventImagePreviewWrap = document.getElementById("eventImagePreviewWrap");
const eventImagePreview = document.getElementById("eventImagePreview");
const publishEventBtn = document.getElementById("publishEventBtn");
const clearEventBtn = document.getElementById("clearEventBtn");
const scrollToEventFormBtn = document.getElementById("scrollToEventFormBtn");

const upcomingEventCountEl = document.getElementById("upcomingEventCount");
const publishedEventCountEl = document.getElementById("publishedEventCount");
const reminderEnabledCountEl = document.getElementById("reminderEnabledCount");
const confirmedAttendanceCountEl = document.getElementById("confirmedAttendanceCount");
const recentEventsList = document.getElementById("recentEventsList");

const participantsModal = document.getElementById("eventParticipantsModal");
const participantsBackdrop = document.getElementById("eventParticipantsBackdrop");
const participantsClose = document.getElementById("eventParticipantsClose");
const participantsTitle = document.getElementById("eventParticipantsTitle");
const participantsBody = document.getElementById("eventParticipantsBody");

let selectedEventImageFile = null;
let selectedEventImageObjectUrl = "";
let lastEvents = [];
let editingEventId = null;
let savingRecord = false;
let participantsReturnFocus = null;
const programSearch = document.getElementById("programSearch");
const programStatusFilter = document.getElementById("programStatusFilter");
const programResultsCount = document.getElementById("programResultsCount");
let registrationCounts = new Map();
const registrationCountUnsubs = new Map();

function safeText(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function parseEventDate(rawValue) {
  const cleanValue = safeText(rawValue);
  if (!cleanValue) return null;
  const parsedDate = new Date(`${cleanValue}T00:00:00`);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
}

function timestampDate(rawValue) {
  if (!rawValue) return null;
  const parsed = typeof rawValue?.toDate === "function" ? rawValue.toDate() : new Date(rawValue);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatEventDate(rawValue) {
  const parsedDate = parseEventDate(rawValue);
  return parsedDate
    ? parsedDate.toLocaleDateString([], {
        month: "long",
        day: "numeric",
        year: "numeric"
      })
    : "Date not set";
}

function formatRegistrationDeadline(eventItem) {
  const deadline = timestampDate(eventItem.registrationDeadline);
  if (!deadline) return "Not required";
  return deadline.toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function isUpcomingEvent(eventItem) {
  return classifyEngagement(eventItem) === "Upcoming";
}

function getEventStatus(eventItem) {
  return classifyEngagement(eventItem);
}

function registrationModeLabel(mode) {
  const value = safeText(mode, "none").toLowerCase();
  if (value === "internal") return "USC Portal registration";
  if (value === "external") return "External registration link";
  return "No registration required";
}

function isValidExternalUrl(value) {
  try {
    const url = new URL(safeText(value));
    return ["https:", "http:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function releaseEventImageObjectUrl() {
  if (selectedEventImageObjectUrl) {
    URL.revokeObjectURL(selectedEventImageObjectUrl);
    selectedEventImageObjectUrl = "";
  }
}

function setEventImageFileName(name = "No image selected") {
  if (eventImageFileName) eventImageFileName.textContent = name;
}

function setEventImagePreview(source = "") {
  if (!eventImagePreviewWrap || !eventImagePreview) return;
  if (source) {
    eventImagePreview.src = source;
    eventImagePreview.alt = safeText(eventTitleInput?.value, "Selected program background preview");
    eventImagePreviewWrap.hidden = false;
  } else {
    eventImagePreview.removeAttribute("src");
    eventImagePreviewWrap.hidden = true;
  }
}

function validateImageFile(file) {
  if (!file) return;
  const allowedTypes = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
  const maxFileSize = 5 * 1024 * 1024;
  if (!allowedTypes.has(file.type)) {
    throw new Error("Only JPG, PNG, and WEBP program images are allowed.");
  }
  if (file.size > maxFileSize) {
    throw new Error("Program background image must not exceed 5MB.");
  }
}

async function uploadEventImage(file) {
  if (!file) return { imageUrl: "", imagePath: "" };
  validateImageFile(file);
  const ticket = await secureUpload(file, "program-media");
  return { imageUrl: ticket.publicUrl, imagePath: ticket.path };
}

function syncRegistrationFields() {
  const mode = safeText(eventRegistrationModeInput?.value, "internal").toLowerCase();
  const needsDeadline = mode === "internal" || mode === "external";
  const needsExternalLink = mode === "external";

  if (eventRegistrationDeadlineField) eventRegistrationDeadlineField.hidden = true;
  if (eventRegistrationDeadlineInput) {
    eventRegistrationDeadlineInput.required = false;
    if (!needsDeadline) eventRegistrationDeadlineInput.value = "";
  }

  if (eventExternalRegistrationField) eventExternalRegistrationField.hidden = !needsExternalLink;
  if (eventExternalRegistrationUrlInput) {
    eventExternalRegistrationUrlInput.required = needsExternalLink;
    if (!needsExternalLink) eventExternalRegistrationUrlInput.value = "";
  }
}

function resetEventForm() {
  editingEventId = null;
  const heading = document.querySelector('#programFormCard summary h2');
  if (heading) heading.textContent = 'Create program';
  if (clearEventBtn) clearEventBtn.innerHTML = '<i class="fa-solid fa-eraser" aria-hidden="true"></i> Clear Form';
  eventForm?.reset();
  selectedEventImageFile = null;
  releaseEventImageObjectUrl();
  setEventImageFileName();
  setEventImagePreview();

  if (eventAudienceInput) eventAudienceInput.value = "All Students";
  if (eventReminderEnabledInput) eventReminderEnabledInput.value = "true";
  if (eventRegistrationModeInput) eventRegistrationModeInput.value = "internal";
  if (eventCategoryInput) eventCategoryInput.value = "Community Outreach";
  if (programHostOrganizationInput) programHostOrganizationInput.value = "";
  syncRegistrationFields();
  setLoadingState(false);
}

function setLoadingState(isLoading) {
  if (!publishEventBtn) return;
  savingRecord = isLoading;
  publishEventBtn.disabled = isLoading;
  if (clearEventBtn) clearEventBtn.disabled = isLoading;
  if (editingEventId) { publishEventBtn.textContent = isLoading ? 'Saving changes…' : 'Save changes'; return; }
  publishEventBtn.innerHTML = isLoading
    ? '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Publishing...'
    : '<i class="fa-solid fa-paper-plane" aria-hidden="true"></i> Publish Program';
}

function renderEmptyState() {
  if (!recentEventsList) return;
  recentEventsList.innerHTML = `
    <div class="empty-state module-empty-state">
      <span class="empty-state-icon"><i class="fa-solid fa-earth-americas" aria-hidden="true"></i></span>
      <strong>Nothing published yet</strong>
      <span>Create a program to get started.</span>
    </div>
  `;
}

function totalWebsiteRegistrations() {
  let total = 0;
  registrationCounts.forEach((count) => { total += Number(count || 0); });
  return total;
}

function updateStats(events) {
  const upcomingEvents = events.filter(isUpcomingEvent);
  const remindersEnabled = events.filter((eventItem) => eventItem.reminderEnabled === true);

  if (upcomingEventCountEl) upcomingEventCountEl.textContent = String(upcomingEvents.length);
  if (publishedEventCountEl) publishedEventCountEl.textContent = String(events.length);
  if (reminderEnabledCountEl) reminderEnabledCountEl.textContent = String(remindersEnabled.length);
  if (confirmedAttendanceCountEl) confirmedAttendanceCountEl.textContent = String(totalWebsiteRegistrations());
  if (eventsFeedReady) engagementAnalytics.update(events, reportRegistrations);
}


let fullDetailDialog = null;
let fullDetailId = '';
function openPublishedDetails(card) {
  const template = card?.querySelector('template.event-full-detail');
  if (!template) return;
  if (!fullDetailDialog) {
    fullDetailDialog = document.createElement('dialog');
    fullDetailDialog.className = 'event-full-detail-dialog';
    fullDetailDialog.setAttribute('aria-labelledby', 'publishedDetailsHeading');
    fullDetailDialog.innerHTML = '<div class="event-full-detail-top"><h2 id="publishedDetailsHeading">Full details</h2><button type="button" class="event-full-detail-close" aria-label="Close details" autofocus>×</button></div><div class="event-full-detail-body"></div>';
    document.body.append(fullDetailDialog);
    fullDetailDialog.querySelector('.event-full-detail-close').addEventListener('click', () => fullDetailDialog.close());
    fullDetailDialog.addEventListener('click', ev => { if (ev.target !== fullDetailDialog) return; const r=fullDetailDialog.getBoundingClientRect(); if(ev.clientX<r.left||ev.clientX>r.right||ev.clientY<r.top||ev.clientY>r.bottom) fullDetailDialog.close(); });
    fullDetailDialog.addEventListener('close', () => {
      const button = Array.from(recentEventsList.querySelectorAll('[data-view-details]')).find(el => el.dataset.viewDetails === fullDetailId);
      button?.focus({preventScroll:true});
      fullDetailDialog.querySelector('.event-full-detail-body').replaceChildren();
    });
  }
  fullDetailId = card.dataset.recordId;
  const content = fullDetailDialog.querySelector('.event-full-detail-body');
  content.replaceChildren(template.content.cloneNode(true));
  if (!fullDetailDialog.open) fullDetailDialog.showModal();
  fullDetailDialog.querySelector('.event-full-detail-close').focus();
  hydrateMediaImages(content).catch(error => console.warn('Unable to load activity details media:',error));
}
recentEventsList?.addEventListener('click', event => {
  const card = event.target.closest('.event-published-card[data-record-id]');
  if (!card) return;
  if (event.target.closest('[data-view-details]')) { openPublishedDetails(card); return; }
  if (!event.target.closest('button, a, input, select, textarea, .event-card-actions')) openPublishedDetails(card);
});

function renderEvents(events) {
  if (!recentEventsList) return;
  const search = safeText(programSearch?.value).toLowerCase();
  const filter = programStatusFilter?.value || "all";
  const filteredEvents = events.filter(item =>
    (filter === "all" || getEventStatus(item) === filter) &&
    [item.title, item.venue, item.category, item.hostOrganization].some(value => safeText(value).toLowerCase().includes(search))
  );
  if (programResultsCount) programResultsCount.textContent = `${filteredEvents.length} of ${events.length} programs`;
  if (!events.length) {
    renderEmptyState();
    return;
  }

  if (!filteredEvents.length) {
    recentEventsList.innerHTML = '<div class="empty-state module-empty-state"><strong>No matching programs</strong><span>Try another search or status.</span></div>';
    return;
  }
  recentEventsList.innerHTML = filteredEvents
    .map((eventItem) => {
      const status = getEventStatus(eventItem);
      const badgeClass = status === "Upcoming" ? "live" : "review";
      const reminderText = eventItem.reminderEnabled ? "Reminders on" : "Reminders off";
      const mode = safeText(eventItem.registrationMode, "none").toLowerCase();
      const websiteRegistrations = registrationCounts.get(eventItem.id) || 0;
      const imageUrl = safeText(eventItem.imageUrl || eventItem.posterUrl);
      const imageMarkup = imageUrl
        ? `<img class="event-published-thumb" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(safeText(eventItem.title, "Program background"))}">`
        : "";
      const participantButton = mode === "internal"
        ? `<button class="mini-btn light" type="button" data-view-participants="${escapeHtml(eventItem.id)}"><i class="fa-solid fa-user-group" aria-hidden="true"></i> Participants (${websiteRegistrations})</button>`
        : "";

      return `
        <article class="list-item event-published-card" data-record-id="${escapeHtml(eventItem.id)}">
          <button class="event-summary-button" type="button" data-view-details="${escapeHtml(eventItem.id)}" aria-haspopup="dialog">
            ${imageMarkup}
            <span class="item-title event-summary-title">${escapeHtml(safeText(eventItem.title, "Untitled Program"))}</span>
          <span class="event-core-meta">
            <span class="event-core-meta-item"><i class="fa-regular fa-calendar"></i><span><small>Date</small><strong>${escapeHtml(formatEventDate(eventItem.eventDate))}</strong></span></span>
            <span class="event-core-meta-item"><i class="fa-regular fa-clock"></i><span><small>Time</small><strong>${escapeHtml(safeText(eventItem.startTime, "TBA"))}${eventItem.endTime ? ` - ${escapeHtml(eventItem.endTime)}` : ""}</strong></span></span>
            <span class="event-core-meta-item"><i class="fa-solid fa-location-dot"></i><span><small>Venue</small><strong>${escapeHtml(safeText(eventItem.venue, "TBA"))}</strong></span></span>
          </span>

            <span class="event-compact-registration"><small>Registration</small><strong>${escapeHtml(registrationModeLabel(mode))}</strong>${mode !== "none" ? `<span>Closes: ${escapeHtml(formatRegistrationDeadline(eventItem))}</span>` : ""}</span>
            <span class="event-details-hint">View full details <i class="fa-solid fa-chevron-right" aria-hidden="true"></i></span>
          </button>
          <template class="event-full-detail">

          ${imageMarkup}
          <div class="item-top">
            <div class="event-published-heading">
              <span class="published-type-icon"><i class="fa-solid fa-earth-americas" aria-hidden="true"></i></span>
              <div>
                <h3 class="item-title">${escapeHtml(safeText(eventItem.title, "Untitled Program"))}</h3>
                <span class="event-category-chip"><i class="fa-solid fa-tag"></i>${escapeHtml(safeText(eventItem.category, "External Program"))}</span>
              </div>
            </div>
            <div class="event-item-controls">
              <div class="badge ${badgeClass}" data-engagement-status="${status}"><i class="fa-solid fa-circle" aria-hidden="true"></i>${status}</div>

            </div>
          </div>
          <div class="event-core-meta">
            <span class="event-core-meta-item"><i class="fa-regular fa-calendar"></i><span><small>Date</small><strong>${escapeHtml(formatEventDate(eventItem.eventDate))}</strong></span></span>
            <span class="event-core-meta-item"><i class="fa-regular fa-clock"></i><span><small>Time</small><strong>${escapeHtml(safeText(eventItem.startTime, "TBA"))}${eventItem.endTime ? ` - ${escapeHtml(eventItem.endTime)}` : ""}</strong></span></span>
            <span class="event-core-meta-item"><i class="fa-solid fa-location-dot"></i><span><small>Venue</small><strong>${escapeHtml(safeText(eventItem.venue, "TBA"))}</strong></span></span>
            <span class="event-core-meta-item"><i class="fa-solid fa-handshake" aria-hidden="true"></i><span><small>Host</small><strong>${escapeHtml(safeText(eventItem.hostOrganization, "External partner"))}</strong></span></span>
          </div>
          <div class="item-text">${escapeHtml(safeText(eventItem.description, "No program description provided."))}</div>
          <div class="event-meta-line">
            <span><i class="fa-solid fa-users"></i> ${escapeHtml(safeText(eventItem.audience, "All Students"))}</span>
            <span><i class="fa-regular fa-bell"></i> ${reminderText}</span>
            <span><i class="fa-solid fa-ticket"></i> ${escapeHtml(registrationModeLabel(mode))}</span>
            ${mode !== "none" ? `<span class="event-deadline"><i class="fa-solid fa-hourglass-end" aria-hidden="true"></i> Registration closes: ${escapeHtml(formatRegistrationDeadline(eventItem))}</span>` : ""}
          </div>
          ${eventItem.participationNotes ? `<div class="event-participation-note"><i class="fa-solid fa-circle-info" aria-hidden="true"></i><div><strong>Participation instructions</strong><span>${escapeHtml(eventItem.participationNotes)}</span></div></div>` : ""}
          ${eventItem.activityAttribution ? `<p class="event-meta-line">${escapeHtml(activityAttributionText(eventItem.activityAttribution))}</p>` : ''}

            ${mode === "external" && isValidExternalUrl(eventItem.externalRegistrationUrl) ? `<a href="${escapeHtml(eventItem.externalRegistrationUrl)}" target="_blank" rel="noopener noreferrer">Open registration link</a>` : ""}
          </template>
          <div class="event-card-actions">
            ${participantButton}
            <button class="mini-btn danger" type="button" data-delete-event="${escapeHtml(eventItem.id)}" data-rbac-permission="programs.manage"><i class="fa-solid fa-trash-can" aria-hidden="true"></i> Archive</button>
            <button class="mini-btn light" type="button" data-edit-event="${escapeHtml(eventItem.id)}" data-rbac-permission="programs.manage">Edit</button>
            <a class="mini-btn light" href="${escapeHtml(activityHistoryHref('Programs', eventItem.id))}">Activity history</a>
          </div>
        </article>
      `;
    })
    .join("");
  hydrateMediaImages(recentEventsList).catch((error) => console.warn("Unable to load program media:", error));
}

function subscribeToEvents() {
  const eventsQuery = query(eventsCollection, orderBy("publishedAtMs", "desc"));
  onSnapshot(
    eventsQuery,
    (snapshot) => {
      eventsFeedReady = true;
      lastEvents = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })).filter(row => !row.officerArchived);
      bindRegistrationCountListeners(lastEvents);
      updateStats(lastEvents);
      renderEvents(lastEvents);
    },
    (error) => {
      console.error("Unable to read programs:", error);
      eventsFeedReady = false;
      lastEvents = [];
      bindRegistrationCountListeners([]);
      updateStats([]);
      engagementAnalytics.setError("Unable to load programs. Reload this page to reconnect.");
      if (programResultsCount) programResultsCount.textContent = "";
      recentEventsList.innerHTML = '<div class="empty-state" role="alert">Unable to load programs. Check your connection and reload the page.</div>';
    }
  );
}

function bindRegistrationCountListeners(events) {
  const liveInternalIds = new Set(
    events
      .filter((eventItem) => safeText(eventItem.registrationMode, "none").toLowerCase() === "internal")
      .map((eventItem) => eventItem.id)
  );

  registrationCountUnsubs.forEach((unsubscribe, eventId) => {
    if (!liveInternalIds.has(eventId)) {
      unsubscribe();
      registrationCountUnsubs.delete(eventId);
      registrationCounts.delete(eventId);
      reportRegistrations.delete(eventId);
    }
  });

  liveInternalIds.forEach((eventId) => {
    if (registrationCountUnsubs.has(eventId)) return;
    reportRegistrations.set(eventId, { state: "loading", records: [] });
    const unsubscribe = onSnapshot(
      collection(db, "programs", eventId, "registrations"),
      (snapshot) => {
        if (!eventsFeedReady) return;
        reportRegistrations.set(eventId, { state: "ready", records: snapshot.docs.map(row => row.data()) });
        registrationCounts.set(eventId, snapshot.size);
        updateStats(lastEvents);
        renderEvents(lastEvents);
      },
      (error) => {
        console.warn(`Registration count unavailable for ${eventId}:`, error);
        if (!eventsFeedReady) return;
        reportRegistrations.set(eventId, { state: "unavailable", records: [] });
        registrationCounts.set(eventId, 0);
        updateStats(lastEvents);
        renderEvents(lastEvents);
      }
    );
    registrationCountUnsubs.set(eventId, unsubscribe);
  });

  updateStats(events);
}

function closeParticipantsModal() {
  if (!participantsModal) return;
  participantsModal.hidden = true;
  if (participantsReturnFocus?.isConnected) participantsReturnFocus.focus();
  document.body.classList.remove("event-participants-modal-open");
}

async function openParticipantsModal(eventId) {
  if (!participantsModal || !participantsBody) return;
  const eventItem = lastEvents.find((item) => item.id === eventId);
  participantsTitle.textContent = eventItem ? safeText(eventItem.title, "Program participants") : "Program participants";
  participantsBody.innerHTML = `<div class="empty-state">Loading registrations...</div>`;
  participantsReturnFocus = document.activeElement;
  participantsModal.hidden = false;
  participantsClose?.focus();
  document.body.classList.add("event-participants-modal-open");

  try {
    const snapshot = await getDocs(collection(db, "programs", eventId, "registrations"));
    const rows = snapshot.docs
      .map((registrationDoc) => ({ id: registrationDoc.id, ...registrationDoc.data() }))
      .sort((a, b) => safeText(a.fullName).localeCompare(safeText(b.fullName)));

    if (!rows.length) {
      participantsBody.innerHTML = `<div class="empty-state">No students have registered through the portal yet.</div>`;
      return;
    }

    participantsBody.innerHTML = `
      <div class="event-participant-count">${rows.length} registered student${rows.length === 1 ? "" : "s"}</div>
      <div class="event-participant-list">
        ${rows.map((row) => `
          <article class="event-participant-row">
            <div class="event-participant-avatar">${escapeHtml(safeText(row.fullName, "S").split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase())}</div>
            <div>
              <strong>${escapeHtml(safeText(row.fullName, "Student"))}</strong>
              <span>${escapeHtml(safeText(row.studentId, "No Student ID"))}</span>
              <small>${escapeHtml(safeText(row.schoolEmail, "No school email"))}${row.program ? ` · ${escapeHtml(row.program)}` : ""}${row.college ? ` · ${escapeHtml(row.college)}` : ""}${row.yearLevel ? ` · ${escapeHtml(row.yearLevel)}` : ""}</small>
            </div>
            <span class="event-participant-status">Registered</span>
          </article>
        `).join("")}
      </div>`;
  } catch (error) {
    console.error("Unable to load program participants:", error);
    participantsBody.innerHTML = `<div class="empty-state">Unable to load registrations. Check your Programs permission and Firestore rules.</div>`;
  }
}

eventRegistrationModeInput?.addEventListener("change", syncRegistrationFields);

eventImagePickerBtn?.addEventListener("click", () => {
  eventBackgroundImageInput?.click();
});

eventBackgroundImageInput?.addEventListener("change", (event) => {
  const file = event.target.files?.[0] || null;
  releaseEventImageObjectUrl();

  if (!file) {
    selectedEventImageFile = null;
    setEventImageFileName();
    setEventImagePreview();
    return;
  }

  try {
    validateImageFile(file);
    selectedEventImageFile = file;
    selectedEventImageObjectUrl = URL.createObjectURL(file);
    setEventImageFileName(file.name);
    setEventImagePreview(selectedEventImageObjectUrl);
  } catch (error) {
    selectedEventImageFile = null;
    if (eventBackgroundImageInput) eventBackgroundImageInput.value = "";
    setEventImageFileName();
    setEventImagePreview();
    alert(error.message || "Invalid program image.");
  }
});

eventTitleInput?.addEventListener("input", () => {
  if (eventImagePreview && selectedEventImageObjectUrl) {
    eventImagePreview.alt = safeText(eventTitleInput.value, "Selected program background preview");
  }
});

eventForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (savingRecord || !hasOfficerPermission("programs.manage")) return;
  const title = safeText(eventTitleInput?.value);
  const eventDate = safeText(eventDateInput?.value);
  const venue = safeText(eventVenueInput?.value);
  const startTime = safeText(eventStartTimeInput?.value);
  const endTime = safeText(eventEndTimeInput?.value);
  const category = safeText(eventCategoryInput?.value, "Community Outreach");
  const description = safeText(eventDescriptionInput?.value);
  const audience = safeText(eventAudienceInput?.value, "All Students");
  const reminderEnabled = safeText(eventReminderEnabledInput?.value, "true") === "true";
  const registrationMode = "internal";
  const deadlineRaw = safeText(eventRegistrationDeadlineInput?.value);
  const externalRegistrationUrl = safeText(eventExternalRegistrationUrlInput?.value);
  const participationNotes = safeText(eventParticipationNotesInput?.value);
  const hostOrganization = safeText(programHostOrganizationInput?.value);

  if (!title || !eventDate || !venue || !description || !hostOrganization) {
    alert("Please complete all required program fields, including the host organization.");
    return;
  }

  if (startTime && endTime && endTime <= startTime) {
    alert("Program end time must be later than the start time.");
    return;
  }

  const needsRegistration = registrationMode === "internal" || registrationMode === "external";
  let registrationDeadline = null;

  if (needsRegistration) {
    if (!deadlineRaw) {
      alert("Please set a registration deadline.");
      return;
    }
    const deadlineDate = new Date(deadlineRaw + ":00+08:00");
    if (Number.isNaN(deadlineDate.getTime())) {
      alert("The registration deadline is invalid.");
      return;
    }
    const original = lastEvents.find(row => row.id === editingEventId);
    const oldDeadline = timestampDate(original?.registrationDeadline);
    const unchangedDeadline = original?.registrationMode === registrationMode && oldDeadline && Math.floor(oldDeadline.getTime() / 60000) === Math.floor(deadlineDate.getTime() / 60000);
    if (deadlineDate.getTime() <= Date.now() && !unchangedDeadline) {
      alert("Registration deadline must be in the future.");
      return;
    }

    const eventEndBoundary = new Date(`${eventDate}T23:59:59+08:00`);
    if (!Number.isNaN(eventEndBoundary.getTime()) && deadlineDate.getTime() > eventEndBoundary.getTime()) {
      alert("Registration deadline cannot be after the program date.");
      return;
    }
    registrationDeadline = Timestamp.fromDate(unchangedDeadline ? oldDeadline : deadlineDate);
  }

  if (registrationMode === "external" && !isValidExternalUrl(externalRegistrationUrl)) {
    alert("Please enter a valid http:// or https:// external registration URL.");
    return;
  }

  setLoadingState(true);

  try {
    const existing = lastEvents.find(row => row.id === editingEventId);
    if (editingEventId && !existing) throw new Error("This record is no longer available. Refresh the page and try again.");
    const { imageUrl, imagePath } = !selectedEventImageFile && existing ? { imageUrl: safeText(existing.imageUrl || existing.posterUrl), imagePath: safeText(existing.imagePath) } : await uploadEventImage(selectedEventImageFile);

    const participationConfig = participationForm.read();
    const publicationInput = {
      ...participationConfig,
      title,
      eventDate,
      venue,
      startTime,
      endTime,
      category,
      description,
      audience,
      reminderEnabled,
      registrationMode,
      registrationDeadline,
      externalRegistrationUrl: registrationMode === "external" ? externalRegistrationUrl : "",
      participationNotes,
      hostOrganization,
      sourceType: "program",
      externalProgram: true,
      imageUrl,
      imagePath,
      status: "Published",
      registeredParticipants: 0,
      confirmedAttendance: 0,
      createdByUid: auth.currentUser?.uid || "",
      createdByEmail: auth.currentUser?.email || "",
      publishedAt: serverTimestamp(),
      publishedAtMs: Date.now(),
      updatedAt: serverTimestamp()
    };
    const tracked = await trackedOfficerAction({ module: "programs", action: editingEventId ? "update" : "publish", recordId: editingEventId || undefined, input: publicationInput });
    if (!tracked) {
      if (editingEventId) {
        const { createdByUid, createdByEmail, publishedAt, publishedAtMs, registeredParticipants, confirmedAttendance, ...changes } = publicationInput;
        await updateDoc(doc(eventsCollection, editingEventId), changes);
      } else await addDoc(eventsCollection, publicationInput);
    }

    alert(editingEventId ? "Current record updated. Earlier versions remain preserved in My O-Tracklists." : imageUrl
      ? "Program published successfully. Students can now view it in Events / Programs."
      : "Program published successfully. Students can now view it in Events / Programs.");
    resetEventForm();
  } catch (error) {
    console.error("Unable to publish program:", error);
    alert(error.message || "Failed to publish program.");
  } finally {
    setLoadingState(false);
  }
});

recentEventsList?.addEventListener("click", async (event) => {
  const editButton = event.target.closest('[data-edit-event]');
  if (editButton) {
    const saved = lastEvents.find(row => row.id === editButton.dataset.editEvent);
    if (!saved || saved.officerArchived || savingRecord || !hasOfficerPermission('programs.manage')) return;
    resetEventForm(); editingEventId = saved.id;
    const fields = { title: eventTitleInput, eventDate: eventDateInput, venue: eventVenueInput, startTime: eventStartTimeInput, endTime: eventEndTimeInput, category: eventCategoryInput, description: eventDescriptionInput, audience: eventAudienceInput, registrationMode: eventRegistrationModeInput, externalRegistrationUrl: eventExternalRegistrationUrlInput, participationNotes: eventParticipationNotesInput, hostOrganization: programHostOrganizationInput };
    for (const [key, input] of Object.entries(fields)) if (input) input.value = saved[key] || '';
    participationForm.fill(saved);
    eventReminderEnabledInput.value = String(saved.reminderEnabled === true);
    const deadline = timestampDate(saved.registrationDeadline);
    if (deadline && !saved.registrationClosesAtMs) eventRegistrationDeadlineInput.value = new Date(deadline.getTime()+8*3600000).toISOString().slice(0,16);
    syncRegistrationFields();
    const composer = document.getElementById('programFormCard');
    if (composer) composer.open = true;
    scrollToEventFormBtn?.setAttribute('aria-expanded', 'true');
    const heading = composer?.querySelector('summary h2');
    if (heading) heading.textContent = 'Edit program';
    if (clearEventBtn) clearEventBtn.textContent = 'Cancel edit';
    setLoadingState(false);
    const existingImage = safeText(saved.imageUrl || saved.posterUrl);
    if (existingImage) {
      setEventImageFileName('Existing image retained');
      setEventImagePreview(existingImage);
      if (eventImagePreviewWrap) hydrateMediaImages(eventImagePreviewWrap).catch(console.warn);
    }
    eventTitleInput.focus({ preventScroll: true });
    composer?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
    return;
  }

  const participantsButton = event.target.closest("[data-view-participants]");
  if (participantsButton) {
    openParticipantsModal(safeText(participantsButton.dataset.viewParticipants));
    return;
  }

  const deleteButton = event.target.closest("[data-delete-event]");
  if (!deleteButton) return;

  const eventId = deleteButton.getAttribute("data-delete-event");
  if (!eventId) return;

  const title = deleteButton.closest(".list-item")?.querySelector(".item-title")?.textContent?.trim() || "this event";
  const confirmed = window.confirm(`Archive "${title}" from live views? Its history and registrations will be preserved.`);
  if (!confirmed) return;

  deleteButton.disabled = true;
  deleteButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Deleting...';

  try {
    if (!await trackedOfficerAction({ module: "programs", action: "delete", recordId: eventId })) {
    const registrations = await getDocs(collection(db, "programs", eventId, "registrations"));
    await Promise.all(registrations.docs.map((registrationDoc) => deleteDoc(registrationDoc.ref)));
    await deleteDoc(doc(db, "programs", eventId));
    }
  } catch (error) {
    console.error("Unable to delete program:", error);
    alert("Failed to delete the program. Please try again.");
    deleteButton.disabled = false;
    deleteButton.innerHTML = '<i class="fa-solid fa-trash-can" aria-hidden="true"></i> Delete';
  }
});

participantsBackdrop?.addEventListener("click", closeParticipantsModal);
participantsClose?.addEventListener("click", closeParticipantsModal);
document.addEventListener("keydown", (event) => {
  if (event.key === "Tab" && participantsModal && !participantsModal.hidden) {
    const controls = [...participantsModal.querySelectorAll('.event-participants-dialog button, .event-participants-dialog a[href], .event-participants-dialog [tabindex="0"]')].filter(el => !el.disabled);
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  if (event.key === "Escape" && participantsModal && !participantsModal.hidden) closeParticipantsModal();
});

clearEventBtn?.addEventListener("click", resetEventForm);

document.getElementById("programFormCard")?.addEventListener("toggle", (event) => {
  scrollToEventFormBtn?.setAttribute("aria-expanded", String(event.target.open));
});

scrollToEventFormBtn?.addEventListener("click", () => {
  if (savingRecord) return;
  if (editingEventId) resetEventForm();
  document.getElementById("programFormCard").open = true;
  eventTitleInput.focus({ preventScroll: true });
  document.getElementById("programFormCard")?.scrollIntoView({
    behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    block: "start"
  });
});

window.addEventListener("beforeunload", releaseEventImageObjectUrl);

programSearch?.addEventListener("input", () => renderEvents(lastEvents));
programStatusFilter?.addEventListener("change", () => renderEvents(lastEvents));
resetEventForm();
subscribeToEvents();
setInterval(() => {
  if (eventsFeedReady) { updateStats(lastEvents); renderEvents(lastEvents); }
}, 30000);

