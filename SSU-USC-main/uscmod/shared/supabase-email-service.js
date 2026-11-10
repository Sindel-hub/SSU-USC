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
  if (!response.ok || data?.ok === false) {
    const error = new Error(data?.message || `Supabase email service failed (${response.status}).`);
    if (typeof data?.code === "string") error.code = data.code;
    if (["candidate_email_status", "candidate_submit", "candidate_review", "candidate_notification_retry"].includes(action)
        && response.status === 400 && data?.message === "Unknown email-service action.") {
      error.code = "candidate-service-unavailable";
      error.message = "Candidate registration is temporarily unavailable because the email service needs an update. Your form is still open. Please try again after the administrator updates the service.";
    }
    if (action === "authenticate_gmail" && response.status === 401) error.code = "auth/invalid-credential";
    throw error;
  }
  return data;
}

export function openSupabaseRecoveryPage() {
  const recoveryUrl = new URL("../email/recover-password.html", import.meta.url);
  window.open(recoveryUrl.href, "_blank", "noopener,noreferrer");
}

export async function authenticateVerifiedGmailLogin(email, password) {
  const result = await callStudentEmailService("authenticate_gmail", { email, password }, { requireSession: false });
  if (result.protocol !== "gmail-password-v1" || !["verified-gmail", "firebase-native"].includes(result.loginMethod) || typeof result.uid !== "string" || !result.uid || typeof result.authEmail !== "string" || !result.authEmail) {
    throw new Error("The Gmail login could not be verified. Use your Student ID instead.");
  }
  return { uid: result.uid, authEmail: result.authEmail, loginMethod: result.loginMethod };
}
