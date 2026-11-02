import { auth } from "../../firebase/firebase-config.js";
import { signOut } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import { callStudentEmailService } from "../../shared/supabase-email-service.js";
import { rememberGmailReturn, returnToLinkedGmailAccount } from "../../shared/verified-gmail-return.js";
import { callPublicEmailAction } from "./email-api.js";

const TOKEN_KEY = "uscGmailVerificationToken";
const status = document.getElementById("verifyStatus");
const statusIcon = status?.querySelector(".status-icon");
const statusTitle = status?.querySelector("strong");
const statusText = document.getElementById("verifyStatusText");
const button = document.getElementById("verifyButton");
const returnButton = document.getElementById("returnButton");

function setStatus(kind, title, message, icon) {
  status?.classList.remove("success", "error");
  if (kind) status?.classList.add(kind);
  if (statusTitle) statusTitle.textContent = title;
  if (statusText) statusText.textContent = message;
  if (statusIcon) statusIcon.textContent = icon;
}

function validToken(value) {
  return /^[a-f0-9]{64}$/.test(String(value || ""));
}

const url = new URL(window.location.href);
const queryToken = String(url.searchParams.get("token") || "").trim();
if (validToken(queryToken)) {
  sessionStorage.setItem(TOKEN_KEY, queryToken);
  url.searchParams.delete("token");
  history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

let confirmedEmail = "";
let returning = false;
let token = sessionStorage.getItem(TOKEN_KEY) || "";
if (!validToken(token)) {
  token = "";
  sessionStorage.removeItem(TOKEN_KEY);
  if (button) button.disabled = true;
  setStatus("error", "Verification link unavailable", "This verification link is missing or invalid. Return to your portal profile, save your Gmail again, and use the newest email.", "!");
}

button?.addEventListener("click", async () => {
  if (!validToken(token)) return;
  button.disabled = true;
  button.textContent = "Verifying…";
  setStatus("", "Verifying Gmail", "Please wait while the portal validates this one-time link.", "…");
  try {
    const result = await callPublicEmailAction("verify", { token });
    sessionStorage.removeItem(TOKEN_KEY);
    token = "";
    setStatus("success", "Gmail verified", `${result.email || "Your Gmail"} is now active for the notification and recovery options you enabled.`, "✓");
    button.hidden = true;
    if (returnButton) {
      confirmedEmail = rememberGmailReturn(result.email, sessionStorage);
      returnButton.href = "../index/index.html";
      returnButton.textContent = "Return to linked dashboard";
    }
  } catch (error) {
    setStatus("error", "Verification could not be completed", error?.message || "The verification request failed. Save your Gmail again and request a new link.", "!");
    if (button) {
      button.disabled = false;
      button.textContent = "Try again";
    }
  }
});

returnButton?.addEventListener("click", async (event) => {
  if (!confirmedEmail) return;
  event.preventDefault();
  if (returning) return;
  returning = true;
  returnButton.setAttribute("aria-disabled", "true");
  try {
    const path = await returnToLinkedGmailAccount({
      auth, loadSettings: () => callStudentEmailService("get"), signOut,
      storage: sessionStorage, email: confirmedEmail
    });
    window.location.assign(path);
  } catch (error) {
    setStatus("error", "Could not check the linked account", error?.message || "Please try again. Your Gmail remains verified.", "!");
  } finally {
    returning = false;
    returnButton.removeAttribute("aria-disabled");
  }
});
