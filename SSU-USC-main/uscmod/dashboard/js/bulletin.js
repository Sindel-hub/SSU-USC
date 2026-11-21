import { announcementExcerpt } from "../../shared/announcement-excerpt.mjs";
import { auth, db } from "../../firebase/firebase-config.js";
import { collection, limit, onSnapshot, orderBy, query } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import { signOut } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import { hydrateMediaImages, resolveMediaUrl } from "../../shared/security-client.js";

const uscAuthAllowed = await (globalThis.USC_AUTH_READY || Promise.resolve(false));
if (uscAuthAllowed !== true) await new Promise(() => {});


const PROFILE_KEY = "studentProfile";
const SESSION_KEY = "activeSession";

let announcements = [];
let carouselIndex = 0;
let carouselPhysicalIndex = 0;
let carouselCloneCount = 0;
let carouselAnimating = false;
let carouselTransitionTimer = 0;
let carouselQueuedDirection = 0;
let touchStartX = 0;
let touchStartY = 0;
let modalReturnFocus = null;

const feed = document.getElementById("bulletinFeed");
const viewport = document.getElementById("bulletinViewport");
const carousel = document.querySelector(".bulletin-carousel");
const prevButton = document.getElementById("bulletinPrev");
const nextButton = document.getElementById("bulletinNext");
const dotsHost = document.getElementById("bulletinDots");

function clean(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function escapeHtml(value) {
  return clean(value).replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  }[char]));
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
    initialsEl.textContent = name
      .split(/\s+/)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }
  return student;
}

function formatDate(value) {
  const date = value?.toDate ? value.toDate() : new Date(value || 0);
  if (Number.isNaN(date.getTime())) return "Latest update";
  return date.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });
}

function visibleCards() {
  if (!carousel) return 1;
  const raw = getComputedStyle(carousel).getPropertyValue("--bulletin-visible");
  return Math.max(1, Number.parseInt(raw, 10) || 1);
}

function maxCarouselIndex() {
  return announcements.length > visibleCards() ? announcements.length - 1 : 0;
}

function renderDots() {
  if (!dotsHost) return;
  const pages = maxCarouselIndex() + 1;
  if (announcements.length <= visibleCards()) {
    dotsHost.innerHTML = "";
    return;
  }

  if (dotsHost.children.length !== pages) dotsHost.innerHTML = Array.from({ length: pages }, (_, index) => (
    `<button class="bulletin-carousel-dot${index === carouselIndex ? " active" : ""}" type="button" data-carousel-index="${index}" aria-label="Show announcement set ${index + 1}"></button>`
  )).join("");
  dotsHost.querySelectorAll("button").forEach((button, index) => {
    button.classList.toggle("active", index === carouselIndex);
    if (index === carouselIndex) button.setAttribute("aria-current", "true");
    else button.removeAttribute("aria-current");
  });
}

function stopCarouselTransition() {
  window.clearTimeout(carouselTransitionTimer);
  carouselAnimating = false;
  carouselQueuedDirection = 0;
}

function updateCarouselVisibility() {
  feed.querySelectorAll('.bulletin-page-card').forEach((card, index) => {
    const offscreen = index < carouselPhysicalIndex || index >= carouselPhysicalIndex + visibleCards();
    card.inert = offscreen;
    card.setAttribute('aria-hidden', String(offscreen));
  });
}

function positionCarouselTrack({ animate = false } = {}) {
  const card = feed.querySelector('.bulletin-page-card');
  const style = getComputedStyle(feed);
  const gap = Number.parseFloat(style.columnGap || style.gap || '0') || 0;
  const step = card ? card.getBoundingClientRect().width + gap : 0;
  feed.style.transition = animate ? '' : 'none';
  feed.style.transform = `translate3d(${-carouselPhysicalIndex * step}px, 0, 0)`;
  if (!animate) {
    // Commit the identical boundary image before restoring transitions.
    void feed.offsetWidth;
    feed.style.transition = '';
  }
}

function finishCarouselTransition() {
  if (!carouselAnimating) return;
  carouselAnimating = false;
  window.clearTimeout(carouselTransitionTimer);
  // Boundary copies let the last/first transition keep its direction. Rebase
  // invisibly to the equivalent original cards once that single step finishes.
  const canonicalIndex = carouselCloneCount + carouselIndex;
  if (carouselPhysicalIndex !== canonicalIndex) {
    carouselPhysicalIndex = canonicalIndex;
    positionCarouselTrack();
    updateCarouselVisibility();
  }
  const queuedDirection = carouselQueuedDirection;
  carouselQueuedDirection = 0;
  if (queuedDirection) moveCarousel(queuedDirection);
}

