export const OFFICER_PERMISSION_DEFINITIONS = Object.freeze([
  { key: "dashboard.view", group: "Dashboard", label: "View Officer Dashboard", description: "Open the officer dashboard and see aggregate USC summaries." },
  { key: "elections.view", group: "Elections", label: "Assigned Election Module", description: "Marks Elections as an assigned office module. All officers may still open it read-only; assigned officers can use granted election functions." },
  { key: "elections.roster", group: "Elections", label: "Manage Voter Roster", description: "Import, validate, and finalize the voter masterlist." },
  { key: "elections.review", group: "Elections", label: "Review Candidates", description: "Approve or reject candidate applications." },
  { key: "elections.results", group: "Elections", label: "Finalize / Publish Results", description: "Finalize canvassing, publish results, and archive elections." },
  { key: "complaints.view", group: "Complaints", label: "Assigned Complaint Module", description: "Marks Complaints as an assigned office module. All officers may still open it read-only; assigned officers can use granted complaint functions." },
  { key: "complaints.review", group: "Complaints", label: "Review Complaints", description: "Perform the USC review workflow for a complaint." },
  { key: "complaints.classify", group: "Complaints", label: "Classify Complaints", description: "Assign Student, Administrative, or Crisis classification." },
  { key: "complaints.feedback", group: "Complaints", label: "Provide USC Feedback", description: "Send one-way USC feedback to the student." },
  { key: "complaints.status", group: "Complaints", label: "Update Complaint Status", description: "Move a complaint through Under Review, In Progress, Resolved, or Closed." },
  { key: "complaints.report", group: "Complaints", label: "Generate Complaint Reports", description: "Generate or export complaint reports when reporting tools are available." },
  { key: "bulletin.manage", group: "Bulletin Board", label: "Manage Bulletin Board", description: "Create, edit, or delete announcements. Officers without this permission may still open the Bulletin Board Center in read-only mode." },
  { key: "events.manage", group: "Events", label: "Manage Events", description: "Create, edit, or delete USC events. Officers without this permission may still open the Events module in read-only mode." },
  { key: "programs.manage", group: "Programs", label: "Manage External Programs", description: "Create, edit, or delete outside-university programs and opportunities. Officers without this permission may still open the Programs module in read-only mode." },
  { key: "organization.view", group: "Organization", label: "View Organizational Chart", description: "Open the USC Organizational Chart module." },
  { key: "reports.generate", group: "Reports", label: "Generate Officer Reports", description: "Use officer-level report generation features when available." }
]);

export const ALL_OFFICER_PERMISSIONS = Object.freeze(OFFICER_PERMISSION_DEFINITIONS.map((item) => item.key));

// Unknown/new officer positions start from a conservative baseline until the
// System Administrator explicitly assigns their responsibilities.
export const DEFAULT_OFFICER_PERMISSIONS = Object.freeze([
  "dashboard.view",
  "organization.view"
]);

// Recommended position presets based on the documented USC officer scope.
// These are defaults, not hard-coded limits: the System Administrator can
// override any individual officer by saving a custom permission set.
export const OFFICER_POSITION_PERMISSION_PRESETS = Object.freeze({
  // Primary module ownership defaults:
  // - President manages Complaints; Elections remain read-only unless explicitly granted.
  // - Vice President manages Elections; Complaints remain read-only unless explicitly granted.
  "President": Object.freeze([
    "dashboard.view",
    "complaints.view",
    "complaints.review",
    "complaints.classify",
    "complaints.feedback",
    "complaints.status",
    "complaints.report",
    "bulletin.manage",
    "events.manage",
    "programs.manage",
    "organization.view",
    "reports.generate"
  ]),
  "Vice President": Object.freeze([
    "dashboard.view",
    "elections.view",
    "elections.roster",
    "elections.review",
    "elections.results",
    "bulletin.manage",
    "events.manage",
    "organization.view",
    "reports.generate"
  ]),
  "Secretary": Object.freeze([
    "dashboard.view",
    "bulletin.manage",
    "events.manage",
    "programs.manage",
    "organization.view",
    "reports.generate"
  ]),
  "Treasurer": Object.freeze([
    "dashboard.view",
    "organization.view",
    "reports.generate"
  ]),
  "Auditor": Object.freeze([
    "dashboard.view",
    "organization.view",
    "reports.generate"
  ]),
  "Public Relations Officer (PRO)": Object.freeze([
    "dashboard.view",
    "bulletin.manage",
    "events.manage",
    "programs.manage",
    "organization.view"
  ]),
  "Business Manager": Object.freeze([
    "dashboard.view",
    "events.manage",
    "programs.manage",
    "organization.view",
    "reports.generate"
  ]),
  "Sgt. at Arms": Object.freeze([
    "dashboard.view",
    "events.manage",
    "organization.view"
  ]),
  "Department Representative": Object.freeze([
    "dashboard.view",
    "complaints.view",
    "complaints.review",
    "organization.view"
  ])
});

