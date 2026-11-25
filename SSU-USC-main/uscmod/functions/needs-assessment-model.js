"use strict";
const DEPARTMENTS = Object.freeze(['College of Education', 'College of Arts and Sciences', 'College of Nursing and Health Sciences', 'College of Engineering', 'College of Industrial Technology']);
function fail(message) { const e = new Error(message); e.code = 'invalid-argument'; throw e; }
function text(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(`${label} is required (maximum ${max} characters).`);
  return value.trim();
}
function validateSurvey(input) {
  if (!input || typeof input !== 'object') fail('Survey is required.');
  const title = text(input.title, 160, 'Title');
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  if (description.length > 3000) fail('Description is too long.');
  if (!Array.isArray(input.departments)) fail("Select target departments.");
  const departments = [...new Set(input.departments)];
  if (!departments.length || departments.some(d => !DEPARTMENTS.includes(d))) fail('Select valid target departments.');
  const opensAt = Number(input.opensAt), closesAt = Number(input.closesAt);
  if (!Number.isFinite(opensAt) || !Number.isFinite(closesAt) || opensAt <= 0 || closesAt <= opensAt) fail('Closing time must follow the opening time.');
  if (!Array.isArray(input.questions) || !input.questions.length || input.questions.length > 30) fail('Add between 1 and 30 questions.');
  const sections = input.sections == null ? [{id:'s1',title:'',description:''}] : input.sections;
  if (!Array.isArray(sections) || sections.length < 1 || sections.length > 20) fail('Add 1–20 sections.');
  const optional = (v,max) => { if (v == null) return ''; if(typeof v !== 'string' || v.length>max) fail('Invalid text.'); return v.trim(); };
  const rich = v => optional(v,12000);
  const normalizedSections=sections.map(s=>{
    if(!s || typeof s.id!=='string'||!/^s[a-zA-Z0-9-]{1,60}$/.test(s.id))fail('Invalid section ID.');
    return {id:s.id,title:optional(s.title,300),description:optional(s.description,3000),titleRich:rich(s.titleRich),descriptionRich:rich(s.descriptionRich)};
  });
  const ids=normalizedSections.map(s=>s.id);
  if(new Set(ids).size!==ids.length)fail('Duplicate sections.');
  const choices=(v,label)=>{if(!Array.isArray(v)||v.length<2||v.length>15)fail(label+' needs 2–15 values.');const arr=v.map(x=>text(x,150,label));if(new Set(arr).size!==arr.length||arr.some(x=>x.startsWith('__other:')))fail('Use distinct options.');return arr;};
  const questions = input.questions.map((q, i) => {
    if (!q || typeof q !== 'object') fail('Invalid question.');
    const id = `q${i + 1}`, label = text(q.label, 300, 'Question');
    const types=['single','multiple','rating','text','paragraph','dropdown','scale','grid','checkgrid','date','time'];
    if(!types.includes(q.type))fail('Unknown question type.');
    const choice=['single','multiple','dropdown','grid','checkgrid'].includes(q.type);
    const options=choice?choices(q.options,'Choice'):[], rows=['grid','checkgrid'].includes(q.type)?choices(q.rows,'Row'):[];
    const sectionId=q.sectionId||ids[0];if(!ids.includes(sectionId))fail('Unknown section.');
    const min=q.type==='scale'?(q.min??1):1,max=['scale','rating'].includes(q.type)?(q.max??5):5;
    if(!Number.isInteger(min)||!Number.isInteger(max)||![0,1].includes(min)||max<3||max>10)fail('Invalid scale.');
    const branches={};
    if(['single','dropdown'].includes(q.type)&&q.branches&&typeof q.branches==='object'){
      for(let n=0;n<options.length;n++){const dest=q.branches[n];if(dest){if(dest!=='end'&&ids.indexOf(dest)<=ids.indexOf(sectionId))fail('Navigation must move forward.');branches[n]=dest;}}
    }
    return {id,label,type:q.type,required:q.required!==false,options,rows,sectionId,min,max,minLabel:optional(q.minLabel,100),maxLabel:optional(q.maxLabel,100),other:['single','multiple','dropdown'].includes(q.type)&&q.other===true,branches,description:optional(q.description,1000),labelRich:rich(q.labelRich),descriptionRich:rich(q.descriptionRich)};
  });
  if(normalizedSections.some(s=>!questions.some(q=>q.sectionId===s.id)))fail('Each section needs at least one question.');
  return {title,description,departments,opensAt,closesAt,questions,sections:normalizedSections,titleRich:rich(input.titleRich),descriptionRich:rich(input.descriptionRich)};
}

