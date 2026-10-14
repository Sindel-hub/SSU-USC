import { auth } from "../firebase/firebase-config.js";

const DEFAULT_FUNCTION_URL = "https://svgfxatigtjdrwzibjbu.supabase.co/functions/v1/usc-email";

export function getSupabaseEmailFunctionUrl() {
  const override = String(globalThis.USC_SUPABASE_EMAIL_FUNCTION_URL || "").trim();
  return /^https:\/\/[^\s]+\/functions\/v1\/usc-email$/.test(override) ? override : DEFAULT_FUNCTION_URL;
}

export function isSupabaseEmailConfigured() {
  return /^https:\/\/[^\s]+\/functions\/v1\/usc-email$/.test(getSupabaseEmailFunctionUrl());
}

export async function callStudentEmailService(action, payload = {}, { requireSession = true } = {}) {
  const url = getSupabaseEmailFunctionUrl();
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (requireSession) {
    const user = auth.currentUser;
    if (!user) throw new Error("Your session is no longer active. Sign in again.");
    headers["x-firebase-token"] = await user.getIdToken(true);
  }
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ action, ...payload }),
    credentials: "omit",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) throw new Error(data?.message || `Supabase email service failed (${response.status}).`);
  return data;
}

export function openSupabaseRecoveryPage() {
  const recoveryUrl = new URL("../email/recover-password.html", import.meta.url);
  window.open(recoveryUrl.href, "_blank", "noopener,noreferrer");
}