export const OFFICER_MODULE_PERMISSION_BY_PATH = Object.freeze({
  "/usc-admin/announcements/": "bulletin.manage",
  "/usc-admin/elections/": "elections.view",
  "/usc-admin/events/": "events.manage",
  "/usc-admin/programs/": "programs.manage",
  "/usc-admin/organizational-chart/": "organization.view",
  "/usc-admin/complaints/": "complaints.view",
  "/usc-admin/overview/": "dashboard.view"
});

export const OFFICER_MODULE_PERMISSION_BY_HREF = Object.freeze({
  "announcements/announcements.html": "bulletin.manage",
  "elections/elections.html": "elections.view",
  "events/events.html": "events.manage",
  "programs/programs.html": "programs.manage",
  "organizational-chart/organizational-chart.html": "organization.view",
  "complaints/complaints.html": "complaints.view",
  "overview/overview.html": "dashboard.view"
});

const KNOWN = new Set(ALL_OFFICER_PERMISSIONS);
const DEFAULT_SET = new Set(DEFAULT_OFFICER_PERMISSIONS);

function normalizedPositionKey(value = "") {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

const POSITION_PRESET_BY_NORMALIZED_NAME = new Map(
  Object.entries(OFFICER_POSITION_PERMISSION_PRESETS).map(([position, permissions]) => [normalizedPositionKey(position), permissions])
);

export function normalizeOfficerPermissions(value, { legacyFullAccess = true } = {}) {
  if (!Array.isArray(value)) return legacyFullAccess ? [...ALL_OFFICER_PERMISSIONS] : [...DEFAULT_OFFICER_PERMISSIONS];
  const output = [...new Set(value.map((item) => String(item || "").trim()).filter((item) => KNOWN.has(item)))];
  if (!output.includes("dashboard.view")) output.unshift("dashboard.view");
  return output;
}

export function permissionsForOfficerPosition(position = "") {
  const preset = POSITION_PRESET_BY_NORMALIZED_NAME.get(normalizedPositionKey(position));
  return preset ? [...preset] : [...DEFAULT_OFFICER_PERMISSIONS];
}

export function hasKnownOfficerPositionPreset(position = "") {
  return POSITION_PRESET_BY_NORMALIZED_NAME.has(normalizedPositionKey(position));
}

export function isBaselineOfficerPermissionList(value) {
  if (!Array.isArray(value)) return false;
  const normalized = normalizeOfficerPermissions(value, { legacyFullAccess: false });
  return normalized.length === DEFAULT_SET.size && normalized.every((item) => DEFAULT_SET.has(item));
}

export function effectiveOfficerPermissions(profile = {}, { legacyFullAccess = true } = {}) {
  const role = String(profile.role || "").trim().toLowerCase();
  if (role === "admin") return [...ALL_OFFICER_PERMISSIONS];
  if (role !== "officer") return [];

  const stored = Array.isArray(profile.officerPermissions)
    ? normalizeOfficerPermissions(profile.officerPermissions, { legacyFullAccess: false })
    : null;
  const source = String(profile.officerPermissionSource || "").trim().toLowerCase();
  const knownPosition = hasKnownOfficerPositionPreset(profile.officePosition);

  // Explicit admin customization always wins over a position preset.
  if (source === "custom" && stored) return stored;

  // Position-default accounts use the position matrix. This also repairs
  // officers created by the first RBAC revision, which stored only the safe
  // dashboard/organization baseline and had no permission-source marker.
  if (knownPosition && (source === "position-default" || !stored || isBaselineOfficerPermissionList(stored))) {
    return permissionsForOfficerPosition(profile.officePosition);
  }

  if (stored) return stored;
  if (knownPosition) return permissionsForOfficerPosition(profile.officePosition);
  return normalizeOfficerPermissions(undefined, { legacyFullAccess });
}

export function officerHasPermission(profile = {}, permission = "") {
  const role = String(profile.role || "").trim().toLowerCase();
  if (role === "admin") return true;
  if (role !== "officer") return false;
  if (!permission) return true;
  return effectiveOfficerPermissions(profile, { legacyFullAccess: true }).includes(permission);
}

export function permissionForOfficerPath(pathname = "") {
  const path = String(pathname || "").toLowerCase();
  for (const [needle, permission] of Object.entries(OFFICER_MODULE_PERMISSION_BY_PATH)) {
    if (path.includes(needle)) return permission;
  }
  return "";
}

export function permissionForOfficerHref(href = "") {
  const clean = String(href || "").split("#")[0].split("?")[0].replaceAll("\\", "/").toLowerCase();
  for (const [needle, permission] of Object.entries(OFFICER_MODULE_PERMISSION_BY_HREF)) {
    if (clean.endsWith(needle)) return permission;
  }
  return "";
}

export function permissionDefinition(key) {
  return OFFICER_PERMISSION_DEFINITIONS.find((item) => item.key === key) || null;
}
