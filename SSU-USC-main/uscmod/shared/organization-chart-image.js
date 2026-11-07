import { auth, db } from "../firebase/firebase-config.js";
import { doc, getDoc, onSnapshot, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";

export function validateChartFile(file) {
  if (!file || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Choose a JPG, PNG or WebP image.");
  if (file.size > 5 * 1024 * 1024) throw new Error("Choose an image no larger than 5 MB.");
}

// One bounded document keeps this temporary image feature independent of storage services.
export async function encodeChartImage(file) {
  validateChartFile(file);
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [.9, .8, .7, .6, .5]) {
      const image = canvas.toDataURL("image/webp", quality);
      if (image.startsWith("data:image/webp;base64,") && image.length <= 900000) return image;
    }
    throw new Error("This image is too detailed to publish. Choose a smaller image.");
  } finally { bitmap.close(); }
}

const image = document.querySelector("[data-org-image]");
const placeholder = document.querySelector("[data-org-placeholder]");
const status = document.querySelector("[data-org-status]");
const editor = document.querySelector("[data-org-editor]");
const input = document.querySelector("[data-org-file]");
const save = document.querySelector("[data-org-save]");
const cancel = document.querySelector("[data-org-cancel]");
const update = document.querySelector("[data-org-update]");
const back = document.querySelector("[data-org-back]");
let published = "", selected = "", busy = false;
function announce(message, error = false) { status.textContent = message; status.dataset.error = String(error); }
function show(value) {
  const safe = /^data:image\/webp;base64,[A-Za-z0-9+/=]+$/.test(value) && value.length <= 900000;
  image.hidden = !safe; placeholder.hidden = safe;
  if (safe) image.src = value; else image.removeAttribute("src");
}
function controls() { input.disabled = busy; save.disabled = busy || !selected; cancel.disabled = busy || !selected; if (back) back.disabled = busy; }
function editing(active) {
  editor.classList.toggle("is-editing", active);
  update.hidden = active;
  if (!active) { selected = ""; show(published); }
  announce("");
  controls();
  if (active) input.focus(); else update.focus();
}
async function start() {
  if (!image) return;
  if (editor) {
    if (await (globalThis.USC_AUTH_READY || Promise.resolve(false)) !== true) return;
    const user = auth.currentUser;
    if (!user) return;
    const snap = await getDoc(doc(db, "users", user.uid));
    const profile = snap.data() || {};
    if (!["officer", "admin"].includes(profile.role) || profile.isActive === false || profile.accountStatus !== "approved" || (profile.role === "officer" && profile.studentStanding && profile.studentStanding !== "active")) {
      announce("Only active, approved officers can publish the chart.", true); return;
    }
    document.querySelector("[data-org-controls]").hidden = false;
    update.hidden = false;
    update.addEventListener("click", () => { if (!busy) editing(true); });
    back.addEventListener("click", () => { if (!busy) editing(false); });
    controls();
    input.addEventListener("change", async () => {
      const file = input.files?.[0]; if (!file) return;
      busy = true; controls(); announce("Preparing image…");
      try { selected = await encodeChartImage(file); show(selected); announce("Preview ready. Publish to update the chart for everyone."); }
      catch (error) { announce(error.message || "Unable to read that image.", true); }
      finally { busy = false; input.value = ""; controls(); }
    });
    cancel.addEventListener("click", () => { selected = ""; show(published); announce(""); controls(); });
    save.addEventListener("click", async () => {
      if (busy || !selected) return;
      busy = true; controls(); announce("Publishing chart…");
      try {
        await setDoc(doc(db, "organization_chart", "current"), { imageData: selected, updatedAt: serverTimestamp() });
        published = selected; selected = ""; show(published); editing(false); announce("Organizational chart published.");
      } catch (error) {
        announce(error.code === "permission-denied" ? "Chart publishing is not enabled yet. Please contact the system administrator." : "Unable to publish. Your image preview is kept; please retry.", true);
      } finally { busy = false; controls(); }
    });
  }
  const unsubscribe = onSnapshot(doc(db, "organization_chart", "current"), snap => {
    published = snap.exists() ? String(snap.data().imageData || "") : "";
    if (!selected) show(published);
  }, () => announce("The published chart is temporarily unavailable.", true));
  window.addEventListener("pagehide", event => { if (!event.persisted) unsubscribe(); });
  image.addEventListener("error", () => { show(""); announce("The chart image could not be displayed.", true); });
}
start().catch(() => { if (status) announce("Unable to load the organizational chart. Please refresh and try again.", true); });
