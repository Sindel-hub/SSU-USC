// Actual pages + actual authenticated HTTP handlers, using synthetic database/Auth fixtures.
const { chromium } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  http = require("node:http"),
  assert = require("node:assert/strict");
const {
  participationFixture,
} = require("../helpers/participation-fixture.cjs");
const { createManagementHTTPHandler } = require("../../server/http.cjs");
const f = participationFixture(),
  root = path.resolve(__dirname, "../..");
const delta = Date.now() - f.now;
f.advance(delta);
for (const key of ["events/assembly", "programs/service"]) {
  const event = f.records.get(key);
  for (const field of Object.keys(event))
    if (field.endsWith("AtMs")) event[field] += delta;
  Object.assign(event, {
    eventDate: new Date(f.now).toISOString().slice(0, 10),
    publishedAtMs: f.now,
    venue: "Synthetic Hall",
    description: "Synthetic participation test",
    startTime: "08:00",
    endTime: "18:00",
    category: "Assembly",
  });
  event.registrationClosesAtMs = f.now + 300000;
  event.timeInClosesAtMs = f.now + 600000;
  event.timeOutClosesAtMs = f.now + 900000;
}
let base, api, browser;
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
};
const firebaseModule = `export const auth={currentUser:{uid:globalThis.TEST_UID,getIdToken:async()=>globalThis.TEST_UID,getIdTokenResult:async()=>({claims:{role:globalThis.TEST_UID==='operator'?'officer':'student'}})}},db={},appCheck=null,functions={};`;
const sdk = `const read=async path=>(await fetch('/__fixture?path='+encodeURIComponent(path))).json();const snap=(path,data)=>({id:path.split('/').at(-1),exists:()=>!!data,data:()=>data});export const collection=(_, ...parts)=>({path:parts.join('/')}),doc=(_, ...parts)=>({path:parts.join('/')}),query=(ref,...filters)=>({...ref,filters}),orderBy=(...args)=>({kind:'order',args}),where=(...args)=>({kind:'where',args}),limit=n=>({kind:'limit',n}),startAfter=()=>({}),Timestamp={fromDate:date=>({toMillis:()=>date.getTime(),toDate:()=>date})},serverTimestamp=()=>null;export async function getDoc(ref){return snap(ref.path,await read(ref.path));}export async function getDocs(ref){const values=await read(ref.path);return {docs:(Array.isArray(values)?values:[]).map(row=>snap(ref.path+'/'+row.id,row))};}export function onSnapshot(ref,success,error){let last;const tick=async()=>{try{const data=await getDocs(ref),signature=JSON.stringify(data.docs.map(doc=>doc.data()));if(signature!==last){last=signature;success(data);}}catch(e){error?.(e);}};tick();const timer=setInterval(tick,150);return()=>clearInterval(timer);}export const getCountFromServer=async()=>({data:()=>({count:0})});export const addDoc=async()=>{},updateDoc=async()=>{},deleteDoc=async()=>{},setDoc=async()=>{};`;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, base || "http://localhost");
  if (url.pathname === "/api/management") return api(req, res);
  if (url.pathname === "/__fixture") {
    const key = url.searchParams.get("path");
    let value = f.records.get(key);
    if (!value && key.split("/").length % 2 === 1)
      value = [...f.records.entries()]
        .filter(
          ([p]) =>
            p.startsWith(key + "/") &&
            p.split("/").length === key.split("/").length + 1,
        )
        .map(([p, data]) => ({ ...data, id: p.split("/").at(-1) }));
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify(value || null));
  }
  if (url.pathname === "/firebase/firebase-config.js") {
    res.setHeader("Content-Type", "text/javascript");
    return res.end(firebaseModule);
  }
  const file = path.resolve(root, "." + url.pathname);
  if (
    !file.startsWith(root + path.sep) ||
    !fs.existsSync(file) ||
    !fs.statSync(file).isFile()
  ) {
    res.statusCode = 404;
    return res.end();
  }
  let content = fs.readFileSync(file);
  if (path.extname(file) === ".html")
    content = content
      .toString()
      .replace(
        /<script[^>]*src="[^"]*(?:auth-guard|nav-active|admin-auth|officer-rbac|profile-manager|notifications|student-sidebar|events-scroll|events-section)[^"]*"[^>]*><\/script>/g,
        "",
      );
  res.setHeader(
    "Content-Type",
    types[path.extname(file)] || "application/octet-stream",
  );
  res.end(content);
});
(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = "http://127.0.0.1:" + server.address().port;
  api = createManagementHTTPHandler({
    hosted: false,
    log: () => {},
    getRuntime: () => ({
      settings: { allowedOrigins: new Set([base]), enforceAppCheck: false },
      handlers: { ...f.h, ...f.h },
      verifyIdToken: async (uid) => ({
        uid,
        role: f.records.get("users/" + uid)?.role,
        email_verified: true,
        auth_time: f.now / 1000,
      }),
    }),
  });
  // Include actual publication handler along with participation handlers.
  // Publication and attendance share the real authorization layer.
  const {
    createOfficerModuleHandlers,
  } = require("../../server/officer-modules.cjs");
  const published = createOfficerModuleHandlers({
    db: f.db,
    history: f.history,
    ...f.authorization,
    Timestamp: { fromMillis: (n) => n },
    clock: () => f.now,
  });
  api = createManagementHTTPHandler({
    hosted: false,
    log: () => {},
    getRuntime: () => ({
      settings: { allowedOrigins: new Set([base]), enforceAppCheck: false },
      handlers: { ...f.h, ...published },
      verifyIdToken: async (uid) => ({
        uid,
        role: f.records.get("users/" + uid)?.role,
        email_verified: true,
        auth_time: f.now / 1000,
      }),
    }),
  });
  browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const errors = [];
  async function pageFor(uid, url, viewport = { width: 1440, height: 1000 }) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    page.on("dialog", async (dialog) => {
      console.log("UI notice:", dialog.message());
      await dialog.accept();
    });
    page.on("pageerror", (error) => {
      errors.push(error.message);
      console.log("PAGE ERROR", error.message);
    });
    await page.addInitScript(
      ({ uid, profile }) => {
        globalThis.TEST_UID = uid;
        globalThis.USC_AUTH_READY = Promise.resolve(true);
        sessionStorage.setItem(
          "studentProfile",
          JSON.stringify({ ...profile, uid }),
        );
        sessionStorage.setItem("activeSession", "true");
      },
      { uid, profile: f.records.get("users/" + uid) },
    );
    await page.route("https://www.gstatic.com/firebasejs/**", (route) =>
      route.fulfill({
        contentType: "text/javascript",
        body: route.request().url().includes("firestore")
          ? sdk
          : "export const signOut=async()=>{};",
      }),
    );
    await page.route("**/shared/security-client.js*", (route) =>
      route.fulfill({
        contentType: "text/javascript",
        body: "export const hydrateMediaImages=async()=>{},resolveMediaUrl=async value=>value,secureUpload=async()=>{},callSecure=async()=>({});",
      }),
    );
    await page.route("**/shared/engagement-analytics.js*", (route) =>
      route.fulfill({
        contentType: "text/javascript",
        body: "export const mountEngagementAnalytics=()=>({setRecords(){},setError(){},update(){}});",
      }),
    );
    await page.route("**/shared/js/officer-rbac.js*", (route) =>
      route.fulfill({
        contentType: "text/javascript",
        body: "export const hasOfficerPermission=()=>true;",
      }),
    );
    await page.route("https://cdnjs.cloudflare.com/**", (route) =>
      route.abort(),
    );
    await page.route("https://fonts.googleapis.com/**", (route) =>
      route.abort(),
    );
    await page.route("https://fonts.gstatic.com/**", (route) => route.abort());
    await page.goto(base + url);
    await page.evaluate(() =>
      document.documentElement.classList.remove("usc-officer-access-pending"),
    );
    return page;
  }
  const student = await pageFor("first", "/dashboard/my-qr.html");
  await student
    .locator("#myStudentQR svg")
    .waitFor()
    .catch(async (error) => {
      console.log(
        "QR message",
        await student.locator("#studentQRMessage").textContent(),
      );
      throw error;
    });
  const firstQR = await student.locator("#myStudentQR").innerHTML();
  await student.reload();
  await student.locator("#myStudentQR svg").waitFor();
  assert.equal(await student.locator("#myStudentQR").innerHTML(), firstQR);
  await student
    .getByRole("button", { name: "Expand QR Code", exact: true })
    .click();
  await student.locator("#expandedStudentQR[open] svg").waitFor();
  await student.keyboard.press("Escape");
  assert.equal(
    await student.locator("#expandedStudentQR").evaluate((el) => el.open),
    false,
  );
  const downloadPromise = student.waitForEvent("download");
  await student
    .getByRole("button", { name: "Download QR Code", exact: true })
    .click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), "my-student-qr.svg");
  const events = await pageFor("first", "/dashboard/events.html");
  await events.locator('[data-participate-event="assembly"]').click();
  await events.locator('[data-register-event="assembly"]').click();
  await events.waitForFunction(() =>
    document
      .querySelector("#eventsRegistrationState")
      ?.textContent.includes("Registered"),
  );
  assert.equal(
    f.records.get("events/assembly/registrations/first").timeInAtMs,
    undefined,
  );
  const officer = await pageFor("operator", "/usc-admin/events/events.html");
  await officer.locator('[data-manage-attendance="assembly"]').waitFor();
  await officer.locator('[data-manage-attendance="assembly"]').click();
  const dialog = officer
    .locator(".participation-dialog")
    .filter({ hasText: "Event Participation Monitoring" });
  await dialog.getByText("Synthetic first", { exact: true }).waitFor();
  await dialog.locator("[data-scanner-tab]").click();
  await dialog.locator("[data-mode]").selectOption("in");
  const qr = await f.h.participationQR(f.req("first"));
  await officer.addScriptTag({ url: base + "/vendor/qr/qrcode.js" });
  await officer.evaluate((payload) => {
    const code = globalThis.qrcode(0, "M");
    code.addData(payload);
    code.make();
    const size = code.getModuleCount(),
      scale = 24,
      margin = 4,
      canvas = document.createElement("canvas");
    globalThis.TEST_QR_CANVAS = canvas;
    canvas.width = canvas.height = (size + margin * 2) * scale;
    const c = canvas.getContext("2d");
    c.fillStyle = "white";
    c.fillRect(0, 0, canvas.width, canvas.height);
    c.fillStyle = "black";
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++)
        if (code.isDark(y, x))
          c.fillRect((x + margin) * scale, (y + margin) * scale, scale, scale);
    const fullFrame = document.createElement("canvas");
    fullFrame.width = 1920;
    fullFrame.height = 1080;
    const frameContext = fullFrame.getContext("2d");
    frameContext.fillStyle = "#aaa";
    frameContext.fillRect(0, 0, 1920, 1080);
    frameContext.drawImage(canvas, 900, 480, 120, 120);
    globalThis.TEST_QR_CANVAS = fullFrame;
    const legacy = document.createElement("canvas");
    legacy.width = 640;
    legacy.height = 360;
    const legacyContext = legacy.getContext("2d");
    legacyContext.drawImage(fullFrame, 0, 0, 640, 360);
    const legacyPixels = legacyContext.getImageData(0, 0, 640, 360);
    globalThis.TEST_LEGACY_DECODE =
      globalThis.jsQR(legacyPixels.data, 640, 360)?.data || null;
    setInterval(() => frameContext.fillRect(0, 0, 1, 1), 100);
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => globalThis.TEST_QR_CANVAS.captureStream(5),
    });
    Object.defineProperty(navigator.mediaDevices, "enumerateDevices", {
      configurable: true,
      value: async () => [
        {
          kind: "videoinput",
          deviceId: "synthetic",
          label: "Synthetic QR camera",
        },
      ],
    });
  }, qr.payload);
  assert.equal(
    await officer.evaluate(() => globalThis.TEST_LEGACY_DECODE),
    null,
    "Old 640px scan misses this small QR in a 1080p frame",
  );
  await dialog.locator("[data-start]").click();
  await dialog.locator("[data-confirm]").waitFor();
  assert.equal(
    f.records.get("events/assembly/registrations/first").timeInAtMs,
    undefined,
  );
  await dialog.locator("[data-confirm]").click();
  await officer.waitForFunction(() =>
    document
      .querySelector(".participation-message")
      .textContent.includes("Time-in"),
  );
  assert.equal(
    f.records.get("events/assembly/registrations/first").timeInOfficerUid,
    "operator",
  );
  await dialog.locator("[data-stop]").click();
  f.advance(60000);
  await dialog.locator("[data-mode]").selectOption("out");
  await dialog.locator("[data-start]").click();
  await dialog.locator("[data-confirm]").waitFor();
  assert.equal(
    f.records.get("events/assembly/registrations/first").timeOutAtMs,
    undefined,
  );
  await dialog.locator("[data-confirm]").click();
  await officer.waitForFunction(() =>
    document
      .querySelector(".participation-message")
      .textContent.includes("Time-out"),
  );
  await dialog.locator("[data-stop]").click();
  await dialog.locator("[data-roster-tab]").click();
  await dialog.locator("[data-refresh]").click();
  await dialog.getByText("Completed", { exact: true }).last().waitFor();
  await dialog.locator('[data-student="first"]').click();
  await officer
    .locator(".participation-dialog")
    .filter({ hasText: "Student Participation History" })
    .getByRole("cell")
    .filter({ hasText: "Synthetic General Assembly" })
    .waitFor();
  await officer
    .locator(".participation-dialog")
    .filter({ hasText: "Student Participation History" })
    .getByLabel("Close participation record")
    .click();
  await dialog.locator("[data-scanner-tab]").click();
  await dialog.locator("[data-start]").evaluate((button) => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        throw new DOMException("Denied", "NotAllowedError");
      },
    });
  });
  await dialog.locator("[data-start]").click();
  await dialog.getByText(/Camera permission was denied/).waitFor();
  await dialog.locator("[data-roster-tab]").click();
  const output = "/workspace/review-artifacts/event-participation";
  fs.mkdirSync(output, { recursive: true });
  await dialog.screenshot({ path: path.join(output, "desktop-monitor.png") });
  await officer.setViewportSize({ width: 768, height: 1024 });
  await dialog.screenshot({ path: path.join(output, "tablet-monitor.png") });
  assert.ok(
    await dialog.evaluate(
      (el) => el.getBoundingClientRect().width <= window.innerWidth,
    ),
  );
  await officer.setViewportSize({ width: 390, height: 844 });
  await dialog.screenshot({ path: path.join(output, "mobile-monitor.png") });
  await dialog.getByLabel("Close attendance").click();
  await officer
    .getByRole("button", {
      name: "Student Participation Tracklist",
      exact: true,
    })
    .click();
  const tracklist = officer
    .locator(".participation-dialog")
    .filter({ hasText: "Student Participation Tracklist" });
  await tracklist.locator("[data-view]").selectOption("participation");
  await tracklist
    .getByRole("cell", { name: "Completed", exact: true })
    .waitFor();
  await tracklist.locator("[data-search]").fill("990001");
  await tracklist.locator("[data-event]").fill("General Assembly");
  await tracklist.locator("[data-status]").selectOption("Completed");
  assert.equal(await tracklist.locator("tbody tr").count(), 1);
  await tracklist.locator("[data-search]").fill("no-match");
  await tracklist
    .getByText("No matching records in the loaded results.")
    .waitFor();
  await tracklist.locator("[data-clear]").click();
  await tracklist.getByRole("button", { name: "View Record" }).waitFor();
  await tracklist.getByLabel("Close student tracklist").click();
  await officer.setViewportSize({ width: 1440, height: 1000 });
  await officer.locator("#scrollToEventFormBtn").click();
  const form = officer.locator("#eventForm");
  await form.locator("#eventTitle").fill("Browser Published Assembly");
  await form
    .locator("#eventDate")
    .fill(new Date(f.now + 86400000).toISOString().slice(0, 10));
  await form.locator("#eventVenue").fill("Synthetic hall");
  await form.locator("#eventStartTime").fill("08:00");
  await form.locator("#eventEndTime").fill("18:00");
  await form
    .locator("#eventDescription")
    .fill("Synthetic full browser publication");
  const times = {
    registrationOpensAtMs: -3600000,
    registrationClosesAtMs: 3600000,
    timeInOpensAtMs: 7200000,
    timeInClosesAtMs: 10800000,
    timeOutOpensAtMs: 10800000,
    timeOutClosesAtMs: 14400000,
  };
  for (const [field, offset] of Object.entries(times))
    await form
      .locator(`[data-participation-schedule="${field}"]`)
      .fill(new Date(f.now + offset + 8 * 3600000).toISOString().slice(0, 16));
  await form
    .locator("fieldset.participation-card")
    .screenshot({ path: path.join(output, "event-form.png") });
  await form.locator('[type="submit"]').click();
  await officer.waitForFunction(
    () => document.querySelector("#eventTitle").value === "",
  );
  assert.ok(
    [...f.records.entries()].some(
      ([key, value]) =>
        key.startsWith("events/") &&
        value.title === "Browser Published Assembly" &&
        value.participationVersion === 1,
    ),
  );
  const created = [...f.records.entries()].find(
    ([key, value]) =>
      key.startsWith("events/") &&
      key.split("/").length === 2 &&
      value.title === "Browser Published Assembly",
  );
  const createdId = created[0].split("/")[1];
  await officer.locator(`[data-edit-event="${createdId}"]`).click();
  await form.locator("#eventTitle").fill("Browser Edited Assembly");
  await form.locator('[type="submit"]').click();
  await officer.waitForFunction(
    () => document.querySelector("#eventTitle").value === "",
  );
  assert.equal(f.records.get(created[0]).title, "Browser Edited Assembly");
  console.log("Browser errors:", errors);
  assert.deepEqual(errors, []);
  await browser.close();
  console.log(
    "PASS: stable QR, expand/download, UI registration, identity preview before confirm, high-resolution QR camera decode, time-in/out, history and tracklist filters, camera denial, event publishing/editing, desktop/tablet/mobile. Hardware cameras and live data not used.",
  );
})()
  .catch(async (error) => {
    console.error(error);
    for (const context of browser?.contexts() || [])
      for (const page of context.pages())
        await page.screenshot({
          path:
            "/tmp/participation-failure-" +
            context.pages().indexOf(page) +
            "-" +
            browser.contexts().indexOf(context) +
            ".png",
        });
    process.exitCode = 1;
  })
  .finally(async () => {
    await browser?.close();
    server.close();
  });
