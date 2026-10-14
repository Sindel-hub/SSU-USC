import { db } from "../../firebase/firebase-config.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";


const BROWSER_MEDIA_SCHEME = "firestore-media://";
const landingMediaUrlCache = new Map();

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function resolveLandingMediaUrl(source = "") {
  const value = String(source || "").trim();
  if (!value.startsWith(BROWSER_MEDIA_SCHEME)) return value;
  if (landingMediaUrlCache.has(value)) return landingMediaUrlCache.get(value);

  const fileId = value.slice(BROWSER_MEDIA_SCHEME.length);
  const metaSnap = await getDoc(doc(db, "browser_files", fileId));
  if (!metaSnap.exists()) throw new Error("Stored landing-page media was not found.");

  const meta = metaSnap.data();
  if (meta.visibility !== "public") throw new Error("This landing-page media is not public.");

  const chunkSnap = await getDocs(collection(db, "browser_files", fileId, "chunks"));
  const rows = chunkSnap.docs
    .map((item) => item.data())
    .sort((left, right) => Number(left.index || 0) - Number(right.index || 0));

  if (Number(meta.chunkCount || 0) !== rows.length) throw new Error("Stored landing-page media is incomplete.");
  const bytes = base64ToBytes(rows.map((row) => String(row.payload || "")).join(""));
  const url = URL.createObjectURL(new Blob([bytes], { type: meta.type || "application/octet-stream" }));
  landingMediaUrlCache.set(value, url);
  return url;
}

async function hydrateMediaImages(root = document) {
  const images = [...(root.querySelectorAll?.('img[src^="firestore-media://"], img[data-media-ref^="firestore-media://"]') || [])];
  await Promise.all(images.map(async (image) => {
    const mediaRef = image.dataset.mediaRef || image.getAttribute("src") || "";
    try {
      image.src = await resolveLandingMediaUrl(mediaRef);
      image.removeAttribute("data-media-ref");
    } catch (error) {
      console.warn("Unable to hydrate landing-page media:", error);
    }
  }));
}

const PREVIEW_LIMIT = 5;
const AUTO_SLIDE_MS = 6000;

const dom = {
  slidesHost: document.getElementById("previewSlidesHost"),
  dotsHost: document.getElementById("previewDots"),
  scrollDownBtn: document.getElementById("scrollDownBtn"),
  welcomeSection: document.getElementById("welcome-section"),
  heroCopy: document.querySelector(".hero-copy"),
  announcementSection: document.getElementById("announcement-section"),
  eventsSection: document.getElementById("events-section"),
  heroEventsFlow: document.querySelector(".hero-events-flow"),
  aboutSection: document.getElementById("about-section"),
  eventsFollowingBackground: document.getElementById("eventsFollowingBackground"),
  topHeader: document.getElementById("topHeader"),
  mobileNavToggle: document.getElementById("mobileNavToggle"),
  landingNav: document.getElementById("landingNav"),
  leftArrow: document.querySelector(".preview-arrow.left"),
  rightArrow: document.querySelector(".preview-arrow.right"),
  calendarTitle: document.getElementById("homeCalendarTitle"),
  calendarGrid: document.getElementById("homeCalendarGrid"),
  eventList: document.getElementById("homeEventList"),
  calendarPrev: document.getElementById("homeCalendarPrev"),
  calendarNext: document.getElementById("homeCalendarNext")
};

const announcementsCollection = collection(db, "announcements");

const homeEventState = {
  events: [],
  currentMonth: null,
  selectedDateKey: ""
};

let previewAnnouncements = [];
let previewCurrentSlide = 0;
let previewTimer = 0;

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeText(value, fallback = "") {
  return String(value || fallback).trim();
}

function truncateText(value, maxLength = 220) {
  const text = safeText(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trim()}…`;
}

function toDate(value) {
  if (!value) return null;
  const date = value?.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseEventDate(rawValue) {
  const cleanValue = safeText(rawValue);
  if (!cleanValue) return null;
  const date = new Date(`${cleanValue}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value) {
  const date = toDate(value) || parseEventDate(value);
  if (!date) return "Latest update";
  return date.toLocaleDateString([], {
    month: "long",
    day: "numeric",
    year: "numeric"
  });
}

function normalizeDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isSameDay(left, right) {
  return normalizeDateKey(left) === normalizeDateKey(right);
}

function getToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function setArrowState() {
  const disabled = previewAnnouncements.length <= 1;
  if (dom.leftArrow) dom.leftArrow.disabled = disabled;
  if (dom.rightArrow) dom.rightArrow.disabled = disabled;
}

function buildSlide(announcement, role = "active") {
  const title = safeText(
    announcement.title,
    "USC Announcement"
  );

  const imageUrl = safeText(
    announcement.imageUrl
  );

  let content = "";

  if (imageUrl) {

    /*
     * Browser-stored media uses firestore-media://
     * which is NOT a browser-native image URL.
     *
     * Keep it in data-media-ref so hydrateMediaImages()
     * can reconstruct the actual image.
     */
    const imageMarkup =
      imageUrl.startsWith("firestore-media://")
        ? `
          <img
            data-media-ref="${escapeHtml(imageUrl)}"
            alt="${escapeHtml(title)}"
          >
        `
        : `
          <img
            src="${escapeHtml(imageUrl)}"
            alt="${escapeHtml(title)}"
          >
        `;

    const announcementDescription = safeText(
      announcement.content || announcement.description || announcement.details,
      "Official USC announcement."
    );

    const announcementDate = formatDate(
      announcement.createdAt || announcement.createdAtMs || announcement.updatedAt || announcement.date
    );

    content =       `
      <div class="announcement-poster announcement-poster-with-copy">
        <div class="announcement-poster-media">
          ${imageMarkup}
        </div>
        <div class="announcement-poster-copy">
          <div class="announcement-copy-meta">
            <span class="announcement-copy-badge">Announcement</span>
            <span class="announcement-copy-date">${escapeHtml(announcementDate)}</span>
          </div>
          <h3>${escapeHtml(truncateText(title, 80))}</h3>
          <p>${escapeHtml(truncateText(announcementDescription, 180))}</p>
        </div>
      </div>
    `;

  } else {

    content = `
      <div class="announcement-fallback">

        <div class="announcement-fallback-seals">

          <img
            src="assets/SSUlogo.webp"
            alt=""
            onerror="this.style.display='none'"
          >

          <img
            src="assets/USClogo.webp"
            alt=""
            onerror="this.style.display='none'"
          >

        </div>

        <div class="fallback-label">
          ANNOUNCEMENT
        </div>

        <h3>
          ${escapeHtml(
            truncateText(title, 72)
          )}
        </h3>

        <p>
          ${escapeHtml(
            truncateText(
              announcement.content,
              150
            )
          )}
        </p>

      </div>
    `;
  }

  return `
    <article
      class="preview-slide ${role}"
      aria-label="${escapeHtml(title)}"
    >
      ${content}
    </article>
  `;
}

function buildFallbackSlide() {
  return `
    <article class="preview-slide active" aria-label="USC announcements">
      <div class="announcement-fallback">
        <div class="announcement-fallback-seals">
          <img src="assets/SSUlogo.webp" alt="" onerror="this.style.display='none'">
          <img src="assets/USClogo.webp" alt="" onerror="this.style.display='none'">
        </div>
        <div class="fallback-label">UNIVERSITY STUDENT COUNCIL</div>
        <h3>Stay connected with USC</h3>
        <p>Published announcements will appear here automatically.</p>
      </div>
    </article>
  `;
}

async function hydrateAnnouncementSlides() {
  if (!dom.slidesHost) {
    return;
  }

  try {
    await hydrateMediaImages(
      dom.slidesHost
    );
  } catch (error) {
    console.warn(
      "Unable to load landing announcement image:",
      error
    );
  }
}

function renderDots() {
  if (!dom.dotsHost) return;
  const dotCount = previewAnnouncements.length > 0 ? previewAnnouncements.length : 1;
  dom.dotsHost.innerHTML = Array.from({ length: dotCount }, (_, index) => `
      <button class="preview-dot ${index === previewCurrentSlide ? "active" : ""}" type="button" data-dot-index="${index}" aria-label="Go to announcement ${index + 1}"></button>
    `).join("");
}

