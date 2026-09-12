---
name: Parent self-activation
description: Security and ownership rules for the simplified Parent email-OTP activation flow.
---

Parent self-activation may only activate an existing school-created Parent account identified by its registered South African mobile number. It must never create or merge Parent accounts, infer learners, or alter existing Parent-to-learner links. Shared or duplicate phone matches require manual review.

**Why:** Harmony chose a lower-friction registered-phone plus verified-email workflow, while keeping Admin ownership of account creation and learner linking. A verified OTP challenge ID is predictable and is not sufficient authority to set a password.

**How to apply:** Store OTPs only as keyed hashes, enforce expiry, attempts, cooldown, resend limits, and one-time use, then issue a separate random one-time completion capability after OTP verification. Complete email verification, password setup, audit, learner loading, and Parent session issuance transactionally. Keep schema rollout manual.