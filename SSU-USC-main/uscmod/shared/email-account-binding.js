// USC SSU Email Account Binding Helper
// Client-side helper used by email settings modules.
// The backend should enforce uniqueness using a Firestore email registry.

export function normalizeRecoveryEmail(value){
  return String(value||"").trim().toLowerCase();
}

export function validateRecoveryEmail(value){
  const email = normalizeRecoveryEmail(value);
  if(!/^[^\s@]+@gmail\.com$/.test(email)){
    throw new Error("Please use a valid Gmail address.");
  }
  return email;
}

export function recoveryEmailCanBeUsed(email, currentEmail=""){
  return normalizeRecoveryEmail(email) === normalizeRecoveryEmail(currentEmail) || !email;
}
