import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
export const {createStudentImportService}=require('../functions/student-import.js');
export class HttpsError extends Error {constructor(code,message){super(message);this.code=code;}}
export function productionDependencies(db,adminAuth,FieldValue){
 const source=fs.readFileSync(new URL('../functions/index.js',import.meta.url),'utf8');
 const names=['cleanText','normalizeEmail','requireAuth','roleOf','requireRole','requireActiveRole','requireRecentAuth','requireVerifiedAdminEmail','generateTemporaryPassword','auditSafe','auditData'];
 const context=vm.createContext({db,adminAuth,FieldValue,HttpsError,crypto});
 for(const name of names){const regex=new RegExp(`(?:async )?function ${name}\\(`),start=source.search(regex);if(start<0)throw Error(name);const end=source.indexOf('\n}',start)+2;vm.runInContext(source.slice(start,end),context);}
 return {...Object.fromEntries(names.map(name=>[name,vm.runInContext(name,context)])),db,adminAuth,FieldValue,HttpsError};
}
export const validRow=(id=123456)=>({studentId:String(id),fullName:`Student ${id}`,institutionalEmail:`student${id}@example.edu`,college:'College of Education',program:'Bachelor of Elementary Education',yearLevel:'1st Year'});
