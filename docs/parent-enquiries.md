# Parent enquiries

This feature lets parents ask the school office for help and see replies in the Parent Portal. It does not send email, SMS or WhatsApp messages.

## For parents who can sign in

1. Sign in to the Parent Portal.
2. Select **Enquiry** in the menu, or the **Enquiry** card on **Home**. On a phone, open the menu at the top of the screen.
3. Select **New enquiry**.
4. Enter a **Subject** and **Message**, then select **Send enquiry**.
5. Wait for **Your enquiry has been sent** and keep the reference number.
6. Open the enquiry to read replies. Select **Refresh** to check for new replies or a changed status.
7. Enter **Your reply** and select **Send reply** if more information is needed.

Only the parent who sent the enquiry and the school administrators can view its conversation. Switching children does not switch the parent's enquiries.

| Status | Meaning |
|---|---|
| **New** | The question is open. |
| **On hold** | The school office is waiting for information or needs more time. Replies remain available. |
| **Done** | The question has been resolved. The conversation remains available to read. Send a new enquiry if more help is needed. |

Do not send passwords, verification codes or banking passwords. If saving fails, the draft remains available. A success message appears only after the enquiry has been saved.

## For parents who cannot sign in

1. Open the Parent Portal sign-in page and select **Get Help**.
2. Enter **Your name and surname**, **Mobile number**, **Subject** and **Message**.
3. Select **Send enquiry** and keep the reference number shown after saving.

No email address or login is required. The school office must contact the parent using the supplied mobile number. This form does not create, activate, reset or link an account. Public requests cannot be read back from the website.

## For the admin

1. Sign in to the Staff Portal.
2. Select **Enquiries** in the navigation menu or on **Admin Panel**.
3. Use **Status** to show **All**, **New**, **On hold** or **Done**. Use **Search enquiries** to find a name, mobile number, subject or enquiry reference.
4. Open an enquiry and read the conversation.
5. For a signed-in parent's enquiry, enter **Your reply** and select **Send reply**. The parent sees it when they open or refresh their enquiry.
6. Under **Enquiry status**, choose **On hold** or **Done**, then select **Save status**. Changing the dropdown alone does not save it.
7. To reopen a **Done** enquiry, choose **New** or **On hold** and select **Save status**.

**Login help** enquiries show the name and mobile number supplied by the requester. Contact the parent directly and confirm their identity before changing their account. There is no portal reply box for these enquiries because the requester cannot read it before signing in. After helping them, select **Done** and **Save status**.

Admin replies and status changes are recorded in audit history. Enquiries and conversations are retained; there is no delete button.

## Release instructions

The migration creates two new tables. It does not change users, learner links, Finance records or existing email settings. It runs only when explicitly requested. It can be run again safely.

1. Run the full release gate against an explicit **disposable** PostgreSQL database:

   ```bash
   FINANCE_TEST_DATABASE_URL="postgresql://test-user@127.0.0.1/test-database" FINANCE_TEST_DATABASE_SSL=false npm run release-gate
   ```

2. Review and merge the tested application change into `master`. Wait for Harmony's Railway **web** service deployment to show **SUCCESS**.
3. Open a shell inside the production **web** service using the already linked Railway CLI:

   ```bash
   railway ssh -s web -e production
   ```

4. Inside that service shell, run:

   ```bash
   cd /app
   npm run migrate:parent-enquiries
   ```

   Continue only after **Parent enquiries migration applied successfully.** If it fails, stop and inspect the service logs. Until the migration succeeds, enquiry requests return a clear unavailable message and cannot claim to have been saved.

5. Open the live Parent Portal, submit an enquiry, read and reply to it from **Enquiries** in the Staff Portal, and test **On hold**, **Done** and reopening.
6. Test **Get Help** while signed out, confirm that it appears as **Login help** for the admin, and mark the test enquiry **Done** after checking it.

Existing activation, payments, invoices, attendance, notices and document workflows keep their existing routes and permissions. Enquiry support is separate from those workflows.
