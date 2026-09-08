# Admissions email resend endpoint

The backend provides an Admin-only resend capability for a future Admin UI:

```text
POST /api/enrollments/:id/email/resend
Authorization: Bearer <Admin JWT>
Content-Type: application/json

{ "emailType": "application_confirmation" }
```

Allowed email types are:

- `application_confirmation`
- `new_application_admin`
- `status_under_review`
- `status_more_information_required`
- `status_approved`
- `status_registration_pending`
- `status_registered`
- `status_not_accepted`

The endpoint only retries the latest unresolved failed attempt for that application and email type. Status-email retries are allowed only while the application still has the corresponding status. The recipient is always loaded from the application or server configuration; the request cannot provide a recipient.

Concurrent retries for the same application and email type are serialized with a PostgreSQL transaction advisory lock. Every completed attempt is written to `admissions_email_log`.

Responses:

- `200`: email delivered.
- `400`: email type is not allowed.
- `401`: authentication required.
- `403`: Admin access required.
- `404`: application not found.
- `409`: no unresolved failure, status changed, or another retry is active.
- `502`: SMTP delivery failed; the sanitized category is included.
- `500`: unexpected server failure.