function renderCarousel() {
  if (!dom.slidesHost) {
    return;
  }


  /* No announcements */
  if (!previewAnnouncements.length) {

    dom.slidesHost.innerHTML =
      buildFallbackSlide();

    renderDots();

    setArrowState();

    hydrateAnnouncementSlides();

    return;
  }


  const total =
    previewAnnouncements.length;

  const activeIndex =
    previewCurrentSlide;

  const prevIndex =
    (activeIndex - 1 + total) % total;

  const nextIndex =
    (activeIndex + 1) % total;

  const parts = [];


  if (total > 1) {

    parts.push(
      buildSlide(
        previewAnnouncements[prevIndex],
        "prev"
      )
    );

  }


  parts.push(
    buildSlide(
      previewAnnouncements[activeIndex],
      "active"
    )
  );


  if (total > 1) {

    parts.push(
      buildSlide(
        previewAnnouncements[nextIndex],
        "next"
      )
    );

  }


  dom.slidesHost.innerHTML =
    parts.join("");


  /*
   * IMPORTANT:
   * Convert firestore-media:// references
   * into actual Blob URLs after each render.
   */
  hydrateAnnouncementSlides();


  renderDots();

  setArrowState();
}

function stopAutoSlide() {
  if (previewTimer) {
    window.clearInterval(previewTimer);
    previewTimer = 0;
  }
}

function restartAutoSlide() {
  stopAutoSlide();
  if (previewAnnouncements.length <= 1) return;
  previewTimer = window.setInterval(() => changePreviewSlide(1), AUTO_SLIDE_MS);
}

function changePreviewSlide(direction) {
  const total = previewAnnouncements.length;
  if (total <= 1) {
    previewCurrentSlide = 0;
    renderCarousel();
    return;
  }
  previewCurrentSlide = (previewCurrentSlide + direction + total) % total;
  renderCarousel();
}

function goToPreviewSlide(index) {
  const total = previewAnnouncements.length;
  if (total <= 1) {
    previewCurrentSlide = 0;
    renderCarousel();
    return;
  }
  previewCurrentSlide = ((index % total) + total) % total;
  renderCarousel();
}

function startAnnouncementsListener() {
  const announcementsQuery = query(announcementsCollection, orderBy("createdAtMs", "desc"), limit(PREVIEW_LIMIT));

  onSnapshot(
    announcementsQuery,
    (snapshot) => {
      previewAnnouncements = snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() }));
      if (previewCurrentSlide >= previewAnnouncements.length) previewCurrentSlide = 0;
      renderCarousel();
      restartAutoSlide();
    },
    (error) => {
      console.error("Landing announcement listener error:", error);
      previewAnnouncements = [];
      previewCurrentSlide = 0;
      renderCarousel();
      restartAutoSlide();
    }
  );
}

function formatMonthTitle(date) {
  return date.toLocaleDateString([], { month: "long", year: "numeric" });
}

function getNearestUpcomingEvent(events) {
  const today = getToday();
  return events.find((eventItem) => {
    const eventDate = parseEventDate(eventItem.eventDate);
    return eventDate && eventDate >= today;
  }) || events[0] || null;
}

function getEventMonthAnchor(events) {
  const nearest = getNearestUpcomingEvent(events);
  const baseDate = parseEventDate(nearest?.eventDate) || getToday();
  return new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
}

function getEventsForDate(dateKey) {
  return homeEventState.events.filter((eventItem) => safeText(eventItem.eventDate) === dateKey);
}

function getEventsForVisibleMonth() {
  if (!homeEventState.currentMonth) return [];
  const month = homeEventState.currentMonth.getMonth();
  const year = homeEventState.currentMonth.getFullYear();
  return homeEventState.events.filter((eventItem) => {
    const eventDate = parseEventDate(eventItem.eventDate);
    return eventDate && eventDate.getMonth() === month && eventDate.getFullYear() === year;
  });
}

