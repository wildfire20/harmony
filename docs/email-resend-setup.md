# Connect Harmony email to Resend

This change adds Resend to the shared email service used by Parent verification codes,
account emails, important school notifications and Admissions emails. Existing email
templates and Harmony's reply address are retained. It does not change parent records,
passwords, learner links or Finance data. No database migration is required.

## 1. Check your sending domain

1. Sign in at https://resend.com/domains.
2. Check that the domain you want to use says **Verified** and has sending enabled.
3. Use a sender address on that exact domain. For example, `portal@auto-m8.co.za`
   works only if `auto-m8.co.za` is verified in this Resend account. A verified
   subdomain needs an address on that subdomain.
4. If there is no verified domain, add a domain you own and follow Resend's DNS
   instructions. Do not replace existing website or mailbox DNS records.

Resend cannot send school messages from a `gmail.com` address. Replies still go to
`harmonylearninginstitute@gmail.com`. Do not use `onboarding@resend.dev` for parents;
Resend's test domain restricts which recipients can receive messages.

## 2. Create a key for Harmony

1. Open https://resend.com/api-keys.
2. Create a separate API key named **Harmony Production**.
3. A **Sending access** key restricted to the sending domain is enough to send emails.
4. Keep the key private. Put it directly in Railway, never in source code, chat or screenshots.

The read-only `npm run verify:email` check uses Resend's domain-list endpoint. That
endpoint requires **Full access**. With a sending-only key, use the actual Parent
Portal test in step 4 to confirm sending; a permission error from the domain-list
check alone does not mean a sending-only key cannot send.

## 3. Deploy the application and Railway settings

The code change must be published and deployed before setting the new provider.
Adding these variables to an old deployment alone will not make it use Resend.

In Railway, select Harmony's **production** environment, then **web → Variables**:

| Name | Value |
| --- | --- |
| `EMAIL_PROVIDER` | `resend` |
| `RESEND_API_KEY` | Your private Harmony API key |
| `RESEND_FROM_EMAIL` | The plain sender email on the verified domain |

For `RESEND_FROM_EMAIL`, enter only the address, without a display name or angle
brackets. Harmony adds the correct display name for each message.

Review and deploy the staged changes, then wait for **SUCCESS**. These variables
must exist in the server service, not in a public React environment variable.

Gmail credentials may remain during the switch. With `EMAIL_PROVIDER=resend`, the
application uses only Resend; failed sends do not fall back to Gmail or retry automatically.
If `EMAIL_PROVIDER` is unset, the application keeps using Gmail.

## 4. Confirm that a real code arrives

1. Use a known, eligible parent test account in **Activate Account** and request a new code.
2. In Resend's **Emails** page, check the message and its delivery status.
3. Check the recipient inbox and spam folder. Confirm that the new code arrives and
   that activation works. An API success means Resend accepted the message; it
   does not prove inbox delivery.
4. If the portal rate limit is reached from earlier attempts, respect the limit or use
   the existing Admin-assisted activation process. Do not disable the limit or edit production data.

If using a Full access key, the additional read-only check is:

```bash
railway ssh -s web -e production
cd /app
npm run verify:email
```

This checks credentials and the configured verified sender domain, without sending
an email. It cannot check inbox delivery, sending quotas or every per-message restriction.

## Failure handling

- A missing key, invalid sender, provider rejection, timeout, quota error or missing
  message ID is reported as a send failure.
- Failed Parent OTP sends do not mark a challenge as delivered or announce that a
  code was sent. The user gets a simple retry message.
- Logs contain safe error categories, not API keys, OTPs or raw provider responses.

Official references:
- https://resend.com/docs/dashboard/domains/introduction
- https://resend.com/docs/api-reference/emails/send-email
- https://resend.com/docs/api-reference/errors
- https://resend.com/docs/dashboard/api-keys/introduction
