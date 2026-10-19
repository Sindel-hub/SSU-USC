/* Parse untrusted workbooks off the UI thread; no formulas, HTML or macros are executed. */
importScripts('../../../vendor/sheetjs/xlsx.full.min.js');
onmessage = ({data}) => {
  try {
    const workbook = XLSX.read(data.bytes,{type:'array',sheetRows:1002,cellFormula:false,cellHTML:false,bookVBA:false});
    if(workbook.SheetNames.length>50)throw new Error('Choose a workbook with at most 50 sheets.');
    const name=data.sheet || workbook.SheetNames[0], sheet=workbook.Sheets[name];
    if(!sheet || !sheet['!ref'])throw new Error('The selected sheet is empty.');
    const range=XLSX.utils.decode_range(sheet['!fullref'] || sheet['!ref']);
    if(range.e.r>1000 || range.e.c>59)throw new Error('Use a sheet with at most 1,000 student rows and 60 columns.');
    const matrix=XLSX.utils.sheet_to_json(sheet,{header:1,raw:false,defval:'',blankrows:true});
    if(matrix.some(row=>row.some(value=>String(value).length>1000)))throw new Error('A cell exceeds 1,000 characters. Remove long answers or unrelated columns.');
    postMessage({names:workbook.SheetNames,name,matrix});
  } catch { postMessage({error:'The file could not be read. Use a valid CSV, XLS or XLSX with a header row, up to 1,000 students, 60 columns and 1,000 characters per cell.'}); }
};