function syncHomeCalendarSelection() {
  if (!homeEventState.events.length) {
    homeEventState.selectedDateKey = "";
    homeEventState.currentMonth = new Date(getToday().getFullYear(), getToday().getMonth(), 1);
    return;
  }

  if (!homeEventState.currentMonth) {
    homeEventState.currentMonth = getEventMonthAnchor(homeEventState.events);
  }

  const selectedEvents = getEventsForDate(homeEventState.selectedDateKey);
  if (selectedEvents.length) return;

  const monthEvents = getEventsForVisibleMonth();
  if (monthEvents.length) {
    homeEventState.selectedDateKey = safeText(monthEvents[0].eventDate);
    return;
  }

  const nextEvent = getNearestUpcomingEvent(homeEventState.events);
  homeEventState.selectedDateKey = safeText(nextEvent?.eventDate);
}

function buildHomeEventItem(eventItem, isHighlighted = false) {
  const eventDate = parseEventDate(eventItem.eventDate);
  const monthLabel = eventDate ? eventDate.toLocaleDateString([], { month: "short" }).toUpperCase() : "TBA";
  const dayLabel = eventDate ? String(eventDate.getDate()) : "--";
  const audience = safeText(eventItem.audience, "All Students");
  const reminderText = eventItem.reminderEnabled ? "Reminder on" : "Reminder off";
  const description = truncateText(
    safeText(
      eventItem.description ||
      eventItem.eventDescription ||
      eventItem.details ||
      eventItem.content,
      "No description provided."
    ),
    120
  );

  return `
    <article class="event-item ${isHighlighted ? "highlighted" : ""}">
      <span class="event-accent" aria-hidden="true"></span>
      <div class="event-text">
        <span class="event-description-kicker">${escapeHtml(description)}</span>
        <h3>${escapeHtml(safeText(eventItem.title, "Untitled Event"))}</h3>
        <div class="event-facts">
          <span><i class="fa-regular fa-calendar" aria-hidden="true"></i>${escapeHtml(formatDate(eventItem.eventDate))}</span>
          <span><i class="fa-solid fa-location-dot" aria-hidden="true"></i>${escapeHtml(safeText(eventItem.venue, "Venue to be announced"))}</span>
        </div>
      </div>
      <div class="event-date-box" aria-label="${escapeHtml(monthLabel)} ${escapeHtml(dayLabel)}">
        <span class="event-month">${escapeHtml(monthLabel)}</span>
        <span class="event-day">${escapeHtml(dayLabel)}</span>
      </div>
    </article>
  `;
}

function renderHomeEventList() {
  if (!dom.eventList) return;

  const monthEvents = getEventsForVisibleMonth();
  const sortedEvents = [...monthEvents]
    .sort((left, right) => safeText(left.eventDate).localeCompare(safeText(right.eventDate)))
    .slice(0, 3);

  if (!sortedEvents.length) {
    dom.eventList.innerHTML = `
      <div class="events-empty">
        <div class="events-empty-card">
          <i class="fa-regular fa-calendar"></i>
          <h3>No events scheduled</h3>
          <p>When officers publish an event, it will appear here automatically.</p>
        </div>
      </div>
    `;
    return;
  }

  dom.eventList.innerHTML = sortedEvents
    .map((eventItem, index) => {
      const matchesSelection = safeText(eventItem.eventDate) === homeEventState.selectedDateKey;
      return buildHomeEventItem(eventItem, matchesSelection || index === 0);
    })
    .join("");
}

