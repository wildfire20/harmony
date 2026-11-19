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
