const filenames={primary:'Harmony_2027_Grades_1_7_Re_registration_Form.pdf',preschool:'Harmony_2027_Preschool_Re_registration_Form.pdf'};
export async function downloadReRegistration(document, getBlob, childId) {
  if (!filenames[document]) throw new Error('Form not found.');
  const blob = await getBlob(`/api/parent/re-registration/forms/${document}${childId ? `?child_id=${childId}` : ''}`);
  if (blob.type && !blob.type.includes('pdf')) throw new Error('The form download is unavailable. Please try again.');
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');
  anchor.href = url; anchor.download = filenames[document];
  window.document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
