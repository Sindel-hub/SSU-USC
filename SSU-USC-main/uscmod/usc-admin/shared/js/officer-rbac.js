import {
  permissionForOfficerHref,
  permissionForOfficerPath,
  effectiveOfficerPermissions,
  permissionDefinition
} from "../../../shared/officer-permissions.js?v=programs-1";

const authAllowed = await (globalThis.USC_AUTH_READY || Promise.resolve(false));
// Authentication remains fail-closed. Once the account is verified as an
// officer/admin, every officer module may open. RBAC then determines whether
// the module is interactive or read-only.
if (authAllowed !== true) await new Promise(() => {});

function revealAuthorizedOfficerUi() {
  document.documentElement.classList.remove("usc-officer-access-pending");
  document.documentElement.classList.add("usc-officer-access-ready");
}

function sessionProfile() {
  try { return JSON.parse(sessionStorage.getItem("studentProfile") || "null") || {}; }
  catch { return {}; }
}

let profile = sessionProfile();
let role = String(profile.role || "").toLowerCase();
let permissions = role === "admin"
  ? null
  : new Set(effectiveOfficerPermissions(profile, { legacyFullAccess: profile.officerPermissionsConfigured !== true }));

function refreshAccess(nextProfile = sessionProfile()) {
  profile = nextProfile || {};
  role = String(profile.role || "").toLowerCase();
  permissions = role === "admin"
    ? null
    : new Set(effectiveOfficerPermissions(profile, { legacyFullAccess: profile.officerPermissionsConfigured !== true }));
}

function clearDecoratedAccessState(root = document) {
  root.querySelectorAll?.(".rbac-readonly-link, .rbac-locked").forEach((anchor) => {
    anchor.classList.remove("rbac-readonly-link", "rbac-locked");
    anchor.removeAttribute("aria-disabled");
    if (anchor.dataset.rbacPermissionDerived === "true") {
      anchor.removeAttribute("data-rbac-permission");
      anchor.removeAttribute("data-rbac-permission-derived");
    }
    anchor.removeAttribute("title");
    anchor.querySelector(":scope > .rbac-readonly-icon, :scope > .rbac-lock-icon")?.remove();
  });

  root.querySelectorAll?.(".rbac-control-locked, .rbac-scope-locked").forEach((element) => {
    element.classList.remove("rbac-control-locked", "rbac-scope-locked");
    element.removeAttribute("aria-disabled");
    element.removeAttribute("title");
    if (element.dataset.rbacDisabledByScript === "true" && "disabled" in element) {
      element.disabled = false;
      delete element.dataset.rbacDisabledByScript;
    }
    element.querySelectorAll?.('[data-rbac-disabled-by-script="true"]').forEach((control) => {
      if ("disabled" in control) control.disabled = false;
      delete control.dataset.rbacDisabledByScript;
      control.removeAttribute("title");
    });
    element.querySelector(":scope > .rbac-readonly-note")?.remove();
  });

}

export function hasOfficerPermission(permission) {
  if (role === "admin") return true;
  if (role !== "officer") return false;
  return !permission || permissions.has(permission);
}

export function requireOfficerPermission(permission, message = "") {
  if (hasOfficerPermission(permission)) return true;
  const definition = permissionDefinition(permission);
  throw new Error(message || `Your assigned USC office does not have permission to ${definition?.label?.toLowerCase() || "perform this action"}.`);
}

function labelFor(permission) {
  return permissionDefinition(permission)?.label || permission.replaceAll(".", " ");
}

// Module links are NEVER blocked now. If a module is not assigned to the
// officer, the link remains navigable and is marked Read-only. Action controls
// inside the destination module are still enforced separately.
function decorateAnchor(anchor) {
  if (!(anchor instanceof HTMLAnchorElement)) return;
  const permission = permissionForOfficerHref(anchor.getAttribute("href") || "");
  if (!permission || hasOfficerPermission(permission)) return;

  anchor.classList.add("rbac-readonly-link");
  if (!anchor.hasAttribute("data-rbac-permission")) {
    anchor.dataset.rbacPermission = permission;
    anchor.dataset.rbacPermissionDerived = "true";
  }
  anchor.title = `Read-only access: ${labelFor(permission)} is not assigned to your USC office.`;

  if (!anchor.querySelector(":scope > .rbac-readonly-icon")) {
    const marker = document.createElement("i");
    marker.className = "fa-regular fa-eye rbac-readonly-icon";
    marker.setAttribute("aria-hidden", "true");
    anchor.append(marker);
  }
}

