import { callPublicEmailAction } from "./email-api.js";

let sending = false;

const form = document.getElementById("recoveryForm");
const input = document.getElementById("recoveryGmail");
const button = document.getElementById("recoveryButton");
const status = document.getElementById("recoveryStatus");
const statusIcon = status?.querySelector(".status-icon");
const statusTitle = status?.querySelector("strong");
const statusText = document.getElementById("recoveryStatusText");

function setStatus(kind, title, message, icon) {
  status?.classList.remove("success", "error");
  if (kind) status?.classList.add(kind);
  if (statusTitle) statusTitle.textContent = title;
  if (statusText) statusText.textContent = message;
  if (statusIcon) statusIcon.textContent = icon;
}

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (sending) return;
  const gmail = String(input?.value || "").trim().toLowerCase();
  if (!/^[a-z0-9.]+(?:\+[a-z0-9._-]+)?@gmail\.com$/.test(gmail)) {
    setStatus("error", "Check your Gmail address", "Enter the personal @gmail.com address verified in your profile.", "!");
    return;
  }
  sending = true;

  if (button) {
    button.disabled = true;
    button.textContent = "Sending…";
  }

  setStatus("", "Sending password reset", "The portal is processing your recovery request.", "…");

  try {
    await callPublicEmailAction("recover", { gmail });

    setStatus(
      "success",
      "Check your Gmail",
      "If this Gmail is verified, recovery is enabled, and sending limits allow it, a reset link will be sent. Check Inbox and Spam. For security, this response does not confirm whether an account exists.",
      "✓"
    );

    form.reset();
  } catch (error) {
    const message = error?.status === 429
      ? "Too many recovery requests. Please wait before trying again."
      : "The recovery service could not process your request. Please try again later or contact the system administrator.";

    setStatus("error", "Recovery request failed", message, "!");
  } finally {
    sending = false;
    if (button) {
      button.disabled = false;
      button.textContent = "Send password reset link";
    }
  }
});
