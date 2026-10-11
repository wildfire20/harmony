# Website wording and Admin enquiry alerts

## Website updates

- The announcement is larger, bold and reads **NO FEE INCREASE IN 2027**.
- Boarding is described as **R3,650 per month for Preschool** and **R3,950 per month for Grades 1–7**. The existing inclusive boarding prices are retained.
- The sibling example reads **With two children enrolled at Harmony, you save R300 every month**. The published amount remains R150 per learner; the estimator does not automatically apply sibling discounts.
- The documents FAQ uses bullet points. Birth certificate and Parent/Guardian ID copies are listed clearly. The Road to Health / Clinic Card requirement is retained. School reports and transfer letters are marked for Grades 1–7.
- Returning Preschool learners have **no re-registration fee**, including in the public estimator. New Preschool registration remains R650; new Grades 1–7 registration remains R800; returning Grades 1–7 re-registration remains R500.
- The payment offers say **Pay 11 months’ school fees once off in January and get one month free**, and **Pay six months’ school fees once off in January and get half a month’s discount**. The benefit phrases are highlighted. The existing estimate multipliers remain 11 and 5.5.
- Payment instructions say **Always use your child’s reference number when making a payment**.

These public website updates do not edit existing invoices or discount assignments.

## What the admin will see

1. A number beside **Enquiries** shows how many open conversations contain messages that administrator has not read.
2. **Dashboard** and **Admin Panel** show an alert with **View enquiries**.
3. The inbox labels those conversations **Unread message**.
4. Opening a conversation clears its read alert for that administrator. It does not mark the question as resolved.
5. A new parent reply creates another alert. A second administrator has their own read count.
6. **Done** conversations do not create active alerts. **On hold** conversations can still receive parent replies.
7. The count and inbox check automatically every 30 seconds while open. Select **Refresh** to update an open conversation.

To reply, select **Enquiries**, open a question, enter **Your reply** and select **Send reply**. To resolve it, choose **Done** under **Enquiry status** and select **Save status**. Replies remain in the portal; no email, SMS or WhatsApp messages are sent by the enquiry feature.

## Enable this update

1. Merge the reviewed pull request into `master`.
2. In Railway, open the **web** service and wait for the new deployment to say **Deployment successful**.
3. In the Windows terminal, connect:

   ```bash
   railway ssh -s web -e production
   ```

4. Inside the Railway shell, run the existing setup command again. This adds the Admin read-position table to the already installed enquiry tables:

   ```bash
   cd /app
   npm run migrate:parent-enquiries
   ```

   Continue after **Parent enquiries migration applied successfully.**

5. Refresh Harmony. Submit a test enquiry from the test Parent account. Check the Admin alert, open the enquiry, and confirm the count decreases. Send another Parent reply and confirm an alert returns within 30 seconds. Mark the test enquiry **Done** after checking it.
6. Check the public homepage and **2027 School Fees** page on a phone, including the highlighted discounts and returning Preschool estimate of R0 re-registration.

Until the setup command runs, the new Admin alert endpoints give a clear unavailable response. Existing Parent conversations remain available. The migration is additive and safe to repeat.
