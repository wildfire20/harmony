# Re-registration for 2027

This feature is for a child who is already enrolled at Harmony. A child joining for the first time, including a new sibling, still uses **Apply for 2027** on the public website.

## Parents

1. Sign in to the **Parent Portal** and choose the correct child.
2. Select **Re-register for 2027** on Home, or **Re-registration** in the menu.
3. Check the existing details and choose the **Grade requested for 2027**. The system does not assume next year's grade.
4. Complete the required fields marked `*`. Open **More details from the paper form (optional)** for other details that apply.
5. Use **Next** and **Back** to move through the sections. **Save draft** saves progress without sending the form to Admin. Save before leaving the page or changing child.
6. Select **Review & submit**, check the information, accept the declaration and enter your full name.
7. Select **Submit re-registration**. **Submitted** means the school received the form; it is not approval yet.
8. Return to **Re-registration** to see the status and any message from Admin. If the status is **Changes needed**, correct the online form and submit again. For a paper form, contact the office and hand in the correction.

Parents can also use **Download both pages**, **Page 1** or **Page 2**. Print, complete and sign both pages, then hand them to the school. A printed copy can also be collected at school. Downloading alone does not submit a form.

There is one form per child for 2027. Another linked parent can see the child's status, but cannot read or overwrite the submitting guardian's private form details.

## Admin

1. Open **Re-registration** in the Admin menu, or select **View re-registrations** on the Admin Panel alert.
2. Use **Status**, **Current grade**, and **Learner name / reference** to find forms. **Not started** includes active learners who have not started a form. **Refresh** checks for new submissions; the menu count also refreshes automatically.
3. Select a learner to review the form. Check the requested grade, contact details, health information and document arrangements.
4. To ask for a correction, write a clear message and select **Request changes**. The parent sees the message in the portal. No extra email is sent for this step.
5. To approve, tick **I have reviewed the form and documents and approve re-registration for 2027**, then select **Approve re-registration**.
6. For a signed paper form, open the learner, choose the linked parent who handed it in if applicable, enter an office note, confirm receipt, and select **Record paper form**. It enters the same review list. Review the actual signed document before approving.

Approval records the 2027 decision. It does not create a new learner or change the current grade, login details, discounts, invoices, payments or Finance services. Apply any approved learner or service changes through the existing Admin tools with the correct effective dates. An existing online draft converted to a paper receipt is retained for Admin and is not shared with another guardian.

## The two email updates

- **Re-registration received:** sent after the first successful submission or recorded paper receipt.
- **Re-registration approved:** sent after Admin approves it.

Emails go only to the submitting/recorded parent's active account with a verified email address. Typing an email in the form does not change or verify the account email. A parent without email, or with an unverified email, receives the same confirmation in the portal and can still re-register.

Each form gets at most one logical receipt and one logical approval event. Saving drafts, refreshing, retrying a request or resubmitting corrections does not add another event. Resend acceptance is shown as **Accepted by email provider**, which does not guarantee inbox delivery. The portal status is the main confirmation.

The outbox retries temporary provider errors. Receipt is processed before approval. Old uncertain sends stop for a Resend log check rather than risking duplicate email. **Email needs attention** or **Check email provider before retrying** means support should check Resend; the form remains valid.

Resend retains [idempotency keys for 24 hours](https://resend.com/docs/dashboard/emails/idempotency-keys); this worker stops automatic uncertain retries after 23 hours.

The default re-registration budget is **50 send attempts per UTC day**. Remaining emails wait in the queue. This limits only re-registration; OTPs, announcements and other emails share the Resend plan allowance. It does not change the plan or guarantee enough allowance for every email on a busy day. No reminder, draft or correction emails are sent.

## Release steps

Before release, run the normal release gate against a fresh disposable `FINANCE_TEST_DATABASE_URL`. Never use production as a test database.

1. Merge the tested feature PR into `master` and wait for the new Railway **web** deployment to show **SUCCESS**.
2. In Windows PowerShell, connect to the correct linked Railway project:

   ```powershell
   railway ssh -s web -e production
   ```

3. Inside the service shell, run:

   ```sh
   cd /app
   npm run migrate:parent-reregistration
   ```

   Expect `Parent re-registration migration applied successfully.` The migration creates new tables only and can be run again safely. Application startup never runs this migration automatically.

4. Reload the Parent Portal and Admin Portal. Confirm **Re-registration**, the learner list, and **Download both pages** are available.
5. Check a controlled returning learner's form with the school before announcing the feature. A real submission may queue the two real emails; use the synthetic disposable tests for bulk validation.

The existing `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, and `RESEND_FROM_EMAIL` configuration is reused. No new provider account is needed. The worker checks the queue every 30 seconds after application startup, including after an operator applies the migration.

Optional Railway variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PARENT_REREGISTRATION_EMAIL_DAILY_LIMIT` | `50` | Maximum re-registration send attempts per UTC day; choose using the actual Resend plan and remaining allowance. |
| `PARENT_REREGISTRATION_EMAILS_ENABLED` | enabled | Set to `false` to pause these two notifications; portal submissions and approvals still work. |

No real emails or production changes are needed to run the automated tests.
