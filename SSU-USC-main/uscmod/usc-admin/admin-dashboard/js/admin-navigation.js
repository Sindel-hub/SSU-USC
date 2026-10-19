// Admin navigation uses its own state instead of the officer shell's .open class.
const toggle=document.querySelector('.admin-mobile-menu-btn');
const sidebar=document.querySelector('.sidebar');
const backdrop=document.querySelector('.sidebar-backdrop');
if(toggle && sidebar && backdrop){
  const mobile=window.matchMedia('(max-width:900px)');
  const content=document.querySelector('.main');
  let open=false,previousInert=false;
  document.body.classList.add('admin-navigation-ready');
  toggle.removeAttribute('onclick');
  backdrop.removeAttribute('onclick');
  const closeButton=document.createElement('button');
  closeButton.type='button';closeButton.className='admin-navigation-close';
  closeButton.setAttribute('aria-label','Close admin navigation');
  closeButton.textContent='×';sidebar.prepend(closeButton);
  function setOpen(value,{restoreFocus=true}={}){
    const wasOpen=open;open=Boolean(value && mobile.matches);
    sidebar.classList.toggle('mobile-open',open);
    sidebar.classList.remove('open');
    backdrop.classList.toggle('active',open);
    backdrop.hidden=!open;
    sidebar.inert=mobile.matches && !open;
    sidebar.setAttribute('aria-hidden',String(mobile.matches && !open));
    toggle.setAttribute('aria-expanded',String(open));
    toggle.setAttribute('aria-label',open?'Close admin navigation':'Open admin navigation');
    document.documentElement.classList.toggle('admin-navigation-open',open);
    if(content){
      if(open && !wasOpen){previousInert=content.inert;content.inert=true;}
      if(!open && wasOpen)content.inert=previousInert;
    }
    if(open && !wasOpen)closeButton.focus();
    else if(!open && wasOpen && restoreFocus && mobile.matches)toggle.focus();
    else if(!open && wasOpen && !mobile.matches)sidebar.querySelector('a')?.focus();
  }
  toggle.addEventListener('click',()=>setOpen(!open));
  closeButton.addEventListener('click',()=>setOpen(false));
  backdrop.addEventListener('click',()=>setOpen(false));
  sidebar.addEventListener('click',event=>{if(event.target.closest('a[href],.logout-btn'))setOpen(false,{restoreFocus:false});});
  mobile.addEventListener('change',()=>setOpen(false));
  document.addEventListener('usc:settings-open',()=>setOpen(false,{restoreFocus:false}));
  document.addEventListener('keydown',event=>{
    if(!open)return;
    if(event.key==='Escape'){event.preventDefault();setOpen(false);return;}
    if(event.key!=='Tab')return;
    const controls=[...sidebar.querySelectorAll('a[href],button:not(:disabled),[tabindex="0"]')].filter(e=>e.getClientRects().length);
    const first=controls[0],last=controls.at(-1);
    if(event.shiftKey && document.activeElement===first){event.preventDefault();last?.focus();}
    else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first?.focus();}
  });
  setOpen(false,{restoreFocus:false});
}
