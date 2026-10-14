import { auth } from "../../firebase/firebase-config.js";
import { sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";

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
  const gmail = String(input?.value || "").trim().toLowerCase();
  if (!gmail) return;

  if (button) {
    button.disabled = true;
    button.textContent = "Sending…";
  }

  setStatus("", "Sending password reset", "Firebase is preparing your password reset email.", "…");

  try {
    await sendPasswordResetEmail(auth, gmail);

    setStatus(
      "success",
      "Check your Gmail",
      "A password reset link has been sent. Please check your inbox or spam folder.",
      "✓"
    );

    form.reset();
  } catch (error) {
    let message = "The password reset request failed.";

    if (error?.code === "auth/user-not-found") {
      message = "No account is linked to this Gmail address.";
    } else if (error?.code === "auth/invalid-email") {
      message = "Please enter a valid Gmail address.";
    }

    setStatus("error", "Recovery request failed", message, "!");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Send password reset link";
    }
  }
});
