---
name: Role-preserving portal retirement
description: Why learner portal retirement must preserve learner identities, history, and adult access.
---

Retire learner sign-in through a server-owned feature flag while preserving learner users, roles, IDs, active status, relationships, and historical academic and financial records. Existing learner sessions must be denied centrally, but adult callers must retain access to learner data.

**Why:** Learner rows are shared identities used by attendance, academics, fees, invoices, documents, submissions, quizzes, and parent relationships. Disabling or rewriting those rows would corrupt operational and historical access. Default-enabled behavior also provides a safe rollback path until production explicitly disables the portal.

**How to apply:** For learner-access changes, gate authentication, authorization of learner callers, credential distribution, and frontend reachability. Do not change learner roles or active status, delete records, or add portal-state columns to shared user data. Production retirement uses `STUDENT_PORTAL_ENABLED=false`.