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
    return encodeChartCanvas(canvas);
  } finally { bitmap.close(); }
}

export function encodeChartCanvas(canvas) {
  for (const quality of [.9, .8, .7, .6, .5]) {
    const image = canvas.toDataURL("image/webp", quality);
    if (image.startsWith("data:image/webp;base64,") && image.length <= 900000) return image;
  }
  throw new Error("This image is too detailed to publish. Choose a smaller image.");
}

export function chartCropRect(width, height, targetWidth, targetHeight, zoom = 1, x = 50, y = 50) {
  const bounded = (value, min, max) => Math.max(min, Math.min(max, Number(value) || min));
  const scale = Math.max(targetWidth / width, targetHeight / height) * bounded(zoom, .01, 3);
  const cropWidth = targetWidth / scale;
  const cropHeight = targetHeight / scale;
  return { x: (width - cropWidth) * bounded(x, 0, 100) / 100,
    y: (height - cropHeight) * bounded(y, 0, 100) / 100, width: cropWidth, height: cropHeight };
}

export function chartFitZoom(width, height, targetWidth, targetHeight) {
  const fit = Math.min(targetWidth / width, targetHeight / height);
  const cover = Math.max(targetWidth / width, targetHeight / height);
  return Math.max(1, Math.min(100, Math.floor(fit / cover * 100)));
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
const cropCanvas = document.querySelector("[data-org-crop]");
const adjustPanel = document.querySelector("[data-org-adjust]");
const zoomControl = document.querySelector("[data-org-zoom]");
const xControl = document.querySelector("[data-org-x]");
const yControl = document.querySelector("[data-org-y]");
let cropSource = null;
let published = "", selected = "", busy = false;
function renderCrop() {
  if (!cropSource || !selected || !editor?.classList.contains("is-editing")) return;
  const frame = image.parentElement;
  const width = frame.clientWidth, height = frame.clientHeight;
  if (!width || !height) return;
  const scale = Math.min(2, 2048 / Math.max(width, height));
  cropCanvas.width = Math.max(1, Math.round(width * scale));
  cropCanvas.height = Math.max(1, Math.round(height * scale));
  const crop = chartCropRect(cropSource.naturalWidth, cropSource.naturalHeight, width, height,
    Number(zoomControl.value) / 100, xControl.value, yControl.value);
  const context = cropCanvas.getContext("2d");
  context.fillStyle = "#fff"; context.fillRect(0, 0, cropCanvas.width, cropCanvas.height);
  context.drawImage(cropSource, crop.x, crop.y, crop.width, crop.height, 0, 0, cropCanvas.width, cropCanvas.height);
  image.hidden = true; placeholder.hidden = true; cropCanvas.hidden = false; adjustPanel.hidden = false;
  document.querySelector("[data-org-zoom-value]").textContent = zoomControl.value + "%";
}
function resetCrop() { zoomControl.value = "100"; xControl.value = "50"; yControl.value = "50"; renderCrop(); }

function announce(message, error = false) { status.textContent = message; status.dataset.error = String(error); }
function show(value) {
  if (cropCanvas) cropCanvas.hidden = true;
  if (adjustPanel) adjustPanel.hidden = true;
  const safe = /^data:image\/webp;base64,[A-Za-z0-9+/=]+$/.test(value) && value.length <= 900000;
  image.hidden = !safe; placeholder.hidden = safe;
  if (safe) image.src = value; else image.removeAttribute("src");
}
function controls() { editor?.setAttribute("aria-busy", String(busy)); input.disabled = busy; save.disabled = busy || !selected; cancel.disabled = busy || !selected; if (back) back.disabled = busy; adjustPanel?.querySelectorAll("input,button").forEach(control => { control.disabled = busy; }); }
function editing(active) {
  editor.classList.toggle("is-editing", active);
  editor.classList.remove("org-controls-touch");
  update.hidden = active;
  if (!active) { selected = ""; cropSource = null; show(published); }
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
    for (const control of [zoomControl, xControl, yControl]) control.addEventListener("input", renderCrop);
    document.querySelector("[data-org-reset]").addEventListener("click", resetCrop);
    document.querySelector("[data-org-fit]").addEventListener("click", () => {
      if (!cropSource) return;
      const frame = image.parentElement;
      zoomControl.value = String(chartFitZoom(cropSource.naturalWidth, cropSource.naturalHeight, frame.clientWidth, frame.clientHeight));
      xControl.value = "50"; yControl.value = "50"; renderCrop();
    });
    document.addEventListener("keydown", event => {
      if (["Tab", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) editor.classList.add("org-controls-keyboard");
    });
    editor.addEventListener("pointerdown", () => editor.classList.remove("org-controls-keyboard"));
    let drag = null;
    let gestureStart = null;
    cropCanvas.addEventListener("pointerdown", event => {
      if (busy || !selected || event.button !== 0) return;
      gestureStart = { x: event.clientX, y: event.clientY };
      drag = { x: event.clientX, y: event.clientY, offsetX: Number(xControl.value), offsetY: Number(yControl.value) };
      cropCanvas.setPointerCapture(event.pointerId); cropCanvas.classList.add("is-dragging");
    });
    cropCanvas.addEventListener("pointermove", event => {
      if (!drag || busy) return;
      const frame = image.parentElement;
      const crop = chartCropRect(cropSource.naturalWidth, cropSource.naturalHeight, frame.clientWidth, frame.clientHeight, Number(zoomControl.value) / 100);
      const move = (delta, viewportSize, cropSize, sourceSize, initial) => Math.abs(sourceSize - cropSize) > .01
        ? Math.max(0, Math.min(100, initial - delta / viewportSize * cropSize / (sourceSize - cropSize) * 100)) : initial;
      xControl.value = String(move(event.clientX - drag.x, frame.clientWidth, crop.width, cropSource.naturalWidth, drag.offsetX));
      yControl.value = String(move(event.clientY - drag.y, frame.clientHeight, crop.height, cropSource.naturalHeight, drag.offsetY));
      renderCrop();
    });
    cropCanvas.addEventListener("pointerup", event => {
      if (event.pointerType !== "mouse" && gestureStart && Math.hypot(event.clientX - gestureStart.x, event.clientY - gestureStart.y) < 8) editor.classList.toggle("org-controls-touch");
      gestureStart = null;
    });
    for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) cropCanvas.addEventListener(name, () => { drag = null; cropCanvas.classList.remove("is-dragging"); });
    const observer = new ResizeObserver(renderCrop); observer.observe(image.parentElement);
    window.addEventListener("pagehide", event => { if (!event.persisted) observer.disconnect(); });
    input.addEventListener("change", async () => {
      const file = input.files?.[0]; if (!file) return;
      busy = true; controls(); announce("Preparing image…");
      try {
        const next = await encodeChartImage(file);
        const decoded = new Image(); decoded.src = next; await decoded.decode();
        selected = next; cropSource = decoded; resetCrop();
        announce(matchMedia("(hover: none)").matches ? "Drag to adjust. Tap the image to show or hide controls." : "Drag to adjust. Hover over the top or bottom tools to reveal them.");
      }
      catch (error) { announce(error.message || "Unable to read that image.", true); }
      finally { busy = false; input.value = ""; controls(); }
    });
    cancel.addEventListener("click", () => { selected = ""; cropSource = null; show(published); announce(""); controls(); });
    save.addEventListener("click", async () => {
      if (busy || !selected) return;
      busy = true; controls(); announce("Publishing chart…");
      try {
        renderCrop();
        const adjustedImage = encodeChartCanvas(cropCanvas);
        await setDoc(doc(db, "organization_chart", "current"), { imageData: adjustedImage, updatedAt: serverTimestamp() });
        published = adjustedImage; selected = ""; show(published); editing(false); announce("Organizational chart published.");
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