function renderHomeCalendar() {
  if (!dom.calendarGrid || !dom.calendarTitle || !homeEventState.currentMonth) return;

  const monthAnchor = homeEventState.currentMonth;
  const year = monthAnchor.getFullYear();
  const month = monthAnchor.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const today = getToday();
  const eventDaySet = new Set(
    homeEventState.events
      .filter((eventItem) => {
        const eventDate = parseEventDate(eventItem.eventDate);
        return eventDate && eventDate.getFullYear() === year && eventDate.getMonth() === month;
      })
      .map((eventItem) => safeText(eventItem.eventDate))
  );

  dom.calendarTitle.textContent = formatMonthTitle(monthAnchor);
  const weekdayLabels = ["S", "M", "T", "W", "T", "F", "S"];
  const cells = weekdayLabels.map((label) => `<div class="day-name">${label}</div>`);

  for (let index = 0; index < firstDay.getDay(); index += 1) {
    cells.push('<button class="day-cell muted empty" type="button" disabled aria-hidden="true"></button>');
  }

  for (let day = 1; day <= lastDay.getDate(); day += 1) {
    const cellDate = new Date(year, month, day);
    const dateKey = normalizeDateKey(cellDate);
    const classNames = ["day-cell"];
    if (eventDaySet.has(dateKey)) classNames.push("has-event");
    if (isSameDay(cellDate, today)) classNames.push("today");
    if (homeEventState.selectedDateKey === dateKey) classNames.push("selected");

    cells.push(`
      <button class="${classNames.join(" ")}" type="button" data-home-calendar-date="${dateKey}" aria-label="${escapeHtml(formatDate(dateKey))}">${day}</button>
    `);
  }

  const remainder = cells.length % 7;
  if (remainder !== 0) {
    for (let index = remainder; index < 7; index += 1) {
      cells.push('<button class="day-cell muted empty" type="button" disabled aria-hidden="true"></button>');
    }
  }

  dom.calendarGrid.innerHTML = cells.join("");
}

function refreshHomeEvents() {
  syncHomeCalendarSelection();
  renderHomeCalendar();
  renderHomeEventList();
}

function startHomeEventsListener() {
  const eventsQuery = query(collection(db, "events"), orderBy("eventDate", "asc"));

  onSnapshot(
    eventsQuery,
    (snapshot) => {
      homeEventState.events = snapshot.docs
        .map((docItem) => ({ id: docItem.id, ...docItem.data() }))
        .filter((eventItem) => safeText(eventItem.status, "Published") === "Published");
      if (!homeEventState.currentMonth) {
        homeEventState.currentMonth = getEventMonthAnchor(homeEventState.events);
      }
      refreshHomeEvents();
    },
    (error) => {
      console.error("Landing events listener error:", error);
      homeEventState.events = [];
      refreshHomeEvents();
    }
  );
}

function bindDotNavigation() {
  dom.dotsHost?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const dotIndex = target.getAttribute("data-dot-index");
    if (dotIndex !== null) {
      goToPreviewSlide(Number(dotIndex));
      restartAutoSlide();
    }
  });
}

function getLandingHeaderHeight() {
  const header = dom.topHeader;
  if (!header) return 0;
  return Math.max(0, Math.round(header.getBoundingClientRect().height));
}

function getSectionScrollTop(section) {
  if (!section) return 0;
  const documentTop = section.getBoundingClientRect().top + window.scrollY;
  return Math.max(0, Math.round(documentTop - getLandingHeaderHeight()));
}

function scrollToSection(section) {
  if (!section) return;

  // The header is fixed across the entire landing page.  Calculate the exact
  // destination ourselves instead of combining scrollIntoView(),
  // scroll-padding and scroll-margin offsets.  This guarantees that every
  // chapter lands flush against the bottom edge of the header.
  window.scrollTo({
    top: getSectionScrollTop(section),
    behavior: "smooth",
  });
}

function bindScrollButton() {
  dom.scrollDownBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    const mobileLanding = window.matchMedia("(max-width: 940px)").matches;
    scrollToSection(mobileLanding ? dom.announcementSection : dom.eventsSection);
  });
}

