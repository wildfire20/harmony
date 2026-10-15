// Presentation only. Values and the ledger projection are owned by the exporter.
function configureStatementPrint(worksheet, { headerRow, lastRow, historyRows }) {
  worksheet.columns = [22,16,26,12,10,12,12,12,10,13,17,14].map(width=>({width}));
  const header=worksheet.getRow(headerRow);
  header.height=30;
  header.eachCell(cell=>{cell.alignment={...cell.alignment,vertical:'middle',wrapText:true};});
  for(let r=headerRow+1;r<=lastRow;r++){
    const row=worksheet.getRow(r);
    let lines=1;
    for(const [column,characters] of [[2,16],[3,26],[10,13],[11,17],[12,14]]){
      const value=String(row.getCell(column).value??'');
      lines=Math.max(lines,value.split('\n').reduce((count,line)=>count+Math.max(1,Math.ceil(line.length/characters)),0));
    }
    row.height=Math.max(22,lines*12+6);
    row.eachCell(cell=>{cell.alignment={...cell.alignment,vertical:'middle',wrapText:true};});
  }
  let height=0;
  for(let r=1;r<=lastRow;r++)height+=worksheet.getRow(r).height||15;
  worksheet.pageSetup={
    paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,
    // Long histories retain legible row heights and may continue on more pages.
    fitToHeight:historyRows<=14&&height<=720?1:0,
    printArea:`A1:L${lastRow}`,printTitlesRow:`${headerRow}:${headerRow}`,
    margins:{left:0.3,right:0.3,top:0.35,bottom:0.35,header:0.15,footer:0.15},
  };
}
module.exports={configureStatementPrint};
