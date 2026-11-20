import { managementRequest as request } from "../shared/management-client.js";
const token = new URLSearchParams(location.hash.slice(1)).get("token");
history.replaceState(null, "", location.pathname);
const form = document.getElementById("activationForm"),
  status = document.getElementById("activationStatus");
if (!token) {
  status.textContent =
    "Open the private activation link supplied by USC. Contact USC if the link expired.";
  form.hidden = true;
}
form.onsubmit = async (event) => {
  event.preventDefault();
  if (form.querySelector("button").disabled) return;
  const password = document.getElementById("newPassword").value;
  if (password !== document.getElementById("confirmPassword").value) {
    status.textContent = "Passwords do not match.";
    return;
  }
  form.querySelector("button").disabled = true;
  try {
    await request("activate", { token, password }, { publicAccess: true });
    form.reset();
    form.hidden = true;
    status.textContent =
      "Account activated. You can now sign in with your Student ID if your academic status is Active.";
  } catch (error) {
    status.textContent = error.message;
  } finally {
    form.querySelector("button").disabled = false;
  }
};
