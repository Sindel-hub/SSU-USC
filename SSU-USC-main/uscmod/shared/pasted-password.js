// Preserve exact password verification first. Only a full-field paste of a
// school-generated temporary password may retry without surrounding formatting.
export function bindPastedPasswordLogin(input, authenticate) {
  let pasted = null;
  input?.addEventListener("paste", (event) => {
    pasted = null;
    if (!event.clipboardData || input.selectionStart !== 0 || input.selectionEnd !== input.value.length) return;
    const text = event.clipboardData.getData("text/plain");
    const clean = text.replace(/^[\s\u200B]+|[\s\u200B]+$/gu, "");
    const generated = /^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%]{14}$/.test(clean)
      && /[A-Z]/.test(clean) && /[a-z]/.test(clean) && /[23456789]/.test(clean) && /[!@#$%]/.test(clean);
    if (generated && clean !== text) pasted = { values: [text.replace(/[\r\n]/g, ""), text.replace(/\r\n|[\r\n]/g, " ")], clean };
    // Let the browser perform the paste normally, preserving undo and selection.
  });
  return async (identifier, password) => {
    const retry = pasted?.values.includes(password) ? pasted.clean : null;
    pasted = null;
    try {
      return await authenticate(identifier, password);
    } catch (error) {
      if (!retry || retry === password || !["auth/invalid-credential", "auth/wrong-password"].includes(error?.code)) throw error;
      // Never bypass Firebase or Gmail password checks or create another account.
      return authenticate(identifier, retry);
    }
  };
}

export async function copyTemporaryPassword(password, button) {
  if (!password || !button) return;
  try {
    await navigator.clipboard.writeText(password);
    button.textContent = "Password copied";
  } catch {
    button.textContent = "Copy unavailable — select password manually";
  }
}