function bindSectionStepNavigation() {
  const mobileQuery = window.matchMedia("(max-width: 940px)");

  // Wheel/trackpad input needs a short gesture lock because one physical
  // trackpad swipe can emit dozens of wheel events. Touch input does not use
  // this lock: each touchstart -> touchend sequence already represents one
  // deliberate swipe, so blocking it only makes rapid swipes feel laggy.
  let wheelLocked = false;
  let wheelUnlockTimer = 0;
  let wheelLockStartedAt = 0;

  let touchStartY = 0;
  let touchStartX = 0;
  let touchLastY = 0;
  let touchLastX = 0;
  let touchStartTarget = null;
  let touchStartIndex = 0;
  let touchCaptured = false;
  let touchTargetIndex = null;
  let lastTouchStepAt = 0;

  const getSections = () => {
    // Mobile is intentionally a four-chapter story. The announcement preview
    // is a real navigation stop between Welcome and Upcoming Events.
    if (mobileQuery.matches) {
      return [dom.heroCopy, dom.announcementSection, dom.eventsSection, dom.aboutSection].filter(Boolean);
    }
    return [dom.welcomeSection, dom.eventsSection, dom.aboutSection].filter(Boolean);
  };

  const lockWheelNavigation = () => {
    const now = performance.now();
    if (!wheelLocked) wheelLockStartedAt = now;
    wheelLocked = true;
    window.clearTimeout(wheelUnlockTimer);

    // Do not let trackpad momentum keep the UI blocked indefinitely. A single
    // gesture may stream wheel events for a while, but the hard cap keeps the
    // next intentional gesture responsive.
    const elapsed = now - wheelLockStartedAt;
    const remainingCap = Math.max(0, 430 - elapsed);
    const delay = Math.min(180, remainingCap || 0);

    if (remainingCap <= 0) {
      wheelLocked = false;
      return;
    }

    wheelUnlockTimer = window.setTimeout(() => {
      wheelLocked = false;
    }, delay);
  };

  const getDocumentTop = (section) => section.getBoundingClientRect().top + window.scrollY;

  const getNearestSectionIndex = (sections = getSections()) => {
    const visibleHeight = Math.max(1, window.innerHeight - getLandingHeaderHeight());
    const viewportAnchor = window.scrollY + getLandingHeaderHeight() + Math.min(visibleHeight * 0.20, 120);
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;

    sections.forEach((section, index) => {
      const distance = Math.abs(getDocumentTop(section) - viewportAnchor);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });

    return bestIndex;
  };

  const getInternalScroller = (target) => {
    if (!(target instanceof Element)) return null;
    return target.closest(".events-side");
  };

  const canScrollInside = (target, direction) => {
    const scrollable = getInternalScroller(target);
    if (!scrollable) return false;
    if (scrollable.scrollHeight <= scrollable.clientHeight + 2) return false;

    if (direction > 0) {
      return scrollable.scrollTop + scrollable.clientHeight < scrollable.scrollHeight - 2;
    }
    return scrollable.scrollTop > 2;
  };

  const canStepFrom = (sections, currentIndex, direction, sourceTarget) => {
    if (!direction || currentIndex < 0 || currentIndex >= sections.length) return false;
    if (canScrollInside(sourceTarget, direction)) return false;
    if (direction > 0) return currentIndex < sections.length - 1;
    if (currentIndex <= 0) return false;

    // If a long section has been scrolled internally by the browser, allow it
    // to return to its own top before moving to the previous landing chapter.
    const currentTop = Math.max(0, getDocumentTop(sections[currentIndex]) - getLandingHeaderHeight());
    return window.scrollY <= currentTop + 40;
  };

  const stepFromIndex = (sections, currentIndex, direction, sourceTarget, inputType = "touch") => {
    if (inputType === "wheel" && wheelLocked) return false;
    if (!canStepFrom(sections, currentIndex, direction, sourceTarget)) return false;

    const nextIndex = currentIndex + direction;
    const nextSection = sections[nextIndex];
    if (!nextSection) return false;

    if (inputType === "wheel") {
      lockWheelNavigation();
    } else {
      // Record the destination immediately. If the user swipes again before
      // the smooth scroll has visually finished, the next swipe starts from
      // this destination rather than re-detecting the partially scrolled page.
      touchTargetIndex = nextIndex;
      lastTouchStepAt = performance.now();
    }

    scrollToSection(nextSection);
    return true;
  };

  const tryWheelStep = (direction, sourceTarget) => {
    const sections = getSections();
    if (sections.length < 2) return false;
    return stepFromIndex(sections, getNearestSectionIndex(sections), direction, sourceTarget, "wheel");
  };

  window.addEventListener("wheel", (event) => {
    if (Math.abs(event.deltaY) < 18) return;

    // Trackpads emit a stream of wheel events for one physical gesture. Swallow
    // the momentum events briefly, but never hold the page for a long timeout.
    if (wheelLocked) {
      lockWheelNavigation();
      event.preventDefault();
      return;
    }

    const direction = event.deltaY > 0 ? 1 : -1;
    if (tryWheelStep(direction, event.target)) event.preventDefault();
  }, { passive: false });

  // Touch navigation is intentionally lock-free. A completed finger swipe
  // always means exactly one chapter, and a second immediate swipe can target
  // the next/previous chapter even while the first smooth scroll is finishing.
  window.addEventListener("touchstart", (event) => {
    if (!mobileQuery.matches) return;
    const touch = event.changedTouches?.[0];
    if (!touch) return;

    const sections = getSections();
    const now = performance.now();
    const hasFreshTarget = Number.isInteger(touchTargetIndex)
      && touchTargetIndex >= 0
      && touchTargetIndex < sections.length
      && now - lastTouchStepAt < 900;

    touchStartY = touchLastY = touch.clientY;
    touchStartX = touchLastX = touch.clientX;
    touchStartTarget = event.target;
    touchStartIndex = hasFreshTarget ? touchTargetIndex : getNearestSectionIndex(sections);
    touchCaptured = false;
  }, { passive: true });

  window.addEventListener("touchmove", (event) => {
    if (!mobileQuery.matches) return;
    const touch = event.changedTouches?.[0] || event.touches?.[0];
    if (!touch) return;

    touchLastY = touch.clientY;
    touchLastX = touch.clientX;
    const deltaY = touchStartY - touchLastY;
    const deltaX = touchStartX - touchLastX;
    const direction = deltaY > 0 ? 1 : -1;

    // Capture as soon as the intent is clearly vertical so native momentum
    // does not begin fighting the section transition.
    if (Math.abs(deltaY) < 7 || Math.abs(deltaY) <= Math.abs(deltaX) * 1.10) return;

    const sections = getSections();
    if (!canStepFrom(sections, touchStartIndex, direction, touchStartTarget)) return;

    touchCaptured = true;
    if (event.cancelable) event.preventDefault();
  }, { passive: false });

  window.addEventListener("touchend", (event) => {
    if (!mobileQuery.matches) return;
    const touch = event.changedTouches?.[0];
    if (touch) {
      touchLastY = touch.clientY;
      touchLastX = touch.clientX;
    }

    const deltaY = touchStartY - touchLastY;
    const deltaX = touchStartX - touchLastX;
    const isVerticalSwipe = Math.abs(deltaY) >= 36 && Math.abs(deltaY) > Math.abs(deltaX) * 1.10;

    if (touchCaptured && isVerticalSwipe) {
      const direction = deltaY > 0 ? 1 : -1;
      stepFromIndex(getSections(), touchStartIndex, direction, touchStartTarget, "touch");
    }

    touchCaptured = false;
    touchStartTarget = null;
  }, { passive: true });

  window.addEventListener("touchcancel", () => {
    touchCaptured = false;
    touchStartTarget = null;
  }, { passive: true });

  // If the viewport changes enough to alter the mobile/desktop section model,
  // discard the remembered touch destination and re-detect it on the next swipe.
  mobileQuery.addEventListener?.("change", () => {
    touchTargetIndex = null;
    lastTouchStepAt = 0;
    wheelLocked = false;
    window.clearTimeout(wheelUnlockTimer);
  });
}

