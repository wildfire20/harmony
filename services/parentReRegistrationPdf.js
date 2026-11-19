const fs = require('node:fs/promises');
const path = require('node:path');
const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const layouts = {
  primary: {file:'Harmony_2027_Grades_1_7_Re_registration_Form.pdf',fields:{
    learner_full_name:[35,207,258],learner_reference:[303,207,257],current_grade:[35,235,230],
    date_of_birth:[122,260.5,113],parent_full_name:[35,306,510],parent_mobile:[35,334,230],
    parent_whatsapp:[277,334,265],physical_address:[141,354,410]},gender:[340,414,257]},
  preschool: {file:'Harmony_2027_Preschool_Re_registration_Form.pdf',fields:{
    learner_full_name:[39,184,338],learner_reference:[396,184,150],current_grade:[39,213,240],
    date_of_birth:[110,226,145],parent_full_name:[39,290,310],parent_mobile:[373,290,170],
    parent_whatsapp:[39,319,500],physical_address:[135,343,410]},gender:[360,431,225]}
};
async function create(category,form={}) {
  const layout=layouts[category];
  if (!layout) throw Object.assign(new Error('Form not found.'),{status:404});
  const pdf=await PDFDocument.load(await fs.readFile(path.join(__dirname,'..','assets','forms',layout.file)));
  pdf.registerFontkit(fontkit);
  const font=await pdf.embedFont(await fs.readFile(path.join(__dirname,'..','assets','fonts','DejaVuSans.ttf')));
  const page=pdf.getPages()[0];const height=page.getHeight();
  for (const [key,[x,top,width]] of Object.entries(layout.fields)) {
    if (!form[key]) continue;
    let text=String(form[key]).replace(/[\r\n]/g,' ');let size=category==='primary' ? 7.2 : 8;
    if (key==='date_of_birth') {
      const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
      if (category==='primary') {
        if (match) for (const [value,left,boxWidth] of [[match[3],122,26],[match[2],157,26],[match[1],192,43]]) {
          page.drawText(value,{x:left+(boxWidth-font.widthOfTextAtSize(value,size))/2,y:height-top,size,font,color:rgb(.08,.12,.18)});
        }
        continue;
      }
      text=match ? `${match[3]} / ${match[2]} / ${match[1]}` : text;
      page.drawRectangle({x,y:height-top-2,width,height:13,color:rgb(1,1,1)});
    }
    while (font.widthOfTextAtSize(text,size)>width && size>6) size-=.2;
    while (font.widthOfTextAtSize(text,size)>width) text=text.slice(0,-4)+'...';
    page.drawText(text,{x,y:height-top,size,font,color:rgb(.08,.12,.18)});
  }
  if (['Male','Female'].includes(form.gender)) {
    const [male,female,top]=layout.gender;
    page.drawText('X',{x:form.gender==='Male' ? male : female,y:height-top,size:8,font});
  }
  return {filename:layout.file,bytes:Buffer.from(await pdf.save())};
}
module.exports={create};
