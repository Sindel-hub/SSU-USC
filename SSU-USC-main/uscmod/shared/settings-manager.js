import { mountFacebookSettings } from './facebook-service.js';
import { auth } from "../firebase/firebase-config.js";
import { signOut } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";

const STORAGE_KEY = "uscPortalSettingsV1";
const SESSION_KEYS = ["activeSession", "studentProfile", "sessionExpiresAt", "lastActivityAt"];
const DEFAULTS = Object.freeze({
  reducedMotion: false,
  highContrast: false,
  showNotificationBadges: true
});

let settings = { ...DEFAULTS };
let currentRole = "student";
let trigger = null;
let overlay = null;
let drawer = null;
let open = false;
let scrollState = null;

function readSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return normalizeSettings(stored || {});
  } catch {
    return { ...DEFAULTS };
  }
}

function normalizeSettings(value = {}) {
  return {
    reducedMotion: value.reducedMotion === true,
    highContrast: value.highContrast === true,
    showNotificationBadges: value.showNotificationBadges !== false
  };
}

function saveSettings() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* Keep preferences usable for this session when storage is blocked. */ }
}

function applySettings() {
  const root = document.documentElement;
  delete root.dataset.uscThemePreference;
  delete root.dataset.uscEffectiveTheme;
  root.classList.toggle("usc-reduced-motion", settings.reducedMotion);
  root.classList.toggle("usc-high-contrast", settings.highContrast);
  root.classList.toggle("usc-hide-notification-badges", !settings.showNotificationBadges);
  updateControls();
}

function injectStyles() {
  if (document.getElementById("uscSettingsManagerStyles")) return;
  const link = document.createElement("link");
  link.id = "uscSettingsManagerStyles";
  link.rel = "stylesheet";
  link.href = new URL("./settings-manager.css?v=ui-repair-20260910", import.meta.url).href;
  document.head.appendChild(link);
}

function createTrigger(profileTrigger) {
  document.getElementById("uscSettingsTrigger")?.remove();
  const button = document.createElement("button");
  button.id = "uscSettingsTrigger";
  button.type = "button";
  button.className = "usc-settings-trigger";
  button.setAttribute("aria-label", "Open settings");
  button.setAttribute("aria-controls", "uscSettingsDrawer");
  button.setAttribute("aria-expanded", "false");
  button.title = "Settings";
  button.innerHTML = '<i class="fa-solid fa-gear" aria-hidden="true"></i><span class="usc-settings-trigger-label">Settings</span>';

  const parent = profileTrigger?.parentElement;
  if (parent) parent.insertBefore(button, profileTrigger);
  else document.body.appendChild(button);
  return button;
}

