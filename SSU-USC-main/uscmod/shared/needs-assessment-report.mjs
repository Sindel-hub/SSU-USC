export function summarize(survey, responses, department = '') {
  const rows = department ? responses.filter(r => r.department === department) : responses;
  return { total: rows.length, departments: survey.departments.map(name => ({ name, count: rows.filter(r => r.department === name).length })), questions: survey.questions.map(q => {
    const values = rows.map(r => r.answers[q.id]).filter(v => v !== undefined);
    return { ...q, answered: values.length, average: q.type === 'rating' && values.length ? values.reduce((a,b) => a+b,0)/values.length : null, counts: (q.type === 'rating' ? [1,2,3,4,5] : q.options).map(option => ({ option, count: values.filter(v => Array.isArray(v) ? v.includes(option) : v === option).length })), texts: q.type === 'text' ? values : [] };
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
