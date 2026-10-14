import {
  CORS_HEADERS,
  activeEmailProfile,
  adminClient,
  canonicalGmail,
  env,
  errorText,
  escapeHtml,
  firebaseUserByUid,
  firestoreGet,
  generateFirebaseResetLink,
  jsonBody,
  jsonResponse,
  logDelivery,
  randomToken,
  sendEmail,
  sha256,
  verifyFirebaseIdToken,
} from "../_shared/usc-email-common.ts";

const supabase = adminClient();
const PROFILE_SCOPE_LABEL = "Student or Officer Profile";

function roleName(profile: Record<string, any> | null): string {
  return String(profile?.role || "").toLowerCase() === "officer" ? "officer" : "student";
}

function profileLabel(profile: Record<string, any> | null): string {
  return roleName(profile) === "officer" ? "Officer Profile" : "Student Profile";
}

function portalPage(profile: Record<string, any> | null): string {
  return roleName(profile) === "officer" ? "/usc-admin/overview/overview.html" : "/dashboard/dashboard.html";
}

async function signedInPortalAccount(req: Request) {
  const token = String(req.headers.get("x-firebase-token") || "").trim();
  const user = await verifyFirebaseIdToken(token);
  const profile = await firestoreGet(`users/${user.uid}`);
  if (!activeEmailProfile(profile)) throw new Error("This email feature is available only to approved active student and officer accounts.");
  return { user, profile };
}

async function currentSettings(uid: string) {
  const { data, error } = await supabase.from("student_email_accounts").select("*").eq("firebase_uid", uid).maybeSingle();
  if (error) throw error;
  const row = data || null;
  return {
    requestedEmail: row?.requested_email || "",
    verifiedEmail: row?.verified_email || "",
    active: Boolean(row?.requested_email && row?.verified_email && row.requested_email === row.verified_email),
    accountRole: row?.account_role || "student",
    complaints: row?.complaints !== false,
    elections: row?.elections !== false,
    news: row?.news !== false,
    recovery: row?.recovery !== false,
    verificationSentAt: row?.verification_sent_at || null,
    verifiedAt: row?.verified_at || null,
  };
}

async function saveSettings(req: Request, body: Record<string, unknown>) {
  const { user, profile } = await signedInPortalAccount(req);
  const email = canonicalGmail(body.email);
  if (!email) return jsonResponse({ ok: false, message: "Enter a valid @gmail.com address." }, 400);
  const accountRole = roleName(profile);

  const existingResult = await supabase.from("student_email_accounts").select("*").eq("firebase_uid", user.uid).maybeSingle();
  if (existingResult.error) throw existingResult.error;
  const existing = existingResult.data || null;
  const preferences = {
    account_role: accountRole,
    complaints: body.complaints !== false,
    elections: body.elections !== false,
    news: body.news !== false,
    recovery: body.recovery !== false,
  };

  if (existing?.requested_email === email && existing?.verified_email === email) {
    const { error } = await supabase.from("student_email_accounts").upsert({
      firebase_uid: user.uid,
      requested_email: email,
      verified_email: email,
      ...preferences,
      updated_at: new Date().toISOString(),
    }, { onConflict: "firebase_uid" });
    if (error) throw error;
    return jsonResponse({ ok: true, message: "Gmail preferences saved.", settings: await currentSettings(user.uid) });
  }

  const today = new Date().toISOString().slice(0, 10);
  const sentToday = existing?.verification_day === today ? Number(existing?.verification_count || 0) : 0;
  // Capstone development mode: do not block verification attempts with the daily email quota.
  // Production deployments should add provider-side rate limiting and abuse protection.

  const token = randomToken();
  const tokenHash = await sha256(token);
  const now = new Date();
  const expires = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const { error: saveError } = await supabase.from("student_email_accounts").upsert({
    firebase_uid: user.uid,
    requested_email: email,
    verified_email: existing?.requested_email === email ? existing?.verified_email || null : null,
    verified_at: existing?.requested_email === email ? existing?.verified_at || null : null,
    ...preferences,
    verification_token_hash: tokenHash,
    verification_expires_at: expires.toISOString(),
    verification_sent_at: now.toISOString(),
    verification_day: today,
    verification_count: sentToday + 1,
    updated_at: now.toISOString(),
  }, { onConflict: "firebase_uid" });
  if (saveError) throw saveError;

  const verifyUrl = `${env().portalUrl}/email/verify-gmail.html?token=${encodeURIComponent(token)}`;
  const accountLabel = accountRole === "officer" ? "officer" : "student";
  const text = `A signed-in SSU USC ${accountLabel} requested to use this Gmail from their ${PROFILE_SCOPE_LABEL} for portal notifications and optional password recovery.\n\nConfirm the Gmail here:\n${verifyUrl}\n\nThe link expires in 24 hours. If you did not request this, ignore the email.`;
  const html = `<p>A signed-in SSU USC <strong>${escapeHtml(accountLabel)}</strong> requested to use this Gmail from their ${escapeHtml(PROFILE_SCOPE_LABEL)} for portal notifications and optional password recovery.</p><p><a href="${escapeHtml(verifyUrl)}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#2457a7;color:white;text-decoration:none;font-weight:700">Review &amp; confirm my Gmail</a></p><p>This link expires in 24 hours. If you did not request this, ignore the email.</p>`;
  try {
    const providerId = await sendEmail(email, "Verify your Gmail for SSU USC", html, text);
    await logDelivery({ uid: user.uid, recipient: email, kind: "verification", status: "sent", providerId });
  } catch (error) {
    await logDelivery({ uid: user.uid, recipient: email, kind: "verification", status: "failed", error: errorText(error) });
    throw error;
  }
  return jsonResponse({ ok: true, message: "Gmail saved. Check your inbox for the confirmation link. No administrator approval is required.", settings: await currentSettings(user.uid) });
}

