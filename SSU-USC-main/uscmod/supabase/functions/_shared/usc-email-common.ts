import { createClient } from "npm:@supabase/supabase-js@2.55.0";


export function errorText(error: unknown, fallback = "Unexpected error"): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error.trim();
  return fallback;
}

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-firebase-token, x-worker-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function required(name: string): string {
  const value = String(Deno.env.get(name) || "").trim();
  if (!value) throw new Error(`Missing Edge Function secret: ${name}`);
  return value;
}

export function env() {
  return {
    supabaseUrl: required("SUPABASE_URL"),
    firebaseProjectId: required("FIREBASE_PROJECT_ID"),
    firebaseWebApiKey: required("FIREBASE_WEB_API_KEY"),
    portalUrl: required("PORTAL_URL").replace(/\/$/, ""),
    resendApiKey: required("RESEND_API_KEY"),
    emailFrom: required("EMAIL_FROM"),
  };
}

function secretKey(): string {
  const modern = String(Deno.env.get("SUPABASE_SECRET_KEYS") || "").trim();
  if (modern) {
    try {
      const parsed = JSON.parse(modern);
      if (parsed?.default) return String(parsed.default);
      const first = Object.values(parsed || {}).find(Boolean);
      if (first) return String(first);
    } catch (_) {}
  }
  return required("SUPABASE_SERVICE_ROLE_KEY");
}

export function adminClient() {
  return createClient(env().supabaseUrl, secretKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export function canonicalGmail(value: unknown): string {
  const email = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9.]+(?:\+[a-z0-9._-]+)?@gmail\.com$/.test(email)) return "";
  return `${email.split("@")[0].split("+")[0].replaceAll(".", "")}@gmail.com`;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char] || char));
}

export function page(title: string, body: string): Response {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escapeHtml(title)}</title><style>
  :root{font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#173552;background:#edf4fb}*{box-sizing:border-box}body{margin:0;min-height:100vh;padding:24px;background:linear-gradient(135deg,#eaf3fb,#f8fbfe)}main{max-width:560px;margin:7vh auto;background:#fff;padding:32px;border-radius:22px;border:1px solid #d8e7f2;box-shadow:0 18px 45px rgba(31,73,112,.10)}h1{margin:0 0 14px;color:#174f98;font-size:30px}p{line-height:1.65;color:#526d86}label{display:block;margin-top:18px;font-weight:800;color:#294f6f}input,button{width:100%;min-height:48px;margin-top:9px;border-radius:12px;font:inherit}input{border:1px solid #bdd0df;padding:0 14px;color:#173552;background:#fff}button{border:0;padding:0 16px;background:linear-gradient(135deg,#27b8e7,#2457a7);color:#fff;font-weight:900;cursor:pointer}button:hover{filter:brightness(.98)}.note{padding:12px 14px;border-radius:12px;background:#eef8fd;color:#41677f;font-size:14px}.success{background:#effaf4;color:#2f7752}.danger{background:#fff3f4;color:#a34f5c}a{color:#176da7;font-weight:800}</style></head><body><main><h1>${escapeHtml(title)}</h1>${body}</main></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export async function jsonBody(req: Request): Promise<Record<string, unknown>> {
  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return await req.json().catch(() => ({}));
  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    return Object.fromEntries([...form.entries()].map(([k, v]) => [k, typeof v === "string" ? v : ""]));
  }
  return {};
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sendEmail(to: string, subject: string, html: string, text: string): Promise<string> {
  const cfg = env();
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.resendApiKey}` },
    body: JSON.stringify({ from: cfg.emailFrom, to: [to], subject, html, text }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Email provider rejected the message (${response.status}): ${payload?.message || payload?.error || "Unknown error"}`);
  return String(payload?.id || "");
}

