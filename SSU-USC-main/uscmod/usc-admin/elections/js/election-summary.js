// Presentation only: callers supply the existing aggregate turnout calculations.
export function mountElectionSummary(root, dialog) {
  const pie = root.querySelector('#electionParticipationPie');
  let returnFocus;
  function close() {
    dialog.close();
    if (returnFocus?.isConnected) returnFocus.focus();
  }
  root.querySelectorAll('[data-election-details]').forEach(button => button.addEventListener('click', () => {
    returnFocus = document.activeElement;
    if (!dialog.open) dialog.showModal();
    dialog.querySelector('.engagement-close').focus();
  }));
  dialog.querySelector('.engagement-close').addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
  });
  return {
    update({ ballots, eligible, percent, available, title, lifecycle, electionId }) {
      const valid = available && Number.isFinite(ballots) && Number.isFinite(eligible) && ballots >= 0 && eligible >= ballots;
      root.querySelector('#electionVotedCount').textContent = valid ? String(ballots) : '—';
      root.querySelector('#electionRemainingCount').textContent = valid ? String(eligible - ballots) : '—';
      root.querySelector('#electionEligibleCount').textContent = valid ? String(eligible) : '—';
      pie.classList.toggle('empty', !valid || eligible === 0);
      pie.style.background = valid && eligible > 0 ? `conic-gradient(#238b6b 0% ${percent}%, #d9e7f2 ${percent}% 100%)` : '';
      root.querySelector('.engagement-pie-button').setAttribute('aria-label', valid ? `${ballots} of ${eligible} eligible voters voted. View participation details` : 'Turnout data unavailable. View election details');
      root.querySelector('#electionSummaryPhase').textContent = `${title || 'USC Election'} · ${lifecycle || (electionId ? 'Phase unavailable' : 'Not configured')}${valid ? '' : ' · Turnout data unavailable'}`;
    }
  };
}
