import {institutionalAddress} from "../usc-email/institutional-accounts.mjs";
const norm=v=>String(v||'').trim().toLowerCase();
export function verifiedNotificationContact(uid,profile,auth,gmail){
 if(!auth||auth.disabled||auth.uid!==uid)return null;
 const linked=norm(profile.institutionalEmail||profile.email);
 let institutionalValid=false;try{institutionalValid=institutionalAddress(linked)===linked}catch{}
 const institutional=institutionalValid&&!profile.institutionalEmailRevokedAt&&(profile.institutionalEmailVerified===true||(auth.emailVerified===true&&norm(auth.email)===linked))?linked:'';
 const personal=gmail?.firebase_uid===uid&&gmail.verified_at&&gmail.requested_email===gmail.verified_email&&/^[a-z0-9.]+(?:\+[a-z0-9._-]+)?@gmail\.com$/.test(gmail.verified_email||'')&&!gmail.revoked_at?gmail.verified_email:'';
 const preferred=norm(profile.primaryNotificationEmail||profile.preferredNotificationEmail);
 if(preferred&&[personal,institutional].includes(preferred))return {email:preferred,source:preferred===personal?'gmail':'institutional'};
 // Existing portal notifications prefer the connected, verified personal Gmail.
 return personal?{email:personal,source:'gmail'}:institutional?{email:institutional,source:'institutional'}:null;
}

export function activeNotificationProfile(profile){return Boolean(profile&&profile.accountStatus==='approved'&&profile.isActive!==false&&(!profile.studentStanding||profile.studentStanding==='active'));}
export async function verifiedNotificationIdentity(uid,deps){
 const profile=await deps.get(`users/${uid}`);
 if(!activeNotificationProfile(profile?.data)||profile.data.role!=='student'||profile.data.schoolProvisioned!==true)throw Object.assign(new Error('An active school student account is required.'),{code:'permission-denied'});
 return {profile,contact:verifiedNotificationContact(uid,profile.data,await deps.authUser(uid),await deps.gmail(uid))};
}
export async function verifiedEmailStatus(user,deps){const {contact}=await verifiedNotificationIdentity(user.uid,deps);return {ok:true,verified:Boolean(contact),source:contact?.source||''};}