function applyExplicitPermissionElement(element) {
  const permission = String(element.dataset.rbacPermission || "").trim();
  if (!permission || hasOfficerPermission(permission)) return;

  // Module navigation anchors stay usable in read-only mode. Explicit action
  // controls are handled below and remain disabled.
  if (element instanceof HTMLAnchorElement) {
    decorateAnchor(element);
    return;
  }

  const mode = String(element.dataset.rbacMode || "disable").toLowerCase();
  if (mode === "hide") {
    element.hidden = true;
    return;
  }

  const isDirectControl = "disabled" in element;
  element.classList.add(isDirectControl ? "rbac-control-locked" : "rbac-scope-locked");
  element.setAttribute("aria-disabled", "true");
  element.title = `Read-only: ${labelFor(permission)} permission is required to make changes.`;

  if (isDirectControl && element.disabled !== true) {
    element.disabled = true;
    element.dataset.rbacDisabledByScript = "true";
  }

  element.querySelectorAll?.("button, input, select, textarea").forEach((control) => {
    if (control.disabled !== true) {
      control.disabled = true;
      control.dataset.rbacDisabledByScript = "true";
    }
    control.title = `Read-only: ${labelFor(permission)} permission is required to make changes.`;
  });

  if (!isDirectControl && !element.querySelector(":scope > .rbac-readonly-note")) {
    const note = document.createElement("div");
    note.className = "rbac-readonly-note";
    note.innerHTML = `<i class="fa-regular fa-eye" aria-hidden="true"></i><span><strong>Read-only</strong><small>You can view this information, but ${labelFor(permission)} permission is required to make changes.</small></span>`;
    element.prepend(note);
  }
}

// Read-only modules are indicated by compact navigation/action states only.
// The former full module banner was removed to keep module layouts clean.
function decorate(root = document) {
  root.querySelectorAll?.("a[href]").forEach(decorateAnchor);
  root.querySelectorAll?.("[data-rbac-permission]").forEach(applyExplicitPermissionElement);
}

decorate();
revealAuthorizedOfficerUi();

const observer = new MutationObserver((records) => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches?.("a[href]")) decorateAnchor(node);
      if (node.matches?.("[data-rbac-permission]")) applyExplicitPermissionElement(node);
      decorate(node);
    }
  }
});
observer.observe(document.documentElement, { childList: true, subtree: true });

document.addEventListener("click", (event) => {
  // Scope-level and direct action controls remain blocked. Navigation links are
  // intentionally not intercepted: unassigned modules open in read-only mode.
  const lockedControl = event.target.closest?.(".rbac-control-locked[data-rbac-permission]");
  if (lockedControl) {
    const permission = lockedControl.dataset.rbacPermission;
    if (permission && !hasOfficerPermission(permission)) {
      event.preventDefault();
      event.stopPropagation();
      alert(`Read-only access. Your assigned USC office cannot perform ${labelFor(permission)} actions.`);
      return;
    }
  }

  const lockedScope = event.target.closest?.(".rbac-scope-locked[data-rbac-permission]");
  if (lockedScope && event.target.closest?.("button, input, select, textarea")) {
    const permission = lockedScope.dataset.rbacPermission;
    if (permission && !hasOfficerPermission(permission)) {
      event.preventDefault();
      event.stopPropagation();
      alert(`Read-only access. Your assigned USC office cannot perform ${labelFor(permission)} actions.`);
    }
  }
}, true);

window.addEventListener("usc-officer-profile-updated", (event) => {
  document.documentElement.classList.add("usc-officer-access-pending");
  document.documentElement.classList.remove("usc-officer-access-ready");
  refreshAccess(event.detail || sessionProfile());
  clearDecoratedAccessState();
  decorate();
  revealAuthorizedOfficerUi();
});

export function currentOfficerPermissions() { return role === "admin" ? [] : [...permissions]; }
