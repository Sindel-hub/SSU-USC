export const IMPORT_HEADERS = ['Student ID','Last Name','First Name','Middle Name','Suffix','College Department','Course / Program','Year Level','Enrollment Status','Institution Email (Optional)','Student Status'];
const fields = ['studentId','lastName','firstName','middleName','suffix','department','program','yearLevel','enrollmentStatus','email','studentStatus'];
const aliases = Object.fromEntries(IMPORT_HEADERS.map((header, index) => [headerKey(header), fields[index]]));
function headerKey(value) {
  return String(value ?? '').replace(/^\uFEFF/,'').trim().toLowerCase();
}
export function rowsFromTable(table) {
  if (!Array.isArray(table) || table.length < 2) throw Error('The file needs a header and at least one student.');
  const headers=table[0].map(v=>aliases[headerKey(v)]);
  if (headers.some(h=>!h)||new Set(headers).size!==headers.length) throw Error('Use the template columns; duplicate or unknown headers are not allowed.');
  if (![fields.length-1,fields.length].includes(headers.length) || headers.some((header,index) => header !== fields[index])) throw Error('Use all template columns in the listed order.');
  const rows=table.slice(1).filter(row=>row.some(v=>String(v??'').trim())).map((values,i)=>{
    if(values.length>headers.length&&values.slice(headers.length).some(v=>String(v??'').trim()))throw Error(`Row ${i+2} has extra columns.`);
    return Object.fromEntries(headers.map((h,j)=>[h,String(values[j]??'').trim()]));
  });
  if(!rows.length||rows.length>500)throw Error('Import between 1 and 500 students at a time.');
  return rows;
}
export function parseStudentCsv(text) {
  if(typeof text!=='string'||text.length>2*1024*1024)throw Error('CSV files must be no larger than 2 MB.');
  text=text.replace(/^\uFEFF/,'');
  const table=[];let row=[],cell='',quoted=false,closed=false;
  const push=()=>{row.push(cell);cell='';closed=false;};
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;continue;}
    if(c==='"'){if(cell||closed)throw Error('Malformed CSV quotation.');quoted=true;continue;}
    if(c===','){push();continue;}
    if(c==='\r'||c==='\n'){if(c==='\r'&&text[i+1]==='\n')i++;push();table.push(row);row=[];continue;}
    if(closed&&c!==' '&&c!=='\t')throw Error('Unexpected text after a quoted CSV field.');
    if(!closed)cell+=c;
  }
  if(quoted)throw Error('Unclosed CSV quotation.');
  if(cell||row.length||closed){push();table.push(row);}
  return rowsFromTable(table);
}
// Inspect ZIP metadata before decompression to bound spreadsheet expansion.
export function validateWorkbookZip(buffer) {
  const bytes=new Uint8Array(buffer),v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(bytes.length>2*1024*1024||bytes.length<22)throw Error('Excel files must be valid .xlsx files no larger than 2 MB.');
  let end=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(v.getUint32(i,true)===0x06054b50){end=i;break;}
  if(end<0)throw Error('Invalid Excel workbook.');
  const count=v.getUint16(end+10,true);let pos=v.getUint32(end+16,true),total=0;
  if(!count||count>200)throw Error('Workbook has too many internal files.');
  for(let n=0;n<count;n++){
    if(pos+46>bytes.length||v.getUint32(pos,true)!==0x02014b50)throw Error('Invalid workbook directory.');
    total+=v.getUint32(pos+24,true);if(total>20*1024*1024)throw Error('Workbook expands beyond the 20 MB safety limit.');
    pos+=46+v.getUint16(pos+28,true)+v.getUint16(pos+30,true)+v.getUint16(pos+32,true);
  }
}
export async function readStudentWorkbook(buffer,ExcelJS) {
  if(!ExcelJS?.Workbook)throw Error("The Excel reader is not ready. Please retry, or use CSV.");
  validateWorkbookZip(buffer);
  const book=new ExcelJS.Workbook();await book.xlsx.load(buffer);
  const sheet=book.worksheets[0];if(!sheet||sheet.rowCount>501||sheet.columnCount>20)throw Error('Use the first sheet, at most 500 students, and the template columns.');
  let idColumn=0;sheet.getRow(1).eachCell((cell,c)=>{if(aliases[headerKey(cell.text)]==='studentId')idColumn=c;});
  const table=[];sheet.eachRow({includeEmpty:true},row=>{
    const values=[];for(let c=1;c<=sheet.columnCount;c++){
      const cell=row.getCell(c);if(cell.value&&typeof cell.value==='object'&&('formula'in cell.value||'sharedFormula'in cell.value))throw Error('Replace formulas with text values before importing.');
      if(c===idColumn&&row.number>1&&typeof cell.value==='number')throw Error('Student IDs in Excel must be stored as text to preserve leading zeros.');
      values.push(cell.text);
    }table.push(values);
  });return rowsFromTable(table);
}
