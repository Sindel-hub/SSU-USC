import { studentRecordCall } from '../shared/student-records-client.js';
const $=id=>document.getElementById(id);
const token=new URLSearchParams(location.hash.slice(1)).get('token');
history.replaceState(null,'',location.pathname);
function message(text,error=false){$('activationMessage').textContent=text;$('activationMessage').dataset.error=error;}
if(!/^[a-f0-9]{64}$/.test(token||'')){$('activationForm').hidden=true;message('This activation link is invalid. Ask the administrator for a new link.',true);}
$('activationForm').onsubmit=async event=>{
 event.preventDefault();const password=$('activationPassword').value;
 if(password!==$('activationConfirm').value)return message('Passwords do not match.',true);
 $('activationSubmit').disabled=true;message('Verifying your email and activating…');
 try{const r=await studentRecordCall('studentActivateAccount',{token,password});$('activationForm').hidden=true;$('activationPassword').value='';$('activationConfirm').value='';message(r.canAccess?'Your email is verified and your account is activated. You can now sign in.':'Your email is verified and password is set. Your academic/account status currently prevents portal access. Contact USC for assistance.');$('activationDone').hidden=false;}
 catch(error){message(error.message,true);}finally{$('activationSubmit').disabled=false;}
};