export async function verifyFirebaseIdToken(idToken: string): Promise<{ uid: string; email: string; disabled: boolean; role: string; authTime: number }> {
  if (!idToken || idToken.length < 100 || idToken.length > 10000) throw new Error("Your Firebase session is missing or expired. Sign in again.");
  const cfg = env();
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(cfg.firebaseWebApiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  const payload = await response.json().catch(() => ({}));
  const user = payload?.users?.[0];
  if (!response.ok || !user?.localId || user.disabled) throw new Error("Your Firebase session is no longer valid. Sign in again.");
  const encoded = idToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  const claims = JSON.parse(atob(encoded)); // Decode only AFTER Google validates this exact token.
  return { uid: String(user.localId), email: String(user.email || ""), disabled: Boolean(user.disabled), role: String(claims.role || ""), authTime: Number(claims.auth_time || 0) };
}

type ServiceAccount = { client_email: string; private_key: string; token_uri?: string; project_id?: string };
let cachedGoogleToken = "";
let cachedGoogleTokenUntil = 0;

function serviceAccount(): ServiceAccount {
  const raw = required("FIREBASE_SERVICE_ACCOUNT_JSON");
  const parsed = JSON.parse(raw);
  if (!parsed?.client_email || !parsed?.private_key) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is invalid.");
  return parsed;
}

function b64url(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const clean = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, "");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function googleAccessToken(): Promise<string> {
  if (cachedGoogleToken && Date.now() < cachedGoogleTokenUntil - 60_000) return cachedGoogleToken;
  const sa = serviceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/datastore",
    aud: sa.token_uri || "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const signingInput = `${header}.${claims}`;
  const key = await crypto.subtle.importKey("pkcs8", pemToPkcs8(sa.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, key, new TextEncoder().encode(signingInput));
  const assertion = `${signingInput}.${b64url(new Uint8Array(signature))}`;
  const tokenResponse = await fetch(sa.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const payload = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !payload?.access_token) throw new Error(`Unable to authorize the Supabase email service with Firebase (${tokenResponse.status}).`);
  cachedGoogleToken = String(payload.access_token);
  cachedGoogleTokenUntil = Date.now() + Number(payload.expires_in || 3600) * 1000;
  return cachedGoogleToken;
}

async function googleJson(url: string, init: RequestInit = {}): Promise<any> {
  const token = await googleAccessToken();
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (response.status === 404) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Google API request failed (${response.status}): ${payload?.error?.message || "Check Firebase IAM/API access."}`);
  return payload;
}

function decodeFirestoreValue(value: any): any {
  if (!value || typeof value !== "object") return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return Boolean(value.booleanValue);
  if ("integerValue" in value) return Number(value.integerValue || 0);
  if ("doubleValue" in value) return Number(value.doubleValue || 0);
  if ("timestampValue" in value) return value.timestampValue;
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) return (value.arrayValue?.values || []).map(decodeFirestoreValue);
  if ("mapValue" in value) return decodeFirestoreFields(value.mapValue?.fields || {});
  return null;
}

function decodeFirestoreFields(fields: Record<string, any>): Record<string, any> {
  const output: Record<string, any> = {};
  for (const [key, value] of Object.entries(fields || {})) output[key] = decodeFirestoreValue(value);
  return output;
}

function decodeFirestoreDocument(document: any): Record<string, any> | null {
  if (!document) return null;
  return { ...decodeFirestoreFields(document.fields || {}), _id: String(document.name || "").split("/").pop() || "" };
}

export async function firestoreGet(path: string): Promise<Record<string, any> | null> {
  const cfg = env();
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  const payload = await googleJson(`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(cfg.firebaseProjectId)}/databases/(default)/documents/${encoded}`);
  return decodeFirestoreDocument(payload);
}

export async function firestoreCollection(collectionId: string, limit = 500): Promise<Record<string, any>[]> {
  const cfg = env();
  const payload = await googleJson(`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(cfg.firebaseProjectId)}/databases/(default)/documents:runQuery`, {
    method: "POST",
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId }], limit } }),
  });
  return (Array.isArray(payload) ? payload : []).filter((row) => row?.document).map((row) => decodeFirestoreDocument(row.document)).filter(Boolean) as Record<string, any>[];
}

export function activeEmailProfile(profile: Record<string, any> | null): boolean {
  if (!profile) return false;
  const role = String(profile.role || "").toLowerCase();
  if (!["student", "officer"].includes(role)) return false;
  if (profile.schoolProvisioned !== true || String(profile.accountStatus || "").toLowerCase() !== "approved" || profile.isActive === false) return false;

  // Officers are governed by their officer account approval/active state.
  // They do not always carry studentStanding/enrollmentStatus fields, so
  // requiring those student-only fields incorrectly blocks Gmail settings.
  if (role === "officer") return true;

  const standing = String(profile.studentStanding || "").toLowerCase();
  if (standing) return standing === "active";
  return ["enrolled", "active", "currently enrolled", "graduating"].includes(String(profile.enrollmentStatus || "").toLowerCase());
}

// Backward-compatible helper retained for older callers/tests.
export function activeStudentProfile(profile: Record<string, any> | null): boolean {
  return String(profile?.role || "").toLowerCase() === "student" && activeEmailProfile(profile);
}

export async function firebaseUserByUid(uid: string): Promise<{ uid: string; email: string; disabled: boolean; emailVerified: boolean } | null> {
  const cfg = env();
  const payload = await googleJson(`https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(cfg.firebaseProjectId)}/accounts:lookup`, {
    method: "POST",
    body: JSON.stringify({ localId: [uid] }),
  });
  const user = payload?.users?.[0];
  if (!user?.localId) return null;
  return { uid: String(user.localId), email: String(user.email || ""), disabled: Boolean(user.disabled), emailVerified: user.emailVerified === true };
}

export async function generateFirebaseResetLink(authEmail: string): Promise<string> {
  const cfg = env();
  const payload = await googleJson(`https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(cfg.firebaseProjectId)}/accounts:sendOobCode`, {
    method: "POST",
    body: JSON.stringify({ requestType: "PASSWORD_RESET", email: authEmail, returnOobLink: true }),
  });
  const link = String(payload?.oobLink || "");
  if (!/^https:\/\//.test(link)) throw new Error("Firebase did not return a password reset link.");
  return link;
}

export function ms(value: unknown): number {
  if (!value) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = new Date(String(value)).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function logDelivery(args: { uid?: string; recipient: string; kind: string; sourceKey?: string; status: string; providerId?: string; error?: string }) {
  const supabase = adminClient();
  try {
    await supabase.from("email_delivery_log").insert({
      firebase_uid: args.uid || null,
      recipient: args.recipient,
      kind: args.kind,
      source_key: args.sourceKey || null,
      status: args.status,
      provider_id: args.providerId || null,
      error_message: args.error ? String(args.error).slice(0, 500) : null,
    });
  } catch (_) {}
}

// Versioned Firestore reads and masked atomic writes for trusted identity updates.
// Never expose these IAM-authorized helpers or service-account credentials to browsers.
export async function firestoreVersionedGet(path: string) {
  const name = `projects/${env().firebaseProjectId}/databases/(default)/documents/${path}`;
  const raw = await googleJson(`https://firestore.googleapis.com/v1/${name}`);
  return raw ? { data: decodeFirestoreFields(raw.fields || {}), version: raw.updateTime } : null;
}
function encodeIdentityValue(value: unknown): any {
  if (value === null) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number" && Number.isSafeInteger(value)) return { integerValue: String(value) };
  if (typeof value === "string") return { stringValue: value };
  throw new Error("Unsupported identity record field.");
}
export async function firestoreIdentityCommit(operations: any[]) {
  const database = `projects/${env().firebaseProjectId}/databases/(default)`;
  const writes = operations.map(operation => {
    const name = `${database}/documents/${operation.path}`;
    const currentDocument = operation.version ? { updateTime: operation.version } : { exists: false };
    if (operation.remove) return { delete: name, currentDocument };
    return {
      update: { name, fields: Object.fromEntries(Object.entries(operation.data).map(([key, value]) => [key, encodeIdentityValue(value)])) },
      updateMask: { fieldPaths: Object.keys(operation.data) }, currentDocument
    };
  });
  await googleJson(`https://firestore.googleapis.com/v1/${database}/documents:commit`, { method: "POST", body: JSON.stringify({ writes }) });
}
export async function firebaseUserByEmail(email: string) {
  const payload = await googleJson(`https://identitytoolkit.googleapis.com/v1/projects/${env().firebaseProjectId}/accounts:lookup`, {
    method: "POST", body: JSON.stringify({ email: [email] })
  });
  const user = payload?.users?.[0];
  return user?.localId ? { uid: String(user.localId), email: String(user.email || "") } : null;
}
export async function resetFirebaseAuthPassword(uid: string, password: string, timestamp: number) {
  await googleJson(`https://identitytoolkit.googleapis.com/v1/projects/${env().firebaseProjectId}/accounts:update`, {
    method: "POST", body: JSON.stringify({ localId: uid, password, validSince: String(Math.floor(timestamp / 1000)) })
  });
}