function createDrawer() {
  document.getElementById("uscSettingsOverlay")?.remove();
  document.getElementById("uscSettingsDrawer")?.remove();

  const backdrop = document.createElement("div");
  backdrop.id = "uscSettingsOverlay";
  backdrop.className = "usc-settings-overlay";
  backdrop.hidden = true;

  const panel = document.createElement("aside");
  panel.id = "uscSettingsDrawer";
  panel.className = "usc-settings-drawer usc-settings-loading";
  panel.setAttribute("aria-label", "Portal settings");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-hidden", "true");
  panel.innerHTML = `
    <header class="usc-settings-head">
      <div>
        <span>PORTAL PREFERENCES</span>
        <h2>Settings</h2>
        <p>Manage essential accessibility, notifications, and account shortcuts for this device.</p>
      </div>
      <button id="uscSettingsClose" type="button" aria-label="Close settings"><i class="fa-solid fa-xmark"></i></button>
    </header>

    <div class="usc-settings-body">
      <section class="usc-settings-section">
        <div class="usc-settings-section-head">
          <span class="usc-settings-section-icon"><i class="fa-solid fa-universal-access"></i></span>
          <div><strong>Accessibility</strong><small>Reduce visual strain and unnecessary movement.</small></div>
        </div>
        <label class="usc-setting-toggle-row">
          <span class="usc-setting-copy"><strong>Reduce motion</strong><small>Minimizes animations and transition effects.</small></span>
          <input id="uscSettingReducedMotion" type="checkbox" />
          <span class="usc-switch" aria-hidden="true"></span>
        </label>
        <label class="usc-setting-toggle-row">
          <span class="usc-setting-copy"><strong>High contrast</strong><small>Strengthens borders, labels, and important controls.</small></span>
          <input id="uscSettingHighContrast" type="checkbox" />
          <span class="usc-switch" aria-hidden="true"></span>
        </label>
      </section>

      <section class="usc-settings-section usc-settings-notifications-section">
        <div class="usc-settings-section-head">
          <span class="usc-settings-section-icon"><i class="fa-regular fa-bell"></i></span>
          <div><strong>Notifications</strong><small>Control how portal alerts are presented.</small></div>
        </div>
        <label class="usc-setting-toggle-row usc-notification-toggle-card">
          <span class="usc-setting-copy"><strong>Notification badges</strong><small>Show unread dots and counters in the dashboard.</small></span>
          <input id="uscSettingNotificationBadges" type="checkbox" />
          <span class="usc-switch" aria-hidden="true"></span>
        </label>
        <button id="uscSettingsEmailPreferences" class="usc-settings-action-card email-supported-setting" type="button">
          <span class="usc-settings-action-icon"><i class="fa-regular fa-envelope"></i></span>
          <span><strong>Email & recovery preferences</strong><small>Manage your verified personal Gmail and email alerts.</small></span>
          <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
        </button>
      </section>

      <section class="usc-settings-section">
        <div class="usc-settings-section-head">
          <span class="usc-settings-section-icon"><i class="fa-solid fa-shield-halved"></i></span>
          <div><strong>Account & Security</strong><small>Quick access to your account controls.</small></div>
        </div>
        <button id="uscSettingsOpenProfile" class="usc-settings-action-card" type="button">
          <span class="usc-settings-action-icon"><i class="fa-regular fa-user"></i></span>
          <span><strong>Edit profile</strong><small>Update your name or profile photo.</small></span>
          <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
        </button>
        <button id="uscSettingsChangePassword" class="usc-settings-action-card" type="button">
          <span class="usc-settings-action-icon"><i class="fa-solid fa-key"></i></span>
          <span><strong>Change password</strong><small>Open the secure password controls in your profile.</small></span>
          <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
        </button>
      </section>

      <section id="facebookConnectionSettings" class="usc-settings-section" hidden></section>
      <section class="usc-settings-section usc-settings-maintenance">
        <button id="uscSettingsReset" class="usc-settings-secondary-btn" type="button"><i class="fa-solid fa-arrow-rotate-left"></i> Restore default settings</button>
        <p>These preferences are saved only in this browser on this device.</p>
      </section>
    </div>

    <button id="uscSettingsLogout" class="usc-settings-logout" type="button"><i class="fa-solid fa-right-from-bracket"></i> Log Out</button>
  `;

  document.body.append(backdrop, panel);
  requestAnimationFrame(() => panel.classList.remove("usc-settings-loading"));
  return { backdrop, panel };
}

function updateControls() {
  if (!drawer) return;
  const reduced = drawer.querySelector("#uscSettingReducedMotion");
  const contrast = drawer.querySelector("#uscSettingHighContrast");
  const badges = drawer.querySelector("#uscSettingNotificationBadges");
  if (reduced) reduced.checked = settings.reducedMotion;
  if (contrast) contrast.checked = settings.highContrast;
  if (badges) badges.checked = settings.showNotificationBadges;
  drawer.querySelectorAll(".email-supported-setting").forEach((element) => {
    element.hidden = !["student", "officer"].includes(currentRole);
  });
}

function lockScroll() {
  if (scrollState) return;
  const scrollY = window.scrollY || 0;
  scrollState = {
    scrollY,
    position: document.body.style.position,
    top: document.body.style.top,
    width: document.body.style.width,
    overflow: document.body.style.overflow
  };
  document.body.style.position = "fixed";
  document.body.style.top = `-${scrollY}px`;
  document.body.style.width = "100%";
  document.body.style.overflow = "hidden";
  document.documentElement.classList.add("usc-settings-open");
}

function unlockScroll() {
  if (!scrollState) return;
  const state = scrollState;
  scrollState = null;
  document.body.style.position = state.position;
  document.body.style.top = state.top;
  document.body.style.width = state.width;
  document.body.style.overflow = state.overflow;
  document.documentElement.classList.remove("usc-settings-open");
  window.scrollTo(0, state.scrollY);
}

