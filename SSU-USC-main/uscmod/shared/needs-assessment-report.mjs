export function summarize(survey, responses, department = '') {
  const rows = department ? responses.filter(r => r.department === department) : responses;
  return { total: rows.length, departments: survey.departments.map(name => ({ name, count: rows.filter(r => r.department === name).length })), questions: survey.questions.map(q => {
    const values = rows.map(r => r.answers[q.id]).filter(v => v !== undefined);
    const numeric=['rating','scale'].includes(q.type);
    const grid=['grid','checkgrid'].includes(q.type);
    const opts=numeric?Array.from({length:(q.max??5)-(q.min??1)+1},(_,i)=>i+(q.min??1)):(q.options||[]);
    const counts=grid?(q.rows||[]).flatMap((row,i)=>opts.map((option,j)=>({option:row+' / '+option,count:values.filter(v=>Array.isArray(v?.[i])?v[i].includes(j):v?.[i]===j).length}))):opts.map(option=>({option,count:values.filter(v=>Array.isArray(v)?v.includes(option):v===option).length}));
    if(q.other)counts.push({option:'Other',count:values.filter(v=>(Array.isArray(v)?v:[v]).some(x=>typeof x==='string'&&x.startsWith('__other:'))).length});
    const texts=['text','paragraph','date','time'].includes(q.type)?values:values.flatMap(v=>(Array.isArray(v)?v:[v]).filter(x=>typeof x==='string'&&x.startsWith('__other:')).map(x=>x.slice(8)));
    return {...q,answered:values.length,average:numeric&&values.length?values.reduce((a,b)=>a+b,0)/values.length:null,counts,texts};
  }) };
}
export function csv(rows) {
  return '\uFEFF' + rows.map(row => row.map(value => {
    let s = String(value ?? '');
    if (/^[\s]*[=+@\-]/.test(s) || /^[\t\r\n]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  }).join(',')).join('\r\n');
}
export function summaryRows(report) {
  return [['Section','Question / Department','Option','Count / Value'],['Responses','Total','',report.total],...report.departments.map(d => ['Department',d.name,'',d.count]),...report.questions.flatMap(q => [['Answered',q.label,'',q.answered],...(q.average === null ? [] : [['Average rating',q.label,'',q.average.toFixed(2)]]),...q.counts.map(c => ['Choice',q.label,c.option,c.count]),...q.texts.map(t => ['Text response',q.label,t,''])])];
}
