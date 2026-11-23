const test=require('node:test');
const assert=require('node:assert/strict');
const {PDFExtract}=require('pdf.js-extract');
const pdf=require('../services/parentReRegistrationPdf');

const extract=async result=>new PDFExtract().extractBuffer(result.bytes,{disableCombineTextItems:true});
test('approved primary download stays one page and shows the current dates and school terms',async()=>{
 const result=await pdf.create('primary');
 const parsed=await extract(result);
 assert.equal(parsed.pages.length,1);
 const text=parsed.pages[0].content.map(x=>x.str).join(' ');
 for(const expected of ['19 November 2026','8 January 2027','23 DECEMBER 2026','HAR........................','Receipt number (if applicable)','All 2026 school fees must be paid in full','63035320265','250655'])assert.ok(text.includes(expected),expected);
 for(const removed of ['SCHOOL REVIEW COPY','11 December 2026','11 JANUARY 2027','NO UNIFORM, NO ENTRY'])assert.ok(!text.includes(removed),removed);
});
test('auto-fill respects the wider HAR field, keeps DOB boxes and leaves signing and office fields blank',async()=>{
 const form={learner_full_name:'Synthetic Long Learner Name For Form Review',learner_reference:'HARTEST405',current_grade:'Grade 2',date_of_birth:'2018-05-12',gender:'Female',parent_full_name:'Synthetic Parent Guardian',parent_mobile:'0731234567',parent_whatsapp:'0737654321',physical_address:'123 Synthetic Street',grade_applied_for:'Grade 3',declared_name:'Do not pre-sign'};
 const parsed=await extract(await pdf.create('primary',form));
 const items=parsed.pages[0].content;
 const value=text=>{const matches=items.filter(x=>x.str===text);assert.equal(matches.length,1,text);return matches[0];};
 const learner=value(form.learner_full_name),har=value(form.learner_reference);
 assert.ok(learner.x>=35 && learner.x+learner.width<=293);
 assert.ok(har.x>=303 && har.x+har.width<=560.28);
 assert.equal(learner.y,207);assert.equal(har.y,207);
 for(const [part,left,width]of [['12',122,26],['05',157,26],['2018',192,43]]){
  const item=value(part);assert.ok(item.x>=left && item.x+item.width<=left+width);assert.equal(item.y,260.5);
 }
 for(const label of ['DD','MM','YYYY'])assert.ok(items.some(x=>x.str===label),label);
 assert.ok(!items.some(x=>x.str===form.grade_applied_for || x.str===form.declared_name));
 const gender=value('X');assert.equal(gender.x,414);
});
test('long learner names stay out of the HAR field',async()=>{
 const parsed=await extract(await pdf.create('primary',{learner_full_name:'Synthetic very long name '.repeat(25),learner_reference:'HARTEST123456'}));
 const value=parsed.pages[0].content.find(x=>x.str.startsWith('Synthetic very long name'));
 assert.ok(value && value.x+value.width<=293);
 assert.ok(parsed.pages[0].content.some(x=>x.str==='HARTEST123456'));
});
test('preschool keeps its no-deposit form and the same reopening dates',async()=>{
 const parsed=await extract(await pdf.create('preschool'));
 assert.equal(parsed.pages.length,1);
 const text=parsed.pages[0].content.map(x=>x.str).join(' ');
 assert.ok(text.includes('19 NOVEMBER 2026 - 8 JANUARY 2027'));
 assert.ok(text.includes('R500 deposit does not apply'));
 assert.ok(!text.includes('SCHOOL REVIEW COPY'));
});
test('unknown form categories remain rejected',async()=>{
 await assert.rejects(pdf.create('complete'),error=>error.status===404);
});

