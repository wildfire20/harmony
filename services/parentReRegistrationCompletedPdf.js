const fs = require('node:fs/promises');
const path = require('node:path');
const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const definition = require('../client/src/data/reRegistration2027.json');
const { primary, preschool } = require('./parentReRegistrationPolicy');

const ink = rgb(.08, .12, .18);
const labels = Object.fromEntries(definition.sections.flatMap(section => section.fields).map(field => [field.key, field.label]));
const layouts = {
  primary: { file: 'Harmony_2027_Grades_1_7_Re_registration_Form.pdf', fields: {
    learner_full_name: [35,207,258], learner_reference: [303,207,257], current_grade: [35,235,230],
    grade_applied_for: [277,235,265], parent_full_name: [35,306,510], parent_mobile: [35,334,230],
    parent_whatsapp: [277,334,265], physical_address: [141,354,410,2], nonreturn_reason: [105,449,445],
  }, gender: [340,414,257], returning: [36,407,428], signature: [35,637,176,235,456] },
  preschool: { file: 'Harmony_2027_Preschool_Re_registration_Form.pdf', fields: {
    learner_full_name: [39,184,338], learner_reference: [396,184,150], current_grade: [39,213,240],
    grade_applied_for: [302,213,242], parent_full_name: [39,290,310], parent_mobile: [373,290,170],
    parent_whatsapp: [39,319,500], physical_address: [135,343,410,2], nonreturn_reason: [39,428,505],
  }, gender: [360,431,225], returning: [40,394,410], signature: [40,612,178,235,462] },
};
const displayValue = value => typeof value === 'string' ? value : JSON.stringify(value, null, 2);
const dateTime = value => new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg',
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value));
const date = value => dateTime(value).split(',')[0];

