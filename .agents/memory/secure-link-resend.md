---
name: Secure-link resend semantics
description: Why admissions secure-link resend replaces the active token instead of attempting to reuse it.
---

Admissions secure-link resend must be an explicit reissue: revoke the active link, issue a new random token, and clearly tell the Admin that the old link becomes invalid.

**Why:** Only one-way token hashes are stored. The original raw token cannot be reconstructed later without weakening the approved random-token design or adding recoverable token storage.

**How to apply:** Any future resend UI, API, email retry, or support workflow involving admissions portal links must use the explicit reissue flow and must never claim to reuse the existing link.