import { db } from "../../../firebase/firebase-config.js";
import { collection, getDocs, onSnapshot } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
if (await (globalThis.USC_AUTH_READY || Promise.resolve(false)) === true) {
  const list = document.getElementById("candidateReviewList");
  if (list) {
    const button = document.createElement("button");button.type="button";button.textContent="View applications by election";button.className="btn";list.before(button);
    const esc = value => String(value ?? "").replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
    button.addEventListener("click", async () => {
      const dialog=document.createElement("dialog");dialog.style.cssText="width:min(740px,90vw);max-height:80vh;overflow:auto;border:1px solid #c5dbea;border-radius:18px;padding:24px;background:white;color:#194c80";
      dialog.innerHTML='<button type="button" style="float:right" aria-label="Close history">×</button><h2>Applications by election</h2><label>Election <select aria-label="Election"><option>Loading…</option></select></label><div role="status">Loading elections…</div>';
      document.body.append(dialog);dialog.showModal();let stop=null;
      dialog.querySelector('button').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{stop?.();dialog.remove()},{once:true});
      const select=dialog.querySelector('select'),body=dialog.querySelector('[role="status"]');
      try {
        const elections=await getDocs(collection(db,'elections'));if(!dialog.open)return;
        select.innerHTML='<option value="">Choose an election</option>'+elections.docs.map(d=>`<option value="${esc(d.id)}">${esc(d.data().title||d.id)} · ${esc(d.id)}</option>`).join('');body.textContent='Select an election to view its applications. Historical records are read-only.';
        select.onchange=()=>{stop?.();if(!select.value){body.textContent='Select an election.';return}const id=select.value;body.textContent='Loading applications…';stop=onSnapshot(collection(db,'elections',id,'applications'),snap=>{if(select.value!==id)return;body.innerHTML=snap.empty?'No applications for this election.':snap.docs.map(d=>`<article style="padding:14px 0;border-bottom:1px solid #dce8f1"><strong>${esc(d.data().fullName||d.data().studentId||d.id)}</strong><p>${esc(d.data().position)} · ${esc(d.data().status||'Under Review')}</p></article>`).join('')},()=>{body.textContent='Unable to load this election’s applications.'});};
      } catch {body.textContent='Unable to load election history.';}
    });
  }
}