function openSettings() {
  if (!drawer || !overlay) return;
  updateControls();
  document.dispatchEvent(new CustomEvent("usc:settings-open"));
  open = true;
  overlay.hidden = false;
  requestAnimationFrame(() => {
    if (!open) return;
    overlay.classList.add("is-open");
    drawer.classList.add("is-open");
  });
  drawer.setAttribute("aria-hidden", "false");
  trigger?.setAttribute("aria-expanded", "true");
  lockScroll();
  window.setTimeout(() => { if (open) drawer.querySelector("#uscSettingsClose")?.focus(); }, 180);
  Promise.resolve().then(() => mountFacebookSettings(drawer.querySelector("#facebookConnectionSettings"), currentRole)).catch(() => {});
}

function closeSettings({ restoreFocus = true } = {}) {
  if (!drawer || !overlay) return;
  drawer.classList.remove("is-open");
  overlay.classList.remove("is-open");
  drawer.setAttribute("aria-hidden", "true");
  trigger?.setAttribute("aria-expanded", "false");
  unlockScroll();
  open = false;
  window.setTimeout(() => {
    if (!open) overlay.hidden = true;
  }, 220);
  if (restoreFocus) trigger?.focus();
}

function updateSetting(key, value) {
  settings = normalizeSettings({ ...settings, [key]: value });
  saveSettings();
  applySettings();
}

function openProfileSection(section = "profile") {
  closeSettings({ restoreFocus: false });
  window.setTimeout(() => {
    const profileTrigger = document.querySelector("[data-usc-profile-trigger]");
    profileTrigger?.click();
    window.setTimeout(() => {
      let target = null;
      if (section === "password") target = document.querySelector(".usc-profile-password-card");
      if (section === "email") target = document.getElementById("gmailSettings");
      if (section === "profile") target = document.getElementById("uscProfileFullName");
      target?.scrollIntoView?.({ behavior: settings.reducedMotion ? "auto" : "smooth", block: "center" });
      if (section === "password") document.getElementById("uscProfileNewPassword")?.focus();
      else if (section === "profile") document.getElementById("uscProfileFullName")?.focus();
    }, 260);
  }, 230);
}

async function logout() {
  SESSION_KEYS.forEach((key) => sessionStorage.removeItem(key));
  try { await signOut(auth); } catch (error) { console.warn("Settings logout error:", error); }
  window.location.replace(new URL("../index/index.html", import.meta.url).href);
}

function bindControls() {
  trigger?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (open) closeSettings(); else openSettings();
  }, { capture: true });
  overlay?.addEventListener("click", () => closeSettings());
  drawer?.querySelector("#uscSettingsClose")?.addEventListener("click", () => closeSettings());

  drawer?.querySelector("#uscSettingReducedMotion")?.addEventListener("change", (event) => updateSetting("reducedMotion", event.target.checked));
  drawer?.querySelector("#uscSettingHighContrast")?.addEventListener("change", (event) => updateSetting("highContrast", event.target.checked));
  drawer?.querySelector("#uscSettingNotificationBadges")?.addEventListener("change", (event) => updateSetting("showNotificationBadges", event.target.checked));
  drawer?.querySelector("#uscSettingsOpenProfile")?.addEventListener("click", () => openProfileSection("profile"));
  drawer?.querySelector("#uscSettingsChangePassword")?.addEventListener("click", () => openProfileSection("password"));
  drawer?.querySelector("#uscSettingsEmailPreferences")?.addEventListener("click", () => openProfileSection("email"));
  drawer?.querySelector("#uscSettingsReset")?.addEventListener("click", () => {
    settings = { ...DEFAULTS };
    saveSettings();
    applySettings();
  });
  drawer?.querySelector("#uscSettingsLogout")?.addEventListener("click", logout);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && open) closeSettings();
    if (event.key !== "Tab" || !open || !drawer) return;
    const focusable = [...drawer.querySelectorAll('button, input, select, a[href]')].filter((element) => !element.disabled && !element.hidden && element.getClientRects().length > 0);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
}

export function initializeSettingsManager({ role = "student" } = {}) {
  if (document.getElementById("uscSettingsDrawer")) return;
  currentRole = String(role || "student").toLowerCase();
  settings = readSettings();
  injectStyles();
  applySettings();

  const profileTrigger = document.querySelector("[data-usc-profile-trigger]");
  if (!profileTrigger) return;
  trigger = createTrigger(profileTrigger);
  const created = createDrawer();
  overlay = created.backdrop;
  drawer = created.panel;
  updateControls();
  bindControls();
}