const completed=require('../services/parentReRegistrationCompletedPdf');
const submission=(extra={})=>({reference:'RR-2027-000999',version:3,definition_version:2,
 submitted_at:'2026-11-20T21:45:00Z',form:{learner_full_name:'Synthetic Saved Learner',learner_reference:'HARTEST999',
 current_grade:'Grade 2',grade_applied_for:'Grade 3',date_of_birth:'2018-05-12',gender:'Female',
 parent_full_name:'Synthetic Saved Guardian',parent_mobile:'0731234567',parent_whatsapp:'0737654321',
 physical_address:'123 Synthetic Street',returning:'Yes',declared_name:'Synthetic Declared Guardian',declaration_accepted:true},...extra});
test('completed primary form fills the approved page, actual choices and electronic declaration',async()=>{
 const record=submission();const result=await completed.createCompleted(record);const parsed=await extract(result);
 assert.equal(result.filename,'RR-2027-000999-Completed-Form.pdf');assert.equal(parsed.pages.length,1);
 const items=parsed.pages[0].content,text=items.map(i=>i.str).join(' ');
 for(const value of Object.values(record.form).filter(x=>typeof x==='string' && !['2018-05-12','Female','Yes'].includes(x)))assert.ok(text.includes(value),value);
 for(const value of ['Declared name (online):','Declaration accepted online','20/11/2026','23:45','RR-2027-000999','submitted v3'])assert.ok(text.includes(value),value);
 assert.ok(items.some(i=>i.str==='X' && i.x===414));assert.ok(items.some(i=>i.str==='X' && i.x===36 && Math.round(i.y)===407));
 assert.ok(!items.some(i=>i.str==='X' && Math.round(i.y)===710),'No false deposit verification');
 assert.ok(!text.includes('office_note') && !text.includes('Email updates'));
});
test('completed preschool and not-returning selections use the right form and preserve the reason',async()=>{
 const record=submission();record.form={...record.form,current_grade:'Grade R',grade_applied_for:undefined,returning:'No',nonreturn_reason:'Moving to another town'};
 const parsed=await extract(await completed.createCompleted(record));assert.equal(parsed.pages.length,1);
 const items=parsed.pages[0].content,text=items.map(i=>i.str).join(' ');
 assert.ok(text.includes('NO RE-REGISTRATION FEE'));assert.ok(text.includes('Moving to another town'));
 assert.ok(items.some(i=>i.str==='X' && i.x===40 && Math.round(i.y)===410));
});
test('long saved answers continue on readable pages without being silently cut off',async()=>{
 const record=submission();record.form.physical_address='BEGIN_ADDRESS '+('Long saved address detail '.repeat(50))+' END_ADDRESS';
 record.form.declared_name='BEGIN_NAME '+('Long declared name '.repeat(8))+' END_NAME';
 const parsed=await extract(await completed.createCompleted(record));assert.ok(parsed.pages.length>1);
 const text=parsed.pages.flatMap(p=>p.content.map(i=>i.str)).join(' ');
 for(const term of ['See continuation','BEGIN_ADDRESS','END_ADDRESS','BEGIN_NAME','END_NAME'])assert.ok(text.includes(term),term);
 // The approved template contains existing text operators with merged widths;
 // check the newly laid-out continuation pages for actual layout bounds.
 for(const page of parsed.pages.slice(1))for(const item of page.content.filter(i=>i.str.trim())){
   assert.ok(item.x>=0 && item.x+item.width<=596,`${item.str}: horizontal clipping`);
   assert.ok(item.y>=0 && item.y<=842,`${item.str}: vertical clipping`);
 }
});
test('legacy definitions export saved answers without assigning current terms or invented acceptance',async()=>{
 const record=submission({definition_version:1,form:{learner_full_name:'Synthetic Legacy Learner',parent_id_passport:'SYNTHETIC-OLD-ID',declaration_accepted:false}});
 const parsed=await extract(await completed.createCompleted(record));const text=parsed.pages.flatMap(p=>p.content.map(i=>i.str)).join(' ');
 assert.ok(text.includes('SYNTHETIC-OLD-ID'));assert.ok(text.includes('false'));
 assert.ok(!text.includes('23 DECEMBER 2026') && !text.includes('Declaration accepted online'));
});
