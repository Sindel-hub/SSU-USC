export const GMAIL_RETURN_EMAIL = "uscVerifiedGmailReturnEmail";
export const GMAIL_RETURN_UID = "uscVerifiedGmailReturnUid";
const SESSION_KEYS = ["activeSession", "studentProfile", "sessionExpiresAt", "lastActivityAt"];

function canonicalGmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9.]+(?:\+[a-z0-9._-]+)?@gmail\.com$/.test(email)) return "";
  return email.split("@")[0].split("+")[0].replaceAll(".", "") + "@gmail.com";
}
export function rememberGmailReturn(email, storage) {
  const canonical = canonicalGmail(email);
  if (!canonical) throw new Error("The verified Gmail could not be identified. Sign in from the portal.");
  storage.setItem(GMAIL_RETURN_EMAIL, canonical);
  storage.removeItem(GMAIL_RETURN_UID);
  return canonical;
}
export async function checkGmailReturnAccount(auth, loadSettings, email) {
  const uid = auth.currentUser?.uid;
  if (!uid || !canonicalGmail(email)) return null;
  const result = await loadSettings();
  const settings = result?.settings;
  if (auth.currentUser?.uid !== uid) throw new Error("The signed-in account changed. Please try returning again.");
  if (!settings?.active || canonicalGmail(settings.verifiedEmail) !== canonicalGmail(email)
      || !["student", "officer"].includes(settings.accountRole)) return null;
  return {uid, path:settings.accountRole === "officer" ? "../usc-admin/overview/overview.html" : "../dashboard/dashboard.html"};
}
export async function returnToLinkedGmailAccount({auth, loadSettings, signOut, storage, email}) {
  await auth.authStateReady();
  const canonical = rememberGmailReturn(email, storage);
  const linked = await checkGmailReturnAccount(auth, loadSettings, canonical);
  if (linked) {
    storage.setItem(GMAIL_RETURN_UID, linked.uid);
    return linked.path;
  }
  if (auth.currentUser) await signOut(auth);
  SESSION_KEYS.forEach(key => storage.removeItem(key));
  return "../index/index.html";
}