function bindEventsFollowingBackground() {
  const layer = dom.eventsFollowingBackground;
  const flow = dom.heroEventsFlow;
  if (!layer || !flow) return;

  let frameId = 0;

  const update = () => {
    frameId = 0;
    const rect = flow.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;

    // Reveal the ONE viewport-anchored campus image only through the visible
    // part of the Welcome + Upcoming Events wrapper. The layer is gone before
    // About USC, Goals, and the footer enter the viewport.
    if (rect.bottom <= 0 || rect.top >= viewportHeight) {
      layer.classList.remove("is-visible");
      layer.style.clipPath = "inset(100% 0 0 0)";
      layer.style.webkitClipPath = "inset(100% 0 0 0)";
      return;
    }

    const topClip = Math.max(0, rect.top);
    const bottomClip = Math.max(0, viewportHeight - rect.bottom);
    const clipValue = `inset(${topClip}px 0 ${bottomClip}px 0)`;

    layer.style.clipPath = clipValue;
    layer.style.webkitClipPath = clipValue;
    layer.classList.add("is-visible");
  };

  const requestUpdate = () => {
    if (frameId) return;
    frameId = window.requestAnimationFrame(update);
  };

  window.addEventListener("scroll", requestUpdate, { passive: true });
  window.addEventListener("resize", requestUpdate, { passive: true });
  window.addEventListener("orientationchange", requestUpdate, { passive: true });
  requestUpdate();
}

