const filenames = { complete: 'Harmony_2027_Re_registration_Complete.pdf', page1: 'Harmony_2027_Re_registration_Page_1.pdf', page2: 'Harmony_2027_Re_registration_Page_2.pdf' };
export async function downloadReRegistration(document, getBlob) {
  if (!filenames[document]) throw new Error('Form not found.');
  const blob = await getBlob(`/api/parent/re-registration/forms/${document}`);
  if (blob.type && !blob.type.includes('pdf')) throw new Error('The form download is unavailable. Please try again.');
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');
  anchor.href = url; anchor.download = filenames[document];
  window.document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