function applyCarouselPosition({ animate = true, physicalIndex } = {}) {
  if (!feed) return;

  const cloneCount = announcements.length > visibleCards() ? visibleCards() : 0;
  if (cloneCount !== carouselCloneCount) {
    renderAnnouncements();
    return;
  }
  stopCarouselTransition();
  const maxIndex = maxCarouselIndex();
  if (maxIndex <= 0) carouselIndex = 0;
  else if (carouselIndex < 0) carouselIndex = maxIndex;
  else if (carouselIndex > maxIndex) carouselIndex = 0;
  carouselPhysicalIndex = physicalIndex ?? (carouselCloneCount + carouselIndex);
  positionCarouselTrack({ animate });

  const isStatic = announcements.length <= visibleCards();
  carousel?.classList.toggle("is-static", isStatic);
  carousel?.classList.toggle("is-single", announcements.length === 1);
  for (const button of [prevButton, nextButton]) if (button) { button.disabled = isStatic; button.hidden = isStatic; }
  updateCarouselVisibility();
  const position = document.getElementById("bulletinPosition");
  const shown = Array.from({ length: Math.min(visibleCards(), announcements.length) }, (_, index) => (carouselIndex + index) % announcements.length + 1);
  if (position) position.textContent = announcements.length ? `Showing announcements ${shown.join(', ')} of ${announcements.length}` : "No announcements";
  renderDots();
  if (animate) {
    carouselAnimating = true;
    const duration = getComputedStyle(feed).transitionDuration.split(',').reduce((max, value) => Math.max(max, Number.parseFloat(value) * (value.trim().endsWith('ms') ? 1 : 1000) || 0), 0);
    if (duration > 0) carouselTransitionTimer = window.setTimeout(finishCarouselTransition, duration + 80);
    else finishCarouselTransition();
  }
}

function moveCarousel(direction) {
  const maxIndex = maxCarouselIndex();
  if (maxIndex <= 0) return;
  if (carouselAnimating) {
    carouselQueuedDirection = direction > 0 ? 1 : -1;
    return;
  }
  carouselIndex = direction > 0
    ? (carouselIndex >= maxIndex ? 0 : carouselIndex + 1)
    : (carouselIndex <= 0 ? maxIndex : carouselIndex - 1);
  applyCarouselPosition({ physicalIndex: carouselPhysicalIndex + (direction > 0 ? 1 : -1) });
}

function renderAnnouncements() {
  if (!feed) return;
  stopCarouselTransition();
  carouselCloneCount = announcements.length > visibleCards() ? visibleCards() : 0;

  if (!announcements.length) {
    feed.innerHTML = '<div class="bulletin-empty">No announcements have been posted yet.</div>';
    carouselIndex = 0;
    applyCarouselPosition({ animate: false });
    return;
  }

  const cards = announcements.map((announcement, index) => {
    const excerpt = announcementExcerpt(announcement.content);
    const image = announcement.imageUrl
      ? `<img src="${escapeHtml(announcement.imageUrl)}" alt="${escapeHtml(announcement.title || "USC announcement")}">`
      : '<div class="bulletin-page-placeholder"><i class="fa-regular fa-image"></i></div>';

    return `
      <article class="bulletin-page-card" data-bulletin-index="${index}">
        <div class="bulletin-page-image">${image}</div>
        <div class="bulletin-page-body">
          <div class="bulletin-page-date">${escapeHtml(formatDate(announcement.createdAt || announcement.createdAtMs))}</div>
          <h2>${escapeHtml(announcement.title || "USC Announcement")}</h2>
          <p>${escapeHtml(excerpt)}</p>
          <button class="bulletin-read-more" type="button" data-id="${escapeHtml(announcement.id)}" aria-label="Read full announcement: ${escapeHtml(announcement.title || "USC Announcement")}">
            <span>Read more</span>
            <span class="bulletin-read-more-icon" aria-hidden="true"><i class="fa-solid fa-arrow-right"></i></span>
          </button>
        </div>
      </article>`;
  });
  feed.innerHTML = (carouselCloneCount
    ? [...cards.slice(-carouselCloneCount), ...cards, ...cards.slice(0, carouselCloneCount)]
    : cards).join('');
  hydrateMediaImages(feed).catch(() => {});

  carouselIndex = Math.min(Math.max(carouselIndex, 0), maxCarouselIndex());
  requestAnimationFrame(() => applyCarouselPosition({ animate: false }));
}

