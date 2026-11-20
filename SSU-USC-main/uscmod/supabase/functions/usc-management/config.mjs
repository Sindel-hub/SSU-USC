// This staging backend must never silently fall back to the existing live project.
const LIVE_FIREBASE_PROJECT = "universitystudentcouncil-856cc";
const LIVE_SUPABASE_REF = "svgfxatigtjdrwzibjbu";
export function validateManagementConfig(values) {
  const missing = [];
  for (const key of [
    "SUPABASE_URL",
    "FIREBASE_PROJECT_ID",
    "FIREBASE_WEB_API_KEY",
    "FIREBASE_SERVICE_ACCOUNT_JSON",
    "PORTAL_URL",
    "MANAGEMENT_RATE_LIMIT_SECRET",
  ]) {
    if (typeof values[key] !== "string" || !values[key].trim())
      missing.push(key);
  }
  if (missing.length)
    throw Error("Missing backend configuration: " + missing.join(", "));
  const supabase = new URL(values.SUPABASE_URL),
    portal = new URL(values.PORTAL_URL);
  if (
    supabase.protocol !== "https:" ||
    !/^([a-z]{20})\.supabase\.co$/.test(supabase.hostname) ||
    supabase.pathname !== "/" ||
    supabase.username ||
    supabase.password
  )
    throw Error("Use the actual staging Supabase project URL.");
  if (
    supabase.hostname.startsWith(LIVE_SUPABASE_REF + ".") ||
    values.FIREBASE_PROJECT_ID === LIVE_FIREBASE_PROJECT
  )
    throw Error(
      "The management staging backend cannot use the existing production projects.",
    );
  if (
    portal.protocol !== "https:" ||
    portal.username ||
    portal.password ||
    portal.search ||
    portal.hash ||
    portal.pathname !== "/"
  )
    throw Error("PORTAL_URL must be the staging site HTTPS origin.");
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(values.FIREBASE_PROJECT_ID))
    throw Error("Invalid staging Firebase project ID.");
  if (values.MANAGEMENT_RATE_LIMIT_SECRET.length < 32)
    throw Error(
      "MANAGEMENT_RATE_LIMIT_SECRET must have at least 32 characters.",
    );
  let account;
  try {
    account = JSON.parse(values.FIREBASE_SERVICE_ACCOUNT_JSON);
  } catch {
    throw Error("FIREBASE_SERVICE_ACCOUNT_JSON must be valid JSON.");
  }
  if (
    account.project_id !== values.FIREBASE_PROJECT_ID ||
    typeof account.client_email !== "string" ||
    !account.client_email.endsWith(".iam.gserviceaccount.com") ||
    typeof account.private_key !== "string" ||
    !account.private_key.includes("BEGIN PRIVATE KEY")
  )
    throw Error(
      "The service account must belong to the configured staging Firebase project.",
    );
  if (
    account.token_uri &&
    account.token_uri !== "https://oauth2.googleapis.com/token"
  )
    throw Error("Unexpected service-account token endpoint.");
  return {
    portalOrigin: portal.origin,
    projectId: values.FIREBASE_PROJECT_ID,
    supabaseOrigin: supabase.origin,
    projectRef: supabase.hostname.split(".")[0],
    rateSecret: values.MANAGEMENT_RATE_LIMIT_SECRET,
  };
}
export function managementEnvironment(read) {
  return Object.fromEntries(
    [
      "SUPABASE_URL",
      "FIREBASE_PROJECT_ID",
      "FIREBASE_WEB_API_KEY",
      "FIREBASE_SERVICE_ACCOUNT_JSON",
      "PORTAL_URL",
      "MANAGEMENT_RATE_LIMIT_SECRET",
    ].map((key) => [key, read(key) || ""]),
  );
}

// Call only AFTER Google validates this exact ID token. Decoding alone is not authentication.
export function assertVerifiedTokenProject(token, projectId) {
  let claims;
  try {
    claims = JSON.parse(
      atob(token.split(".")[1].replaceAll("-", "+").replaceAll("_", "/")),
    );
  } catch {
    throw Error("Invalid verified token claims.");
  }
  if (
    claims.aud !== projectId ||
    claims.iss !== `https://securetoken.google.com/${projectId}`
  )
    throw Error("Use an account from the configured staging Firebase project.");
}
