import { auth, db } from "../../firebase/firebase-config.js";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import { signOut } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import { resolveMediaUrl } from "../../shared/security-client.js";

const uscAuthAllowed = await (globalThis.USC_AUTH_READY || Promise.resolve(false));
if (uscAuthAllowed !== true) await new Promise(() => {});

const PROFILE_KEY = "studentProfile";
const SESSION_KEY = "activeSession";

let events = [];
const sourceFeeds = { events: [], programs: [] };
let activeIndex = 0;
let heroTouchStartX = 0;
let calendarMonth = null;
let selectedDateKey = "";
let currentDetailEventId = "";
let detailBusy = false;

const background = document.getElementById("eventsHighlightBackground");
const upcomingBackground = document.getElementById("eventsUpcomingBackground");
const titleEl = document.getElementById("eventsHighlightTitle");
const sourceEl = document.getElementById("eventsHighlightSource");
const venueEl = document.getElementById("eventsHighlightVenue");
const dateEl = document.getElementById("eventsHighlightDate");
const dotsEl = document.getElementById("eventsHighlightDots");
const moduleEl = document.getElementById("eventsHighlightModule");
const prevButton = document.getElementById("eventsHighlightPrev");
const nextButton = document.getElementById("eventsHighlightNext");
const highlightAction = document.getElementById("eventsHighlightAction");
const upcomingList = document.getElementById("eventsUpcomingList");
const calendarTitle = document.getElementById("eventsCalendarTitle");
const calendarGrid = document.getElementById("eventsCalendarGrid");
const calendarPrev = document.getElementById("eventsCalendarPrev");
const calendarNext = document.getElementById("eventsCalendarNext");

const detailModal = document.getElementById("eventsDetailModal");
const detailBackdrop = document.getElementById("eventsDetailBackdrop");
const detailClose = document.getElementById("eventsDetailClose");
const detailTitle = document.getElementById("eventsDetailTitle");
const detailEyebrow = document.getElementById("eventsDetailEyebrow");
const detailStatus = document.getElementById("eventsDetailStatus");
const detailDescription = document.getElementById("eventsDetailDescription");
const detailSchedule = document.getElementById("eventsDetailSchedule");
const detailVenue = document.getElementById("eventsDetailVenue");
const detailDeadline = document.getElementById("eventsDetailDeadline");
const detailMode = document.getElementById("eventsDetailMode");
const detailOrganizer = document.getElementById("eventsDetailOrganizer");
const detailNote = document.getElementById("eventsDetailNote");
const registrationState = document.getElementById("eventsRegistrationState");
const detailActions = document.getElementById("eventsDetailActions");

