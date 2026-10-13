# Re-registration for 2027

For a learner already enrolled at Harmony, use **Re-registration** in the Parent Portal. For a new learner, including a new sibling, use **Apply for 2027** on the public website.

## Parent steps

1. Sign in and select the correct child.
2. Open **Re-registration**, then **Re-register online**.
3. Check the prefilled learner details. The HAR number is the school reference, not a national ID number. Contact the office if the learner identity is wrong.
4. Complete the short guardian details. Select **Yes** or **No** for returning in 2027. If Yes, choose the next-year grade. If No, give the reason.
5. **Save draft** stores your progress. Save before leaving or changing child.
6. Read the fees undertaking if returning. Type your full name, accept the declaration and select **Submit re-registration**.
7. For Grades 1–7 in 2027, pay the separate **R500 non-refundable re-registration deposit**, due on or before **11 January 2027**. This is separate from monthly tuition. Use the child's **HAR reference** in your bank app.
8. Return to the same page. Select **Upload proof of payment**, enter amount, payment date and method, choose **Upload Receipt**, then **Submit Proof of Payment**. PDF, JPG, PNG or WebP up to 10MB is supported. A screenshot or bank receipt must show the actual payment. Never upload a password or banking login details.
9. **Refresh status** checks progress. **Awaiting deposit verification** means Admin must check the money. **Approved** means Admin has approved re-registration. Uploading proof does not automatically approve the place.

Already paid? Upload the proof or contact the office. Do not pay twice. A pending proof reserves its amount until Admin reviews it. Partial payments can be verified, but the full R500 is needed before approval.

Baby Class, Preschool and Grade R in 2027 have no re-registration deposit. A learner moving from Grade R to Grade 1 uses the Grade 1–7 fee.

For paper: select the correct next-year category and **Download form**. Known learner and guardian details are filled in; the next-year choice, declaration, signature and office fields stay blank. Print and sign the one-page form, return it to the office or privately to WhatsApp **071 167 9620**. A paper copy can also be collected at school. Downloading does not submit the form.

## Admin steps

1. Open **Re-registration** or the **View re-registrations** alert. Use **Status**, **Current grade**, or **Learner name / reference** to find the child. **Refresh** checks for new forms.
2. Review the short signed form and requested grade. **View previous versions** keeps earlier signed details available to Admin.
3. In **Deposit verification**, select **View proof**. Check the school bank statement or POS receipt. Tick **I confirm that the school has received this money**, then select **Verify deposit**. It uses the existing Finance allocation system and applies money to the exact re-registration invoice.
4. If the proof is unsuitable, enter a clear reason and select **Reject proof**. The parent can upload another proof.
5. For money received at school by card or cash, use **Record deposit received**. Enter the amount, date, method and bank/POS receipt number, confirm receipt, then select **Save deposit payment**. If Finance has already recorded the money, apply that existing payment in Finance instead. Do not record it again.
6. When the full fee is verified, review the form, tick the review confirmation and select **Approve re-registration**. Preschool approval needs the form review but no deposit.
7. For a correction, write the reason and select **Request changes**. For an explicit unresolved returning-learner decision, write a reason and select **Put on waiting list**. An unpaid form is not automatically placed on the waiting list.
8. For a signed No response, review it and select **Record not returning**. This keeps the learner/account history. It does not delete the account or send a place-approval email.
9. For paper submissions, open the child and complete **Record paper form** from the signed document. Choose the linked guardian if applicable, enter **Date received**, the name on the signed declaration, and confirm the signed copy is kept at school. **Record paper form** puts it in the same review list. Verify the payment and approve separately.

There is one form and at most one registration-fee invoice per child/year. Contact and grade requests in the form do not silently change login details, current grades, monthly tuition, discounts or service enrolments. Use the existing Admin tools for those approved changes. Old invoice amounts, payment history and reversals are preserved.

## Status and email confirmations

| Status | Meaning |
| --- | --- |
| Not started | No form yet |
| Draft | Saved, not submitted |
| Submitted | School received it |
| Awaiting deposit verification | The applicable deposit is not fully verified |
| Changes needed | Admin requested a correction |
| Waiting list | Admin recorded this decision with a reason |
| Approved | School approved the returning learner |
| Not returning | Admin recorded the signed No response |

Only two email events are queued: first receipt and approval. They use the submitting guardian's active, verified account email. Parents without verified email receive the same portal status. Drafts, proof uploads, corrections and refreshes do not create extra re-registration emails. Provider acceptance is not a promise of inbox delivery. The existing Resend configuration is reused.

## Release

Merge the tested feature changes into master and wait for the Railway web deployment to show SUCCESS. Then run the additive migration in the service container:

```sh
npm run migrate:parent-reregistration
```

The migration is repeatable and does not populate registration forms, invoices or payments. It adds the registration tables/columns and scoped constraints only. Startup does not run it automatically. Synthetic tests use an explicit disposable FINANCE_TEST_DATABASE_URL, never production.