function openAnnouncement(announcement) {
  if (!announcement) return;

  const modal = document.getElementById("bulletinModal");
  const image = document.getElementById("bulletinModalImage");
  if (!modal || !image) return;

  document.getElementById("bulletinModalTitle").textContent = clean(announcement.title);
  document.getElementById("bulletinModalCategory").textContent = clean(announcement.category, "Official Notice");
  document.getElementById("bulletinModalDate").textContent = formatDate(announcement.createdAt || announcement.createdAtMs);
  document.getElementById("bulletinModalAudience").textContent = `Audience: ${clean(announcement.audience, "All students")}`;
  document.getElementById("bulletinModalContent").textContent = String(announcement.content ?? "");

  if (announcement.imageUrl) {
    image.src = announcement.imageUrl;
    resolveMediaUrl(announcement.imageUrl).then((url) => { image.src = url; }).catch(() => {});
    image.classList.remove("hidden");
  } else {
    image.removeAttribute("src");
    image.classList.add("hidden");
  }

  modalReturnFocus = document.activeElement;
  modal.classList.remove("hidden");
  modal.querySelector(".modal-close")?.focus();
  document.body.classList.add("modal-open");
}

function closeModal() {
  const modal = document.getElementById("bulletinModal");
  if (!modal || modal.classList.contains("hidden")) return;
  modal.classList.add("hidden");
  document.body.classList.remove("modal-open");
  if (modalReturnFocus?.isConnected && !modalReturnFocus.closest("[inert]")) modalReturnFocus.focus({ preventScroll: true });
  else viewport?.focus({ preventScroll: true });
}

guardStudent();

onSnapshot(
  query(collection(db, "announcements"), orderBy("createdAtMs", "desc"), limit(30)),
  (snapshot) => {
    announcements = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    renderAnnouncements();
  },
  () => renderAnnouncements()
);

feed?.addEventListener("click", (event) => {
  const button = event.target.closest?.("[data-id]");
  if (!button) return;
  openAnnouncement(announcements.find((item) => item.id === button.dataset.id));
});

prevButton?.addEventListener("click", () => moveCarousel(-1));
nextButton?.addEventListener("click", () => moveCarousel(1));
feed?.addEventListener('transitionend', event => {
  if (event.target === feed && event.propertyName === 'transform') finishCarouselTransition();
});

dotsHost?.addEventListener("click", (event) => {
  const button = event.target.closest?.("[data-carousel-index]");
  if (!button) return;
  carouselIndex = Number(button.dataset.carouselIndex) || 0;
  applyCarouselPosition();
});

viewport?.addEventListener("touchstart", (event) => {
  touchStartX = event.changedTouches[0]?.clientX || 0;
  touchStartY = event.changedTouches[0]?.clientY || 0;
}, { passive: true });

viewport?.addEventListener("touchend", (event) => {
  const endX = event.changedTouches[0]?.clientX ?? touchStartX;
  const distance = endX - touchStartX;
  const verticalDistance = (event.changedTouches[0]?.clientY ?? touchStartY) - touchStartY;
  if (Math.abs(distance) < 45 || Math.abs(verticalDistance) > Math.abs(distance)) return;
  moveCarousel(distance < 0 ? 1 : -1);
}, { passive: true });

viewport?.addEventListener("keydown", (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
  event.preventDefault();
  moveCarousel(event.key === "ArrowRight" ? 1 : -1);
  viewport.focus({ preventScroll: true });
});

if (typeof ResizeObserver !== "undefined" && viewport) {
  new ResizeObserver(() => applyCarouselPosition({ animate: false })).observe(viewport);
} else {
  window.addEventListener("resize", () => applyCarouselPosition({ animate: false }));
}

document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", closeModal));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeModal();
  const modal = document.getElementById("bulletinModal");
  if (event.key === "Tab" && modal && !modal.classList.contains("hidden")) {
    event.preventDefault(); modal.querySelector(".modal-close")?.focus();
  }
});

document.getElementById("studentLogout")?.addEventListener("click", async () => {
  sessionStorage.clear();
  try {
    await signOut(auth);
  } catch {}
  location.replace("../index/index.html");
});
