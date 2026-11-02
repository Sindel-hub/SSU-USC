// A targeted extension changes only voting end and a conflicting results window.
export function extendVotingSchedule(schedule, previousVotingEnd) {
  const millis=value=>typeof value==='number'?value:new Date(value).getTime();
  const end=millis(schedule.votingEnd), previous=millis(previousVotingEnd), start=millis(schedule.votingStart);
  const resultStart=millis(schedule.resultPublicationStart),resultEnd=millis(schedule.resultPublicationEnd);
  if (![end,previous,start,resultStart,resultEnd].every(Number.isFinite)) throw new Error('Complete the voting and result-publication dates first.');
  if(end<=previous || end<=start)throw new Error('Choose a Voting Until time later than the current closing time.');
  if(resultEnd<=resultStart)throw new Error('Result publication must end after it starts.');
  const shift=Math.max(0,end-resultStart);
  return {...schedule,votingEnd:new Date(end).toISOString(),resultPublicationStart:new Date(resultStart+shift).toISOString(),resultPublicationEnd:new Date(resultEnd+shift).toISOString()};
}
