// Wire the existing shell controls on the two authenticated module pages.
// The shared auth guard remains the only page-access authority.
import { auth } from "../firebase/firebase-config.js";
import { signOut } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
const allowed = await (globalThis.USC_AUTH_READY || Promise.resolve(false));
if (allowed !== true) await new Promise(() => {});
let profile = {};
try {
  profile = JSON.parse(sessionStorage.getItem("studentProfile") || "{}");
} catch {}
const name = profile.fullName || profile.email || "Student";
const initials = name
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map((word) => word[0])
  .join("")
  .toUpperCase();
document.querySelectorAll("#dashboardUserName").forEach((el) => {
  el.textContent = name;
});
document.querySelectorAll("#dashboardUserInitials, .avatar").forEach((el) => {
  el.textContent = initials;
});
document.querySelectorAll("#studentLogout, #needsLogout").forEach((button) => {
  button.addEventListener("click", async () => {
    sessionStorage.clear();
    try {
      await signOut(auth);
    } catch {}
    location.replace(new URL("../index/index.html", import.meta.url).href);
  });
});
