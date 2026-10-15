const test=require('node:test');
const assert=require('node:assert/strict');
const ExcelJS=require('exceljs');
const {configureStatementPrint}=require('../services/statementPrintLayout');
const values = sheet => { const result=[]; sheet.eachRow(row=>row.eachCell(cell=>{if(cell.value!=null)result.push([cell.address,cell.value]);})); return result; };
function fixture(count=12,long=false){
  const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('Monthly School Account');
  sheet.mergeCells('A4:L4');sheet.getCell('A4').value='HARMONY LEARNING INSTITUTE';
  sheet.getRow(20).values=['Year','Month','Service Charges','Gross Charges','Discounts','Net Due','Allocated Payments','Outstanding','Credit','Status','Review Flags','Reference'];
  for(let n=0;n<count;n++)sheet.getRow(21+n).values=[2026,'September',long?'Boarding with included services and additional transport; '.repeat(10):'Tuition: R 2350.00',2350,0,2350,1500,850,0,'Partial','No review flags','TEST501'];
  return {workbook,sheet};
}
test('normal annual statements have an exact one-page A4 print area and unchanged data',async()=>{
  const {workbook,sheet}=fixture();const before=values(sheet);
  configureStatementPrint(sheet,{headerRow:20,lastRow:32,historyRows:12});
  assert.deepEqual(values(sheet),before);assert.equal(sheet.pageSetup.fitToWidth,1);assert.equal(sheet.pageSetup.fitToHeight,1);
  assert.equal(sheet.pageSetup.printArea,'A1:L32');assert.equal(sheet.pageSetup.orientation,'landscape');
  const saved=await workbook.xlsx.writeBuffer();const reloaded=new ExcelJS.Workbook();await reloaded.xlsx.load(saved);
  const after=reloaded.getWorksheet(1);assert.equal(after.pageSetup.printArea,'A1:L32');assert.equal(after.pageSetup.fitToHeight,1);
  assert.equal(after.getCell('G21').value,1500);assert.equal(after.getCell('H21').value,850);assert.equal(after.getRow(20).getCell(7).alignment.wrapText,true);
});
test('long histories and lengthy invoice text can continue without truncation',()=>{
  for(const [count,long] of [[36,false],[12,true]]){
    const {sheet}=fixture(count,long),before=values(sheet);configureStatementPrint(sheet,{headerRow:20,lastRow:20+count,historyRows:count});
    assert.equal(sheet.pageSetup.fitToHeight,0);assert.deepEqual(values(sheet),before);assert.ok(sheet.getRow(21).height>=22);
  }
});