async function removeSettings(req: Request) {
  const { user, profile } = await signedInPortalAccount(req);
  const { error } = await supabase.from("student_email_accounts").upsert({
    firebase_uid: user.uid,
    account_role: roleName(profile),
    requested_email: null,
    verified_email: null,
    complaints: false,
    elections: false,
    news: false,
    recovery: false,
    verification_token_hash: null,
    verification_expires_at: null,
    verification_sent_at: null,
    verified_at: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "firebase_uid" });
  if (error) throw error;
  return jsonResponse({ ok: true, message: "Gmail removed. Email notifications and recovery are off.", settings: await currentSettings(user.uid) });
}

async function passwordChanged(req: Request) {
  const { user } = await signedInPortalAccount(req);
  const { data } = await supabase.from("student_email_accounts").select("requested_email,verified_email").eq("firebase_uid", user.uid).maybeSingle();
  if (!data?.verified_email || data.verified_email !== data.requested_email) return jsonResponse({ ok: true, sent: false });
  const time = new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila" });
  const text = `Your SSU USC portal password was changed on ${time}.\n\nIf you made this change, no action is needed. If you did not, contact the system administrator immediately and secure your account.\n\nPortal: ${env().portalUrl}`;
  const html = `<p>Your SSU USC portal password was changed on <strong>${escapeHtml(time)}</strong>.</p><p>If you made this change, no action is needed. If you did not, contact the system administrator immediately and secure your account.</p><p><a href="${escapeHtml(env().portalUrl)}">Open SSU USC Portal</a></p>`;
  const providerId = await sendEmail(data.verified_email, "SSU USC: your portal password was changed", html, text);
  await logDelivery({ uid: user.uid, recipient: data.verified_email, kind: "password_changed", status: "sent", providerId });
  return jsonResponse({ ok: true, sent: true });
}

async function verifyToken(token: string): Promise<Response> {
  if (!/^[a-f0-9]{64}$/.test(token)) {
    return jsonResponse({ ok: false, message: "This verification link is invalid." }, 400);
  }
  const tokenHash = await sha256(token);
  const { data, error } = await supabase.from("student_email_accounts").select("*").eq("verification_token_hash", tokenHash).maybeSingle();
  if (error || !data) {
    return jsonResponse({ ok: false, message: "This verification link has expired or was already used. Save your Gmail again in your portal profile." }, 410);
  }
  if (!data.requested_email || !data.verification_expires_at || new Date(data.verification_expires_at).getTime() < Date.now()) {
    return jsonResponse({ ok: false, message: "This verification link has expired. Save your Gmail again in your portal profile." }, 410);
  }
  const profile = await firestoreGet(`users/${data.firebase_uid}`);
  if (!activeEmailProfile(profile)) {
    return jsonResponse({ ok: false, message: "This account is no longer eligible for email recovery." }, 403);
  }
  const duplicate = await supabase.from("student_email_accounts").select("firebase_uid").eq("verified_email", data.requested_email).neq("firebase_uid", data.firebase_uid).maybeSingle();
  if (duplicate.data) {
    return jsonResponse({ ok: false, message: "This Gmail is already connected to another portal account." }, 409);
  }
  const now = new Date().toISOString();
  const { error: updateError } = await supabase.from("student_email_accounts").update({
    account_role: roleName(profile),
    verified_email: data.requested_email,
    verified_at: now,
    verification_token_hash: null,
    verification_expires_at: null,
    last_scan_at: now,
    updated_at: now,
  }).eq("firebase_uid", data.firebase_uid);
  if (updateError) throw updateError;
  const returnUrl = `${env().portalUrl}${portalPage(profile)}`;
  return jsonResponse({
    ok: true,
    message: "Your Gmail is verified and ready for the notification and recovery options you enabled.",
    email: data.requested_email,
    accountRole: roleName(profile),
    profileLabel: profileLabel(profile),
    returnUrl,
  });
}

