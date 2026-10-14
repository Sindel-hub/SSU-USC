import { db, auth } from "../../../firebase/firebase-config.js";
import { secureUpload, hydrateMediaImages } from "../../../shared/security-client.js?v=program-media-1";
import {
  addDoc,
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

const eventsCollection = collection(db, "programs");

const eventForm = document.getElementById("eventForm");
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
  const eventDate = parseEventDate(eventItem.eventDate);
  if (!eventDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return eventDate >= today;
}

function getEventStatus(eventItem) {
  return isUpcomingEvent(eventItem) ? "Upcoming" : "Completed";
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

  if (eventRegistrationDeadlineField) eventRegistrationDeadlineField.hidden = !needsDeadline;
  if (eventRegistrationDeadlineInput) {
    eventRegistrationDeadlineInput.required = needsDeadline;
    if (!needsDeadline) eventRegistrationDeadlineInput.value = "";
  }

  if (eventExternalRegistrationField) eventExternalRegistrationField.hidden = !needsExternalLink;
  if (eventExternalRegistrationUrlInput) {
    eventExternalRegistrationUrlInput.required = needsExternalLink;
    if (!needsExternalLink) eventExternalRegistrationUrlInput.value = "";
  }
}

function resetEventForm() {
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
}

function setLoadingState(isLoading) {
  if (!publishEventBtn) return;
  publishEventBtn.disabled = isLoading;
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
      <span>No external programs have been published yet.</span>
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
}

function renderEvents(events) {
  if (!recentEventsList) return;
  if (!events.length) {
    renderEmptyState();
    return;
  }

  recentEventsList.innerHTML = events
    .map((eventItem) => {
      const status = getEventStatus(eventItem);
      const badgeClass = status === "Upcoming" ? "live" : "review";
      const reminderText = eventItem.reminderEnabled ? "Reminders enabled" : "Reminders disabled";
      const mode = safeText(eventItem.registrationMode, "none").toLowerCase();
      const websiteRegistrations = registrationCounts.get(eventItem.id) || 0;
      const imageUrl = safeText(eventItem.imageUrl || eventItem.posterUrl);
      const imageMarkup = imageUrl
        ? `<img class="event-published-thumb" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(safeText(eventItem.title, "Program background"))}">`
        : `<div class="event-published-thumb-placeholder"><i class="fa-regular fa-image" aria-hidden="true"></i><span>No background image</span></div>`;
      const participantButton = mode === "internal"
        ? `<button class="mini-btn light" type="button" data-view-participants="${escapeHtml(eventItem.id)}"><i class="fa-solid fa-user-group" aria-hidden="true"></i> Participants (${websiteRegistrations})</button>`
        : "";

      return `
        <article class="list-item event-published-card">
          ${imageMarkup}
          <div class="item-top">
            <div class="event-published-heading">
              <span class="published-type-icon"><i class="fa-solid fa-earth-americas" aria-hidden="true"></i></span>
              <div>
                <div class="item-title">${escapeHtml(safeText(eventItem.title, "Untitled Program"))}</div>
                <span class="event-category-chip"><i class="fa-solid fa-tag"></i>${escapeHtml(safeText(eventItem.category, "External Program"))}</span>
              </div>
            </div>
            <div class="event-item-controls">
              <div class="badge ${badgeClass}"><i class="fa-solid fa-circle" aria-hidden="true"></i>${status}</div>
              ${participantButton}
              <button class="mini-btn danger" type="button" data-delete-event="${escapeHtml(eventItem.id)}" data-rbac-permission="programs.manage"><i class="fa-solid fa-trash-can" aria-hidden="true"></i> Delete</button>
            </div>
          </div>
          <div class="event-core-meta">
            <span class="event-core-meta-item"><i class="fa-regular fa-calendar"></i><span><small>Date</small><strong>${escapeHtml(formatEventDate(eventItem.eventDate))}</strong></span></span>
            <span class="event-core-meta-item"><i class="fa-regular fa-clock"></i><span><small>Time</small><strong>${escapeHtml(safeText(eventItem.startTime, "TBA"))}${eventItem.endTime ? ` - ${escapeHtml(eventItem.endTime)}` : ""}</strong></span></span>
            <span class="event-core-meta-item"><i class="fa-solid fa-location-dot"></i><span><small>Venue</small><strong>${escapeHtml(safeText(eventItem.venue, "TBA"))}</strong></span></span>
                <span class="event-core-meta-item"><i class="fa-solid fa-handshake"></i><span><small>Host</small><strong>${escapeHtml(safeText(eventItem.hostOrganization, "External partner"))}</strong></span></span>
          </div>
          <div class="item-text">${escapeHtml(safeText(eventItem.description, "No program description provided."))}</div>
          <div class="event-meta-line">
            <span><i class="fa-solid fa-users"></i> ${escapeHtml(safeText(eventItem.audience, "All Students"))}</span>
            <span><i class="fa-regular fa-bell"></i> ${reminderText}</span>
            <span><i class="fa-solid fa-ticket"></i> ${escapeHtml(registrationModeLabel(mode))}</span>
            <span><i class="fa-solid fa-hourglass-end"></i> ${escapeHtml(formatRegistrationDeadline(eventItem))}</span>
            ${mode === "internal" ? `<span><i class="fa-solid fa-user-check"></i> ${websiteRegistrations} registered</span>` : ""}
          </div>
          ${eventItem.participationNotes ? `<div class="event-participation-note"><i class="fa-solid fa-circle-info" aria-hidden="true"></i><div><strong>Participation instructions</strong><span>${escapeHtml(eventItem.participationNotes)}</span></div></div>` : ""}
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
      lastEvents = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      bindRegistrationCountListeners(lastEvents);
      updateStats(lastEvents);
      renderEvents(lastEvents);
    },
    (error) => {
      console.error("Unable to read programs:", error);
      lastEvents = [];
      updateStats([]);
      renderEmptyState();
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
    }
  });

  liveInternalIds.forEach((eventId) => {
    if (registrationCountUnsubs.has(eventId)) return;
    const unsubscribe = onSnapshot(
      collection(db, "programs", eventId, "registrations"),
      (snapshot) => {
        registrationCounts.set(eventId, snapshot.size);
        updateStats(lastEvents);
        renderEvents(lastEvents);
      },
      (error) => {
        console.warn(`Registration count unavailable for ${eventId}:`, error);
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
  document.body.classList.remove("event-participants-modal-open");
}

async function openParticipantsModal(eventId) {
  if (!participantsModal || !participantsBody) return;
  const eventItem = lastEvents.find((item) => item.id === eventId);
  participantsTitle.textContent = eventItem ? safeText(eventItem.title, "Program participants") : "Program participants";
  participantsBody.innerHTML = `<div class="empty-state">Loading registrations...</div>`;
  participantsModal.hidden = false;
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

  const title = safeText(eventTitleInput?.value);
  const eventDate = safeText(eventDateInput?.value);
  const venue = safeText(eventVenueInput?.value);
  const startTime = safeText(eventStartTimeInput?.value);
  const endTime = safeText(eventEndTimeInput?.value);
  const category = safeText(eventCategoryInput?.value, "Community Outreach");
  const description = safeText(eventDescriptionInput?.value);
  const audience = safeText(eventAudienceInput?.value, "All Students");
  const reminderEnabled = safeText(eventReminderEnabledInput?.value, "true") === "true";
  const registrationMode = safeText(eventRegistrationModeInput?.value, "internal").toLowerCase();
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
    const deadlineDate = new Date(deadlineRaw);
    if (Number.isNaN(deadlineDate.getTime())) {
      alert("The registration deadline is invalid.");
      return;
    }
    if (deadlineDate.getTime() <= Date.now()) {
      alert("Registration deadline must be in the future.");
      return;
    }

    const eventEndBoundary = new Date(`${eventDate}T23:59:59`);
    if (!Number.isNaN(eventEndBoundary.getTime()) && deadlineDate.getTime() > eventEndBoundary.getTime()) {
      alert("Registration deadline cannot be after the program date.");
      return;
    }
    registrationDeadline = Timestamp.fromDate(deadlineDate);
  }

  if (registrationMode === "external" && !isValidExternalUrl(externalRegistrationUrl)) {
    alert("Please enter a valid http:// or https:// external registration URL.");
    return;
  }

  setLoadingState(true);

  try {
    const { imageUrl, imagePath } = await uploadEventImage(selectedEventImageFile);

    await addDoc(eventsCollection, {
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
    });

    alert(imageUrl
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
  const confirmed = window.confirm(
    `Delete "${title}"?\n\nThis will remove it from the officer dashboard, student Events / Programs module, and its portal registrations.`
  );
  if (!confirmed) return;

  deleteButton.disabled = true;
  deleteButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Deleting...';

  try {
    const registrations = await getDocs(collection(db, "programs", eventId, "registrations"));
    await Promise.all(registrations.docs.map((registrationDoc) => deleteDoc(registrationDoc.ref)));
    await deleteDoc(doc(db, "programs", eventId));
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
  if (event.key === "Escape" && participantsModal && !participantsModal.hidden) closeParticipantsModal();
});

clearEventBtn?.addEventListener("click", resetEventForm);

scrollToEventFormBtn?.addEventListener("click", () => {
  document.getElementById("programFormCard")?.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
});

window.addEventListener("beforeunload", releaseEventImageObjectUrl);

resetEventForm();
subscribeToEvents();

