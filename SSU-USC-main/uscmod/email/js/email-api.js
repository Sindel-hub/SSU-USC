const DEFAULT_ENDPOINT = "https://svgfxatigtjdrwzibjbu.supabase.co/functions/v1/usc-email";

function endpoint() {
  const override = String(globalThis.USC_SUPABASE_EMAIL_FUNCTION_URL || "").trim();
  return /^https:\/\/[^\s]+\/functions\/v1\/usc-email$/.test(override) ? override : DEFAULT_ENDPOINT;
}

export async function callPublicEmailAction(action, payload = {}) {
  const response = await fetch(endpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ action, ...payload }),
    credentials: "omit",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    const error = new Error(data?.message || `Email service failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return data;
}
