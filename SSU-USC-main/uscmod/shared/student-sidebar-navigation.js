// Keep the clicked item selected while normal link navigation continues.
document.querySelectorAll('.student-nav').forEach((nav) => {
  nav.addEventListener('click', (event) => {
    const link = event.target.closest('.student-nav-link');
    if (!link || !nav.contains(link)) return;
    nav.querySelectorAll('.student-nav-link').forEach((item) => {
      item.classList.toggle('active', item === link);
    });
  });
});