async function processRecovery(emailInput: unknown): Promise<void> {
  try {
    const email = canonicalGmail(emailInput);
    if (!email) return;
    const { data } = await supabase.from("student_email_accounts").select("*").eq("requested_email", email).eq("verified_email", email).eq("recovery", true).maybeSingle();
    if (!data) return;
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    if (data.recovery_sent_at && now.getTime() - new Date(data.recovery_sent_at).getTime() < 15 * 60 * 1000) return;
    const sentToday = data.recovery_day === today ? Number(data.recovery_count || 0) : 0;
    if (sentToday >= 3) return;
    const profile = await firestoreGet(`users/${data.firebase_uid}`);
    if (!activeEmailProfile(profile)) return;
    const firebaseUser = await firebaseUserByUid(data.firebase_uid);
    if (!firebaseUser?.email || firebaseUser.disabled) return;
    const resetLink = await generateFirebaseResetLink(firebaseUser.email);
    const text = `A password reset was requested for your SSU USC portal account.\n\nChoose a new password using this secure Firebase link:\n${resetLink}\n\nYour normal school login stays the same. If you did not request this, ignore this email.`;
    const html = `<p>A password reset was requested for your SSU USC portal account.</p><p><a href="${escapeHtml(resetLink)}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#2457a7;color:white;text-decoration:none;font-weight:700">Reset my portal password</a></p><p>Your normal school login stays the same. If you did not request this, ignore this email.</p>`;
    try {
      const providerId = await sendEmail(email, "Reset your SSU USC password", html, text);
      await supabase.from("student_email_accounts").update({ recovery_sent_at: now.toISOString(), recovery_day: today, recovery_count: sentToday + 1, updated_at: now.toISOString() }).eq("firebase_uid", data.firebase_uid);
      await logDelivery({ uid: data.firebase_uid, recipient: email, kind: "password_recovery", status: "sent", providerId });
    } catch (error) {
      await logDelivery({ uid: data.firebase_uid, recipient: email, kind: "password_recovery", status: "failed", error: errorText(error) });
    }
  } catch (error) {
    console.error("Password recovery processing failed", errorText(error));
  }
}

function portalActionUrl(path: string): string {
  return `${env().portalUrl}/${path.replace(/^\/+/, "")}`;
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  const url = new URL(req.url);
  try {
    if (req.method === "GET") {
      const action = url.searchParams.get("action") || "recover";
      if (action === "verify") {
        const token = String(url.searchParams.get("token") || "");
        const destination = new URL(portalActionUrl("email/verify-gmail.html"));
        if (token) destination.searchParams.set("token", token);
        return Response.redirect(destination.toString(), 302);
      }
      return Response.redirect(portalActionUrl("email/recover-password.html"), 302);
    }

    const body = await jsonBody(req);
    const action = String(body.action || "").trim();
    if (action === "verify") return await verifyToken(String(body.token || ""));
    if (action === "recover") {
      await processRecovery(body.gmail);
      return jsonResponse({ ok: true, message: "If this Gmail is connected to an eligible student or officer account and recovery is enabled, a password-reset message has been sent. Check Inbox and Spam." });
    }
    if (action === "get") {
      const { user, profile } = await signedInPortalAccount(req);
      const settings = await currentSettings(user.uid);
      return jsonResponse({ ok: true, settings: { ...settings, accountRole: roleName(profile) } });
    }
    if (action === "save") return await saveSettings(req, body);
    if (action === "remove") return await removeSettings(req);
    if (action === "password_changed") return await passwordChanged(req);
    return jsonResponse({ ok: false, message: "Unknown email-service action." }, 400);
  } catch (error) {
    console.error("usc-email error", error);
    return jsonResponse({ ok: false, message: errorText(error, "The email service could not complete this request.") }, 500);
  }
});