function surveyStatus(s, now = Date.now()) {
  if (s.status !== 'published') return s.status;
  return now < s.opensAt ? 'scheduled' : now >= s.closesAt ? 'closed' : 'open';
}
function validateResponse(survey, input, now = Date.now()) {
  if (surveyStatus(survey, now) !== 'open') fail('This survey is not accepting responses.');
  if (!survey.departments.includes(input?.department)) fail('Select a department targeted by this survey.');
  if (!input.answers || typeof input.answers !== 'object' || Array.isArray(input.answers)) fail('Answers are required.');
  if (Object.keys(input.answers).some(id => !survey.questions.some(q => q.id === id))) fail('Unexpected question.');
  const answers = {};
  const sections=survey.sections?.length?survey.sections:[{id:'s1'}];
  const ids=sections.map(s=>s.id);
  const validChoice=(q,v)=>typeof v==='string'&&(q.options.includes(v)||(q.other===true&&v.startsWith('__other:')&&v.slice(8).trim().length>0&&v.length<=308));
  let index=0;
  while(index<sections.length){
    let next=index+1,branched=false;
    for(const q of survey.questions.filter(q=>(q.sectionId||ids[0])===ids[index])){
      const v=input.answers[q.id];
      const blank=v===undefined||v===null||v===''||(Array.isArray(v)&&!v.length);
      if(blank){if(q.required)fail('Answer: '+q.label);continue;}
      if(['text','paragraph'].includes(q.type))answers[q.id]=text(v,2000,q.label);
      else if(['rating','scale'].includes(q.type)){if(!Number.isInteger(v)||v<(q.min??1)||v>(q.max??5))fail('Invalid rating.');answers[q.id]=v;}
      else if(['single','dropdown'].includes(q.type)){if(!validChoice(q,v))fail('Invalid choice.');answers[q.id]=v;const dest=q.branches?.[q.options.indexOf(v)];if(dest&&!branched){next=dest==='end'?sections.length:ids.indexOf(dest);if(next<=index)fail('Invalid navigation.');branched=true;}}
      else if(q.type==='multiple'){if(!Array.isArray(v)||!v.length||v.length>q.options.length+(q.other?1:0)||new Set(v).size!==v.length||v.some(x=>!validChoice(q,x))||v.filter(x=>x.startsWith('__other:')).length>1)fail('Invalid choices.');answers[q.id]=v;}
      else if(['grid','checkgrid'].includes(q.type)){if(!v||typeof v!=='object'||Array.isArray(v))fail('Invalid grid.');const result={};for(const [key,val] of Object.entries(v)){if(!/^(0|[1-9][0-9]*)$/.test(key)||+key>=q.rows.length)fail('Invalid row.');const nums=q.type==='grid'?[val]:val;if(!Array.isArray(nums)||!nums.length||new Set(nums).size!==nums.length||nums.some(n=>!Number.isInteger(n)||n<0||n>=q.options.length))fail('Invalid grid choice.');result[key]=val;}if(q.required&&Object.keys(result).length!==q.rows.length)fail('Complete all rows.');answers[q.id]=result;}
      else if(q.type==='date'){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)fail('Invalid date.');answers[q.id]=v;}
      else if(q.type==='time'){if(typeof v!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(v))fail('Invalid time.');answers[q.id]=v;}
      else fail('Unknown question type.');
    }
    index=next;
  }
  return { department: input.department, answers };
}

module.exports = { DEPARTMENTS, validateSurvey, validateResponse, surveyStatus };