function clean(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function escapeHtml(value) {
  return clean(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeUrl(value) {
  return clean(value).replace(/["'()\\]/g, "");
}

function itemSource(eventItem) {
  return clean(eventItem?.sourceType, "event").toLowerCase() === "program" ? "program" : "event";
}

function itemCollection(eventItem) {
  return itemSource(eventItem) === "program" ? "programs" : "events";
}

function itemTypeLabel(eventItem) {
  return itemSource(eventItem) === "program" ? "External Program" : "University Event";
}

function itemOrganizer(eventItem) {
  return itemSource(eventItem) === "program"
    ? clean(eventItem?.hostOrganization, "External partner organization")
    : "Samar State University / USC";
}

function itemFallbackTitle(eventItem) {
  return itemSource(eventItem) === "program" ? "External Program" : "USC Event";
}

function getProfile() {
  try {
    return JSON.parse(sessionStorage.getItem(PROFILE_KEY) || "null");
  } catch {
    return null;
  }
}

function guardStudent() {
  const student = getProfile();
  if (sessionStorage.getItem(SESSION_KEY) !== "true" || !student) {
    location.replace("../index/index.html");
    return null;
  }

  const name = clean(student.fullName, "Student");
  const nameEl = document.getElementById("dashboardUserName");
  const initialsEl = document.getElementById("dashboardUserInitials");
  if (nameEl) nameEl.textContent = name;
  if (initialsEl) {
    initialsEl.textContent = name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  }
  return student;
}

function parseEventDate(rawValue) {
  const value = clean(rawValue);
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function timestampDate(rawValue) {
  if (!rawValue) return null;
  const date = typeof rawValue?.toDate === "function" ? rawValue.toDate() : new Date(rawValue);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(rawValue) {
  const date = parseEventDate(rawValue);
  if (!date) return "DATE TO BE ANNOUNCED";
  return date.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" }).toUpperCase();
}

function formatCompactTime(eventItem) {
  const start = clean(eventItem.startTime || eventItem.time || "");
  const end = clean(eventItem.endTime || "");
  if (start && end) return `${start} - ${end}`;
  return start || "Time TBA";
}

function formatSchedule(eventItem) {
  const date = parseEventDate(eventItem.eventDate);
  const dateText = date
    ? date.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" })
    : "Date to be announced";
  return `${dateText} · ${formatCompactTime(eventItem)}`;
}

function formatDeadline(eventItem) {
  const deadline = timestampDate(eventItem.registrationDeadline);
  if (!deadline) return "No registration deadline";
  return deadline.toLocaleString([], {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function registrationMode(eventItem) {
  const mode = clean(eventItem.registrationMode, "none").toLowerCase();
  return ["internal", "external", "none"].includes(mode) ? mode : "none";
}

function registrationModeLabel(eventItem) {
  const mode = registrationMode(eventItem);
  if (mode === "internal") return "Register in USC Portal";
  if (mode === "external") return "External registration form";
  return "No registration required";
}

function isRegistrationOpen(eventItem) {
  const mode = registrationMode(eventItem);
  if (mode === "none") return false;
  const deadline = timestampDate(eventItem.registrationDeadline);
  if (!deadline) return false;
  const eventDate = parseEventDate(eventItem.eventDate);
  const eventEnded = eventDate ? eventDate.getTime() + 86400000 <= Date.now() : false;
  return !eventEnded && Date.now() < deadline.getTime();
}

function deadlineBadge(eventItem) {
  const mode = registrationMode(eventItem);
  if (mode === "none") return "Open participation";
  const deadline = timestampDate(eventItem.registrationDeadline);
  if (!deadline) return "Registration details pending";
  if (!isRegistrationOpen(eventItem)) return "Registration closed";
  const remaining = deadline.getTime() - Date.now();
  const hours = Math.ceil(remaining / 3600000);
  if (hours <= 24) return `Closes in ${Math.max(1, hours)}h`;
  const days = Math.ceil(hours / 24);
  return `Closes in ${days} day${days === 1 ? "" : "s"}`;
}

function safeExternalRegistrationUrl(rawValue) {
  const value = clean(rawValue);
  if (!value) return "";
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function eventSortValue(eventItem) {
  const date = parseEventDate(eventItem.eventDate);
  return date ? date.getTime() : Number.MAX_SAFE_INTEGER;
}

function setEmptyState() {
  titleEl.textContent = "No Upcoming Events / Programs";
  venueEl.textContent = "New university activities and external opportunities will appear here";
  dateEl.textContent = "—";
  if (sourceEl) sourceEl.textContent = "SSU Student Opportunities";
  background.style.backgroundImage = 'url("assets/HomeLogo.webp")';
  if (upcomingBackground) upcomingBackground.style.backgroundImage = 'url("assets/HomeLogo.webp")';
  dotsEl.innerHTML = "";
  prevButton.disabled = true;
  nextButton.disabled = true;
  if (highlightAction) highlightAction.disabled = true;
  calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  selectedDateKey = "";
  renderUpcomingSection();
}

function renderDots() {
  if (!dotsEl) return;
  dotsEl.innerHTML = events.map((_, index) => (
    `<button type="button" class="events-highlight-dot${index === activeIndex ? " active" : ""}" data-event-index="${index}" aria-label="Show event or program ${index + 1}"></button>`
  )).join("");
}

function syncCalendarToActiveEvent(force = false) {
  const active = events[activeIndex];
  const activeDate = parseEventDate(active?.eventDate);
  if (!activeDate) return;
  const activeKey = normalizeDateKey(activeDate);
  selectedDateKey = activeKey;
  if (!calendarMonth || force || calendarMonth.getMonth() !== activeDate.getMonth() || calendarMonth.getFullYear() !== activeDate.getFullYear()) {
    calendarMonth = new Date(activeDate.getFullYear(), activeDate.getMonth(), 1);
  }
}

function renderActiveEvent() {
  if (!events.length) {
    setEmptyState();
    return;
  }

  if (activeIndex < 0) activeIndex = events.length - 1;
  if (activeIndex >= events.length) activeIndex = 0;

  const eventItem = events[activeIndex];
  const title = clean(eventItem.title, itemFallbackTitle(eventItem));
  const venue = clean(eventItem.venue, itemSource(eventItem) === "program" ? "Off-campus / See details" : "Samar State University");
  const date = formatDate(eventItem.eventDate);
  const mediaRef = eventItem.imageUrl || eventItem.posterUrl || "assets/HomeLogo.webp";
  const imageUrl = escapeUrl(mediaRef);

  if (moduleEl) moduleEl.dataset.sourceType = itemSource(eventItem);
  titleEl.textContent = title;
  if (sourceEl) sourceEl.textContent = itemSource(eventItem) === "program" ? itemOrganizer(eventItem) : "Samar State University";
  venueEl.textContent = venue;
  dateEl.textContent = date;
  background.style.backgroundImage = `url("${imageUrl}")`;
  if (upcomingBackground) upcomingBackground.style.backgroundImage = `url("${imageUrl}")`;
  resolveMediaUrl(mediaRef).then((url) => {
    background.style.backgroundImage = `url("${url}")`;
    if (upcomingBackground) upcomingBackground.style.backgroundImage = `url("${url}")`;
  }).catch(() => {});

  // Keep the real carousel controls available whenever at least one event exists.
  // With one event, clicking simply re-renders the same event; with 2+ events,
  // the controls cycle through the event list in both directions.
  const disabled = events.length === 0;
  prevButton.disabled = disabled;
  nextButton.disabled = disabled;
  if (highlightAction) {
    highlightAction.disabled = false;
    highlightAction.innerHTML = `<i class="fa-solid fa-ticket"></i><span>${registrationMode(eventItem) === "none" ? `View ${itemSource(eventItem) === "program" ? "program" : "event"} details` : "View details & participate"}</span>`;
  }
  syncCalendarToActiveEvent();
  renderDots();
  renderUpcomingSection();
}

function move(direction) {
  if (!events.length) return;
  activeIndex = (activeIndex + direction + events.length) % events.length;
  renderActiveEvent();
}

function eventsForVisibleMonth() {
  if (!calendarMonth) return [];
  const month = calendarMonth.getMonth();
  const year = calendarMonth.getFullYear();
  return events.filter((eventItem) => {
    const date = parseEventDate(eventItem.eventDate);
    return date && date.getMonth() === month && date.getFullYear() === year;
  });
}

function renderUpcomingList() {
  if (!upcomingList) return;
  const monthEvents = eventsForVisibleMonth();
  let candidates = monthEvents.length ? monthEvents : events;
  candidates = [...candidates]
    .sort((a, b) => eventSortValue(a) - eventSortValue(b))
    .slice(0, 3);

  if (!candidates.length) {
    upcomingList.innerHTML = `
      <div class="events-upcoming-empty">
        <i class="fa-regular fa-calendar"></i>
        <strong>No upcoming events or programs yet</strong>
        <span>University events and outside-university programs will appear here automatically.</span>
      </div>`;
    return;
  }

  upcomingList.innerHTML = candidates.map((eventItem) => {
    const date = parseEventDate(eventItem.eventDate);
    const dateText = date ? date.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" }) : "Date TBA";
    const selected = clean(eventItem.eventDate) === selectedDateKey;
    const category = clean(eventItem.category, itemFallbackTitle(eventItem));
    const sourceLabel = itemTypeLabel(eventItem);
    return `
      <article class="events-upcoming-card${selected ? " selected" : ""}${itemSource(eventItem) === "program" ? " external-program" : " university-event"}">
        <button class="events-upcoming-card-select" type="button" data-event-id="${escapeHtml(eventItem.id)}">
          <span class="events-upcoming-card-accent" aria-hidden="true"></span>
          <span class="events-upcoming-card-copy">
            <small>${escapeHtml(sourceLabel)} · ${escapeHtml(category)}</small>
            <strong>${escapeHtml(clean(eventItem.title, itemFallbackTitle(eventItem)))}</strong>
            <span>${escapeHtml(dateText)} | ${escapeHtml(formatCompactTime(eventItem))}</span>
            <span>Venue: ${escapeHtml(clean(eventItem.venue, "To be announced"))}</span>
          </span>
        </button>
        <div class="events-upcoming-card-foot">
          <span class="events-registration-chip">${escapeHtml(deadlineBadge(eventItem))}</span>
          <button type="button" class="events-participate-link" data-participate-event="${escapeHtml(eventItem.id)}">
            ${registrationMode(eventItem) === "none" ? "View details" : "Participate"}
            <i class="fa-solid fa-arrow-right"></i>
          </button>
        </div>
      </article>`;
  }).join("");
}

function renderCalendar() {
  if (!calendarMonth || !calendarTitle || !calendarGrid) return;
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  calendarTitle.textContent = calendarMonth.toLocaleDateString([], { month: "long", year: "numeric" });
  const eventDates = new Set(events.map((item) => clean(item.eventDate)).filter(Boolean));
  const cells = ["S", "M", "T", "W", "T", "F", "S"].map((label) => `<div class="events-calendar-day-name">${label}</div>`);

  const previousMonthLast = new Date(year, month, 0).getDate();
  for (let offset = firstDay.getDay(); offset > 0; offset -= 1) {
    cells.push(`<div class="events-calendar-day muted">${previousMonthLast - offset + 1}</div>`);
  }

  for (let day = 1; day <= lastDay.getDate(); day += 1) {
    const date = new Date(year, month, day);
    const key = normalizeDateKey(date);
    const classes = ["events-calendar-day"];
    if (eventDates.has(key)) classes.push("has-event");
    if (key === selectedDateKey) classes.push("selected");
    if (date.getTime() === today.getTime()) classes.push("today");
    cells.push(`<button class="${classes.join(" ")}" type="button" data-calendar-date="${key}">${day}</button>`);
  }

  const used = firstDay.getDay() + lastDay.getDate();
  const trailing = (7 - (used % 7)) % 7;
  for (let day = 1; day <= trailing; day += 1) {
    cells.push(`<div class="events-calendar-day muted">${day}</div>`);
  }

  calendarGrid.innerHTML = cells.join("");
}

function renderUpcomingSection() {
  if (!calendarMonth) {
    const firstDate = parseEventDate(events[0]?.eventDate) || new Date();
    calendarMonth = new Date(firstDate.getFullYear(), firstDate.getMonth(), 1);
  }
  renderUpcomingList();
  renderCalendar();
}

function selectEventById(id) {
  const index = events.findIndex((item) => item.id === id);
  if (index < 0) return;
  activeIndex = index;
  renderActiveEvent();
}

function eventById(id) {
  return events.find((item) => item.id === id) || null;
}

function closeEventDetails() {
  if (!detailModal) return;
  detailModal.hidden = true;
  document.body.classList.remove("events-modal-open");
  currentDetailEventId = "";
}

function setDetailBusy(isBusy) {
  detailBusy = isBusy;
  detailActions?.querySelectorAll("button,a").forEach((control) => {
    if ("disabled" in control) control.disabled = isBusy;
    control.classList.toggle("is-busy", isBusy);
  });
}

async function ownRegistration(eventId) {
  const uid = clean(auth.currentUser?.uid);
  const eventItem = eventById(eventId);
  if (!uid || !eventId || !eventItem) return null;
  const snap = await getDoc(doc(db, itemCollection(eventItem), eventId, "registrations", uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

function renderDetail(eventItem, registration = null) {
  if (!eventItem || !detailModal) return;
  const mode = registrationMode(eventItem);
  const open = isRegistrationOpen(eventItem);
  const externalUrl = safeExternalRegistrationUrl(eventItem.externalRegistrationUrl);
  const notes = clean(eventItem.participationNotes);

  detailTitle.textContent = clean(eventItem.title, itemFallbackTitle(eventItem));
  if (detailEyebrow) detailEyebrow.textContent = itemSource(eventItem) === "program" ? "EXTERNAL PROGRAM PARTICIPATION" : "UNIVERSITY EVENT PARTICIPATION";
  detailDescription.textContent = clean(eventItem.description, itemSource(eventItem) === "program" ? "No additional program description was provided." : "No additional event description was provided.");
  detailSchedule.textContent = formatSchedule(eventItem);
  detailVenue.textContent = clean(eventItem.venue, "To be announced");
  detailDeadline.textContent = mode === "none" ? "Not required" : formatDeadline(eventItem);
  detailMode.textContent = registrationModeLabel(eventItem);
  if (detailOrganizer) detailOrganizer.textContent = itemOrganizer(eventItem);
  detailStatus.textContent = mode === "none"
    ? (itemSource(eventItem) === "program" ? "Open program" : "Open event")
    : (open ? "Registration open" : "Registration closed");
  detailStatus.className = `events-detail-status ${open ? "open" : mode === "none" ? "neutral" : "closed"}`;

  if (notes) {
    detailNote.hidden = false;
    detailNote.innerHTML = `<i class="fa-solid fa-circle-info"></i><div><strong>Participation instructions</strong><p>${escapeHtml(notes)}</p></div>`;
  } else {
    detailNote.hidden = true;
    detailNote.innerHTML = "";
  }

  detailActions.innerHTML = "";
  registrationState.innerHTML = "";

  if (mode === "internal") {
    if (registration) {
      registrationState.innerHTML = `
        <div class="events-registration-confirmed">
          <i class="fa-solid fa-circle-check"></i>
          <div><strong>You are registered</strong><span>Your portal registration is recorded for this event or program.</span></div>
        </div>`;
      if (open) {
        detailActions.innerHTML = `
          <button class="events-detail-secondary" type="button" data-cancel-registration="${escapeHtml(eventItem.id)}">
            Cancel registration
          </button>`;
      } else {
        detailActions.innerHTML = `<button class="events-detail-primary" type="button" disabled>Registration deadline passed</button>`;
      }
    } else if (open) {
      registrationState.innerHTML = `
        <div class="events-registration-prompt">
          <i class="fa-solid fa-id-card"></i>
          <div><strong>Register using your student account</strong><span>Your Student ID and profile details will be used automatically. No separate form is needed.</span></div>
        </div>`;
      detailActions.innerHTML = `
        <button class="events-detail-primary" type="button" data-register-event="${escapeHtml(eventItem.id)}">
          <i class="fa-solid fa-ticket"></i> Register for this event / program
        </button>`;
    } else {
      registrationState.innerHTML = `<p class="events-registration-closed-copy">The registration deadline has passed. You can still view the details, but new registrations are closed.</p>`;
      detailActions.innerHTML = `<button class="events-detail-primary" type="button" disabled>Registration closed</button>`;
    }
  } else if (mode === "external") {
    registrationState.innerHTML = open
      ? `<div class="events-registration-prompt"><i class="fa-solid fa-arrow-up-right-from-square"></i><div><strong>Registration is handled externally</strong><span>You will leave the USC Portal to complete the organizer's registration form.</span></div></div>`
      : `<p class="events-registration-closed-copy">The external registration deadline has passed.</p>`;
    if (open && externalUrl) {
      detailActions.innerHTML = `
        <a class="events-detail-primary" href="${escapeHtml(externalUrl)}" target="_blank" rel="noopener noreferrer">
          Open registration form <i class="fa-solid fa-arrow-up-right-from-square"></i>
        </a>`;
    } else {
      detailActions.innerHTML = `<button class="events-detail-primary" type="button" disabled>${open ? "Registration link unavailable" : "Registration closed"}</button>`;
    }
  } else {
    registrationState.innerHTML = `
      <div class="events-registration-prompt">
        <i class="fa-solid fa-people-group"></i>
        <div><strong>No registration is required</strong><span>You can participate directly according to the organizer's instructions.</span></div>
      </div>`;
    detailActions.innerHTML = `<button class="events-detail-primary" type="button" disabled>No registration needed</button>`;
  }
}

async function openEventDetails(id) {
  const eventItem = eventById(id);
  if (!eventItem || !detailModal) return;
  currentDetailEventId = id;
  selectEventById(id);
  detailModal.hidden = false;
  document.body.classList.add("events-modal-open");
  registrationState.innerHTML = `<div class="events-registration-loading"><i class="fa-solid fa-spinner fa-spin"></i> Checking your participation status...</div>`;
  detailActions.innerHTML = "";
  renderDetail(eventItem, null);

  if (registrationMode(eventItem) === "internal") {
    registrationState.innerHTML = `<div class="events-registration-loading"><i class="fa-solid fa-spinner fa-spin"></i> Checking your participation status...</div>`;
    detailActions.innerHTML = "";
    try {
      const registration = await ownRegistration(id);
      if (currentDetailEventId === id) renderDetail(eventItem, registration);
    } catch (error) {
      console.error("Unable to read event registration:", error);
      if (currentDetailEventId === id) {
        renderDetail(eventItem, null);
        registrationState.innerHTML = `<p class="events-registration-error">Your registration status could not be loaded. Please refresh and try again.</p>`;
      }
    }
  }
}

const studentProfile = guardStudent();

function rebuildMergedFeed() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const allItems = [...sourceFeeds.events, ...sourceFeeds.programs]
    .filter((eventItem) => clean(eventItem.status, "Published") === "Published")
    .sort((a, b) => eventSortValue(a) - eventSortValue(b));

  const upcoming = allItems.filter((eventItem) => {
    const date = parseEventDate(eventItem.eventDate);
    return !date || date >= now;
  });

  const currentId = events[activeIndex]?.id || "";
  events = upcoming.length ? upcoming : allItems.slice(-8);
  const preservedIndex = currentId ? events.findIndex((item) => item.id === currentId) : -1;
  activeIndex = preservedIndex >= 0 ? preservedIndex : Math.min(activeIndex, Math.max(0, events.length - 1));
  if (events.length) syncCalendarToActiveEvent(true);
  renderActiveEvent();

  if (currentDetailEventId) {
    const refreshed = eventById(currentDetailEventId);
    if (!refreshed) closeEventDetails();
    else ownRegistration(currentDetailEventId)
      .then((registration) => renderDetail(refreshed, registration))
      .catch(() => renderDetail(refreshed, null));
  }
}

function bindSourceFeed(collectionName, sourceType) {
  onSnapshot(
    query(collection(db, collectionName), orderBy("eventDate", "asc"), limit(30)),
    (snapshot) => {
      sourceFeeds[collectionName] = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
        sourceType
      }));
      rebuildMergedFeed();
    },
    (error) => {
      console.error(`Unable to load student ${collectionName}:`, error);
      sourceFeeds[collectionName] = [];
      rebuildMergedFeed();
    }
  );
}

bindSourceFeed("events", "event");
bindSourceFeed("programs", "program");

prevButton?.addEventListener("click", () => move(-1));
nextButton?.addEventListener("click", () => move(1));
highlightAction?.addEventListener("click", () => {
  const active = events[activeIndex];
  if (active) openEventDetails(active.id);
});

dotsEl?.addEventListener("click", (event) => {
  const button = event.target.closest?.("[data-event-index]");
  if (!button) return;
  activeIndex = Number(button.dataset.eventIndex) || 0;
  renderActiveEvent();
});

moduleEl?.addEventListener("touchstart", (event) => {
  heroTouchStartX = event.changedTouches[0]?.clientX || 0;
}, { passive: true });

moduleEl?.addEventListener("touchend", (event) => {
  const endX = event.changedTouches[0]?.clientX || heroTouchStartX;
  const distance = endX - heroTouchStartX;
  if (Math.abs(distance) < 50) return;
  move(distance < 0 ? 1 : -1);
}, { passive: true });

upcomingList?.addEventListener("click", (event) => {
  const participate = event.target.closest?.("[data-participate-event]");
  if (participate) {
    openEventDetails(clean(participate.dataset.participateEvent));
    return;
  }
  const card = event.target.closest?.("[data-event-id]");
  if (!card) return;
  selectEventById(card.dataset.eventId);
});

calendarGrid?.addEventListener("click", (event) => {
  const dayButton = event.target.closest?.("[data-calendar-date]");
  if (!dayButton) return;
  selectedDateKey = clean(dayButton.dataset.calendarDate);
  const matching = events.find((item) => clean(item.eventDate) === selectedDateKey);
  if (matching) activeIndex = events.findIndex((item) => item.id === matching.id);
  renderUpcomingSection();
});

calendarPrev?.addEventListener("click", () => {
  if (!calendarMonth) return;
  calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1);
  selectedDateKey = "";
  renderUpcomingSection();
});

calendarNext?.addEventListener("click", () => {
  if (!calendarMonth) return;
  calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1);
  selectedDateKey = "";
  renderUpcomingSection();
});

detailBackdrop?.addEventListener("click", closeEventDetails);
detailClose?.addEventListener("click", closeEventDetails);

detailActions?.addEventListener("click", async (event) => {
  const registerButton = event.target.closest?.("[data-register-event]");
  const cancelButton = event.target.closest?.("[data-cancel-registration]");
  if ((!registerButton && !cancelButton) || detailBusy) return;

  const eventId = clean(registerButton?.dataset.registerEvent || cancelButton?.dataset.cancelRegistration);
  const eventItem = eventById(eventId);
  const uid = clean(auth.currentUser?.uid || studentProfile?.uid);
  if (!eventId || !eventItem || !uid) return;

  if (!isRegistrationOpen(eventItem)) {
    renderDetail(eventItem, await ownRegistration(eventId).catch(() => null));
    return;
  }

  setDetailBusy(true);
  try {
    const registrationRef = doc(db, itemCollection(eventItem), eventId, "registrations", uid);

    if (registerButton) {
      const identityField = itemSource(eventItem) === "program" ? { programId: eventId } : { eventId };
      await setDoc(registrationRef, {
        ...identityField,
        studentUid: uid,
        studentId: clean(studentProfile?.studentId),
        fullName: clean(studentProfile?.fullName, "Student"),
        schoolEmail: clean(studentProfile?.email || studentProfile?.institutionalEmail),
        college: clean(studentProfile?.college),
        program: clean(studentProfile?.program),
        yearLevel: clean(studentProfile?.yearLevel),
        status: "registered",
        registeredAt: serverTimestamp()
      });
    } else {
      const confirmed = window.confirm(`Cancel your registration for this ${itemSource(eventItem) === "program" ? "program" : "event"}?`);
      if (!confirmed) return;
      await deleteDoc(registrationRef);
    }

    const registration = await ownRegistration(eventId);
    renderDetail(eventItem, registration);
  } catch (error) {
    console.error("Unable to update event/program registration:", error);
    const message = clean(error?.message).toLowerCase().includes("permission")
      ? "Registration could not be changed. The deadline may have passed or your student account is not eligible."
      : "Unable to update your registration right now. Please try again.";
    registrationState.innerHTML = `<p class="events-registration-error">${escapeHtml(message)}</p>`;
  } finally {
    setDetailBusy(false);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && detailModal && !detailModal.hidden) {
    closeEventDetails();
    return;
  }
  if (detailModal && !detailModal.hidden) return;
  if (event.key === "ArrowLeft") move(-1);
  if (event.key === "ArrowRight") move(1);
});

document.getElementById("studentLogout")?.addEventListener("click", async () => {
  sessionStorage.clear();
  try { await signOut(auth); } catch {}
  location.replace("../index/index.html");
});
