---
name: Parent authentication lifecycle
description: Security and compatibility rules for Parent Portal activation, recovery, and persistent sessions.
---

Parent activation and password recovery use expiring, revocable, one-time opaque links whose raw tokens are returned only when issued and are stored only as hashes. These flows may update authentication state but must never create, infer, remove, or change learner relationships.

Persistent Parent Portal access uses short-lived access authentication plus a server-revocable refresh session in an HttpOnly cookie. Remembered sessions have a fixed absolute lifetime; rotation must not extend that deadline indefinitely. Password changes, resets, logout, and Admin access resets revoke applicable sessions.

Every Parent Portal entry route, including the login URL itself, must attempt refresh-cookie restoration before rendering a sign-in form. A remembered learner ID may be stored without credentials, but it must be matched against the freshly authorized learner list before selection.

**Why:** Long-lived browser secrets and sessionless parent JWTs would bypass password-reset and Admin revocation. Sliding the full remembered lifetime on every refresh would create an effectively permanent login. If only protected routes hydrate refresh sessions, reopening through the public login URL falsely appears signed out even when the persistent cookie is valid.

**How to apply:** Require a valid server session for every parent access token, rotate refresh tokens transactionally, detect replay, preserve the original family expiry, and keep long-lived credentials out of browser storage. Gate login-form rendering on the refresh attempt and validate any remembered learner ID against the current server response.