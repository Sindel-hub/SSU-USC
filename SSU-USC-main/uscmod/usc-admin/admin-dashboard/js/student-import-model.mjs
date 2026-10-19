export const MAX_IMPORT_ROWS = 1000;
export const IMPORT_FIELDS = [
  ['lastName','Last Name',['last name','lastname','surname','family name']],
  ['firstName','First Name',['first name','firstname','given name','given names']],
  ['middleName','Middle Name',['middle name','middlename','middle initial','middle initials'],false],
  ['studentId','Student ID',['student id','student number','id number','school id','student id number']],
  ['institutionalEmail','Institutional email',['institutional email','email address','email','school email','ssu email']],
  ['college','College / campus',['college','campus','college campus','department']],
  ['program','Program / course',['program','course','degree program','degree','course program']],
  ['yearLevel','Year level',['year level','year','year standing']]
];
const key = v => String(v ?? '').normalize('NFKC').replace(/^\s*\d+\s*[.)-]\s*/, '').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export function detectColumns(headers) {
  const used = new Set(), mapping = {};
  for(const [field,,aliases] of IMPORT_FIELDS) {
    const i = headers.findIndex((header,index)=>!used.has(index) && aliases.includes(key(header)));
    mapping[field]=i < 0 ? '' : String(i); if(i>=0)used.add(i);
  }
  return mapping;
}
export function mapRows(matrix,mapping,defaults={}) {
  const used=Object.values(mapping).filter(v=>v!=='');
  if(new Set(used).size!==used.length) throw new Error('Map each column to only one field.');
  if(IMPORT_FIELDS.some(([field,,,required])=>required!==false && (mapping[field]===undefined || mapping[field]==='') && !defaults[field])) throw new Error('Map all required fields or select a default college, program and year.');
  const rows = matrix.slice(1).map((cells,i)=>({sourceRow:i+2,...Object.fromEntries(IMPORT_FIELDS.map(([field])=>[field,(mapping[field]===undefined || mapping[field]==='')?String(defaults[field]??''):String(cells[Number(mapping[field])]??'').trim()]))})).filter(row=>IMPORT_FIELDS.some(([field])=>mapping[field]!==undefined && mapping[field]!=='' && row[field]));
  if(!rows.length) throw new Error('The selected sheet has no student records.');
  if(rows.length>MAX_IMPORT_ROWS) throw new Error(`Import up to ${MAX_IMPORT_ROWS} rows per file.`);
  // Detect duplicates across every preview batch, before contacting the server.
  const ids=new Set(),emails=new Set(),names=new Set();
  return rows.map(parts=>{
    const row={...parts,fullName:[parts.firstName,parts.middleName,parts.lastName].filter(Boolean).join(' '),nameError:!parts.firstName || !parts.lastName?'Last Name and First Name are required.':''};
    const id=row.studentId.trim().replace(/[\s-]/g,''),email=row.institutionalEmail.toLowerCase(),name=row.fullName.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim();
    const duplicate=(id && ids.has(id)) || (email && emails.has(email)) || (name && names.has(name));
    if(id)ids.add(id);if(email)emails.add(email);if(name)names.add(name);
    return {...row,status:duplicate?'duplicate':'unchecked',message:duplicate?'Duplicate record in this file.':''};
  });
}
export function csvContent(headers, rows) {
  const cell=value=>{let v=String(value??'');if(/^[\s]*[=+@-]|^[\t\r\n]/.test(v))v="'"+v;return '"'+v.replace(/"/g,'""')+'"';};
  return '\uFEFF'+[headers,...rows].map(row=>row.map(cell).join(',')).join('\r\n');
}
export function importSummary(rows) {
  return rows.reduce((counts,row)=>{counts[row.status]=(counts[row.status]||0)+1;return counts;},{total:rows.length});
}

// Preserve the existing Firebase account schema; name columns are import inputs.
export function accountImportRow(row) {
  return Object.fromEntries(['fullName','studentId','institutionalEmail','college','program','yearLevel'].map(field=>[field,field==='fullName' && row.nameError?'':row[field]]));
}
