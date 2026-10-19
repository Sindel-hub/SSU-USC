import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile, deleteUser, signOut } from 'firebase/auth';
import * as firestore from 'firebase/firestore';
import * as standing from '../shared/student-standing.js';
import * as permissions from '../shared/officer-permissions.js';
import * as display from '../shared/account-email.js';
import { createInstitutionalAccountService } from '../supabase/functions/usc-email/institutional-accounts.mjs';
import { initializeApp as initializeAdminApp, deleteApp as deleteAdminApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
const projectId='demo-ssu-registration';
const strip=source=>source.replace(/import\s+[\s\S]*?from\s+["'][^"']+["'];/g,'').replace(/export /g,'');
let env,adminApp,adminDb,adminAuth;
before(async()=>{
  env=await initializeTestEnvironment({projectId,firestore:{rules:fs.readFileSync(new URL('../firestore.rules',import.meta.url),'utf8')}});
  adminApp=initializeAdminApp({projectId},'optional-email-test');adminDb=getAdminFirestore(adminApp);adminAuth=getAdminAuth(adminApp);
});
after(async()=>{await env?.cleanup();if(adminApp)await deleteAdminApp(adminApp);});

test('real Firebase account: manual no-email creation, Student ID login, verified institutional alias, and password recovery all preserve UID',async()=>{
  await env.clearFirestore();
  await adminDb.doc('users/admin').set({uid:'admin',role:'admin',accountStatus:'approved',isActive:true});
  const db=env.authenticatedContext('admin',{role:'admin'}).firestore();
  const apps=[];
  const provisionBindings={...firestore,...standing,...permissions,db,firebaseConfig:{projectId,apiKey:'fake-api-key'},
    auth:{currentUser:{uid:'admin',email:'admin@ssu.edu.ph',getIdTokenResult:async()=>({claims:{role:'admin'}})}},
    initializeApp:(config,name)=>{const app=initializeApp(config,name);apps.push(app);return app;},deleteApp,
    getAuth:app=>{const auth=getAuth(app);connectAuthEmulator(auth,`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`,{disableWarnings:true});return auth;},
    createUserWithEmailAndPassword,updateProfile,deleteUser,signOut,sendEmailVerification:async()=>{},sendPasswordResetEmail:async()=>{}
  };
  const provisioning=strip(fs.readFileSync(new URL('../shared/browser-provisioning.js',import.meta.url),'utf8'));
  const provision=new Function(...Object.keys(provisionBindings),`${provisioning};return provisionStudentAccount;`)(...Object.values(provisionBindings));
  const result=await provision({studentId:'567891',fullName:'Real Emulator Student',institutionalEmail:'',college:'College of Education',program:'Bachelor of Elementary Education',yearLevel:'1st Year',studentStanding:'active',eligible:true});
  const {uid,temporaryPassword}=result.credential;
  const app=initializeApp({projectId,apiKey:'fake-api-key'},'login-optional-email');apps.push(app);
  const auth=getAuth(app);connectAuthEmulator(auth,`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`,{disableWarnings:true});
  const storage=new Map();
  const bindings={...display,...standing,auth,db:env.unauthenticatedContext().firestore(),...firestore,signInWithEmailAndPassword,signOut,
    document:{getElementById:()=>null},sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    location:{},openSupabaseRecoveryPage:()=>{},window:{location:{pathname:'/index/index.html'}},alert:()=>{}
  };
  const loginSource=strip(fs.readFileSync(new URL('../index/js/index.js',import.meta.url),'utf8'));
  const login=new Function(...Object.keys(bindings),`${loginSource};return {signInByIdentifier,buildSession};`)(...Object.values(bindings));
  const first=await login.signInByIdentifier('567891',temporaryPassword);assert.equal(first.user.uid,uid);
  const before=(await adminDb.doc('users/'+uid).get()).data();assert.equal(before.institutionalEmail,null);
  assert.equal(login.buildSession(before,{}).email,'');
  let sentToken='';
  const deps={
    now:()=>Date.now(),sha256:async value=>createHash('sha256').update(value).digest('hex'),randomToken:()=>randomBytes(32).toString('hex'),
    activeProfile:data=>data?.schoolProvisioned&&data.role==='student'&&data.isActive&&data.accountStatus==='approved',
    get:async path=>{const snapshot=await adminDb.doc(path).get();return snapshot.exists?{data:snapshot.data(),version:snapshot.updateTime}:null;},
    commit:async operations=>{const batch=adminDb.batch();for(const operation of operations){const ref=adminDb.doc(operation.path);if(operation.remove)batch.delete(ref,{lastUpdateTime:operation.version});else if(operation.version)batch.update(ref,operation.data,{lastUpdateTime:operation.version});else batch.create(ref,operation.data);}await batch.commit();},
    authUser:uid=>adminAuth.getUser(uid),
    authByEmail:async email=>{try{return await adminAuth.getUserByEmail(email);}catch(error){if(error.code==='auth/user-not-found')return null;throw error;}},
    sendVerification:async(email,token)=>{assert.equal(email,'student@ssu.edu.ph');sentToken=token;},
    resetAuthPassword:async(uid,password,time)=>{await adminAuth.updateUser(uid,{password});await adminAuth.revokeRefreshTokens(uid);}
  };
  const service=createInstitutionalAccountService(deps),actor={uid,email:first.user.email,authTime:Date.now()/1000};
  await service.request(actor,'student@ssu.edu.ph');
  await assert.rejects(login.signInByIdentifier('student@ssu.edu.ph',temporaryPassword));
  await service.verify(actor,sentToken);
  for(const identifier of ['567891','student@ssu.edu.ph']){
    const credential=await login.signInByIdentifier(identifier,temporaryPassword);assert.equal(credential.user.uid,uid);
  }
  const linked=(await adminDb.doc('users/'+uid).get()).data();
  assert.equal(linked.institutionalEmailVerified,true);assert.equal(linked.role,before.role);assert.equal(linked.studentId,before.studentId);
  assert.equal((await adminAuth.getUser(uid)).email,'567891@student.ssu-usc.local');
  await assert.rejects(adminAuth.getUserByEmail('student@ssu.edu.ph'),error=>error.code==='auth/user-not-found');
  const reset=await service.resetPassword({uid:'admin',role:'admin',authTime:Date.now()/1000},uid);
  for(const identifier of ['567891','student@ssu.edu.ph']){
    const credential=await login.signInByIdentifier(identifier,reset.temporaryPassword);assert.equal(credential.user.uid,uid);
  }
  await assert.rejects(login.signInByIdentifier('567891',temporaryPassword));
  const current=(await adminDb.doc('users/'+uid).get()).data();assert.ok(!JSON.stringify(current).includes(reset.temporaryPassword));
  for(const app of apps)try{await deleteApp(app);}catch{}
});