async function createCompleted(record) {
  const form = record.form;
  const grade = form.grade_applied_for || form.current_grade || '';
  const category = primary(grade) ? 'primary' : preschool(grade) ? 'preschool' : null;
  const layout = record.definition_version === 2 && category ? layouts[category] : null;
  const pdf = layout ? await PDFDocument.load(await fs.readFile(path.join(__dirname,'..','assets','forms',layout.file))) : await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(await fs.readFile(path.join(__dirname,'..','assets','fonts','DejaVuSans.ttf')));
  const supported = new Set(font.getCharacterSet());
  const safe = value => Array.from(String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').replace(/\t/g,' '))
    .map(character => supported.has(character.codePointAt(0)) || character==='\n' || character==='\r' ? character : `[U+${character.codePointAt(0).toString(16).toUpperCase()}]`).join('');
  const wrap = (value, width, size) => {
    const lines = [];
    for (const paragraph of safe(value).replace(/\r\n?/g,'\n').split('\n')) {
      let line = '';
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        if (line && font.widthOfTextAtSize(`${line} ${word}`,size)>width) { lines.push(line); line = ''; }
        if (line) { line += ` ${word}`; continue; }
        for (const character of word) {
          if (line && font.widthOfTextAtSize(line + character,size)>width) { lines.push(line); line = ''; }
          line += character;
        }
      }
      lines.push(line);
    }
    return lines;
  };
  const draw = (page,text,x,top,size=7.2) => page.drawText(safe(text),{x,y:page.getHeight()-top,size,font,color:ink});
  const continuation = [];
  const put = (page,key,value,box) => {
    if (value===undefined || value===null || value==='') return;
    const [x,top,width,maxLines=1] = box;
    const lines = wrap(value,width,7.2);
    if (lines.length>maxLines) {
      draw(page,'See continuation',x,top,6.8);
      continuation.push([labels[key] || 'Declared name (online)',displayValue(value)]);
    } else lines.forEach((line,index) => draw(page,line,x,top+index*9));
  };
  if (layout) {
    const page = pdf.getPages()[0];
    for (const [key,box] of Object.entries(layout.fields)) {
      if ((key==='nonreturn_reason' && form.returning!=='No') || (key==='grade_applied_for' && form.returning!=='Yes')) continue;
      put(page,key,form[key],box);
    }
    const dob = /^(\d{4})-(\d{2})-(\d{2})$/.exec(form.date_of_birth || '');
    if (dob && category==='primary') for (const [value,x,width] of [[dob[3],122,26],[dob[2],157,26],[dob[1],192,43]])
      draw(page,value,x+(width-font.widthOfTextAtSize(value,7.2))/2,260.5);
    else if (dob) {
      page.drawRectangle({x:108,y:page.getHeight()-238,width:151,height:20,color:rgb(1,1,1)});
      draw(page,`${dob[3]} / ${dob[2]} / ${dob[1]}`,110,225);
      page.drawLine({start:{x:108,y:page.getHeight()-230},end:{x:258,y:page.getHeight()-230},thickness:.4,color:ink});
    }
    if (['Male','Female'].includes(form.gender)) draw(page,'X',layout.gender[form.gender==='Male'?0:1],layout.gender[2],8);
    if (['Yes','No'].includes(form.returning)) draw(page,'X',layout.returning[0],layout.returning[form.returning==='Yes'?1:2],8);
    const [labelX,top,nameX,width,dateX] = layout.signature;
    page.drawRectangle({x:labelX-1,y:page.getHeight()-top-3,width:137,height:13,color:rgb(1,1,1)});
    draw(page,'Declared name (online):',labelX,top,7.4);
    put(page,'declared_name',form.declared_name,[nameX,top,width]);
    draw(page,date(record.submitted_at),dateX,top,7.2);
    const declarationTop = category==='primary' ? 604 : 578;
    page.drawRectangle({x:34,y:page.getHeight()-declarationTop-14,width:523,height:24,color:rgb(1,1,1)});
    wrap(definition.declaration,520,7.4).forEach((line,index) => draw(page,line,36,declarationTop+index*9,7.4));
    if (category==='primary') {
      draw(page,'ONLINE SUBMISSION',384,22,7.5);
      draw(page,`${record.reference} / submitted v${record.version}`,384,33,6.5);
      draw(page,`Submitted: ${dateTime(record.submitted_at)} SAST`,384,44,6.2);
      draw(page,'Declaration accepted online',384,55,6.5);
    } else {
      draw(page,`ONLINE SUBMISSION | ${record.reference} / submitted v${record.version}`,91,77,6.5);
      draw(page,`Submitted: ${dateTime(record.submitted_at)} SAST | Declaration accepted online`,91,87,6.5);
    }
    const known = new Set([...Object.keys(labels),'declared_name','declaration_accepted']);
    for (const [key,value] of Object.entries(form)) if (!known.has(key)) continuation.push([key.replace(/_/g,' '),displayValue(value)]);
  } else {
    // Older definitions keep their saved answers, without presenting current
    // school terms as an agreement accepted by that parent.
    for (const [key,value] of Object.entries(form)) continuation.push([labels[key] || key.replace(/_/g,' '),displayValue(value)]);
  }
  if (continuation.length) {
    let page, top;
    const newPage = () => {
      page = pdf.addPage([595.28,841.89]); top = 110;
      draw(page,'HARMONY LEARNING INSTITUTE',35,37,14);
      draw(page,layout ? 'Completed form - continuation' : 'Saved online re-registration submission',35,60,12);
      draw(page,`${record.reference} | submitted version ${record.version} | ${dateTime(record.submitted_at)} SAST`,35,78,8);
      draw(page,'This is a copy of the saved submission. Later draft changes are not included.',35,94,7.5);
    };
    newPage();
    for (const [label,value] of continuation) {
      if (top>755) newPage();
      for (const line of wrap(label,520,9)) { if(top>780)newPage();draw(page,line,35,top,9);top+=12; }
      for (const line of wrap(value,520,9)) { if(top>780)newPage();draw(page,line,35,top,9);top+=12; }
      top+=10;
    }
  }
  pdf.setTitle(`Completed re-registration ${record.reference}`);
  pdf.setSubject(`Saved online submission version ${record.version}`);
  pdf.setCreator('Harmony Learning Institute');
  pdf.getPages().forEach((page,index) => draw(page,`Submission ${record.reference} | Page ${index+1} of ${pdf.getPageCount()}`,35,833,6));
  return {filename:`${record.reference}-Completed-Form.pdf`,bytes:Buffer.from(await pdf.save())};
}
module.exports = {createCompleted};