function bindLandingHeaderNavigation() {
  const header = dom.topHeader;
  const toggle = dom.mobileNavToggle;
  const nav = dom.landingNav;
  if (!header || !toggle || !nav) return;

  const syncScrolledState = () => {
    header.classList.toggle("is-scrolled", window.scrollY > 18);
  };

  syncScrolledState();
  window.addEventListener("scroll", syncScrolledState, { passive: true });

  const closeNav = () => {
    header.classList.remove("nav-open");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Open navigation");
    const icon = toggle.querySelector("i");
    icon?.classList.remove("fa-xmark");
    icon?.classList.add("fa-bars");
  };

  const openNav = () => {
    header.classList.add("nav-open");
    toggle.setAttribute("aria-expanded", "true");
    toggle.setAttribute("aria-label", "Close navigation");
    const icon = toggle.querySelector("i");
    icon?.classList.remove("fa-bars");
    icon?.classList.add("fa-xmark");
  };

  toggle.addEventListener("click", () => {
    if (header.classList.contains("nav-open")) closeNav();
    else openNav();
  });

  nav.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("a")) closeNav();
  });

  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Node) || header.contains(event.target)) return;
    closeNav();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeNav();
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 940) closeNav();
  }, { passive: true });
}

function bindHomeCalendarControls() {
  dom.calendarPrev?.addEventListener("click", () => {
    const current = homeEventState.currentMonth || getToday();
    homeEventState.currentMonth = new Date(current.getFullYear(), current.getMonth() - 1, 1);
    const monthEvents = getEventsForVisibleMonth();
    homeEventState.selectedDateKey = monthEvents.length ? safeText(monthEvents[0].eventDate) : "";
    refreshHomeEvents();
  });

  dom.calendarNext?.addEventListener("click", () => {
    const current = homeEventState.currentMonth || getToday();
    homeEventState.currentMonth = new Date(current.getFullYear(), current.getMonth() + 1, 1);
    const monthEvents = getEventsForVisibleMonth();
    homeEventState.selectedDateKey = monthEvents.length ? safeText(monthEvents[0].eventDate) : "";
    refreshHomeEvents();
  });

  dom.calendarGrid?.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest("[data-home-calendar-date]") : null;
    if (!target) return;
    homeEventState.selectedDateKey = safeText(target.getAttribute("data-home-calendar-date"));
    refreshHomeEvents();
  });
}

function initLandingAnnouncements() {
  if (!dom.slidesHost || !dom.dotsHost) {
    console.error("Missing preview carousel containers in home/home.html");
    return;
  }

  bindDotNavigation();
  bindScrollButton();
  bindSectionStepNavigation();
  bindEventsFollowingBackground();
  bindHomeCalendarControls();
  bindLandingHeaderNavigation();
  renderCarousel();
  startAnnouncementsListener();
  startHomeEventsListener();
}

window.changePreviewSlide = (direction) => {
  changePreviewSlide(direction);
  restartAutoSlide();
};

window.goToPreviewSlide = (index) => {
  goToPreviewSlide(index);
  restartAutoSlide();
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initLandingAnnouncements, { once: true });
} else {
  initLandingAnnouncements();
}
