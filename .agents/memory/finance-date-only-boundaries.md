---
name: Finance date-only boundaries
description: Canonical handling of PostgreSQL DATE values in finance reads, APIs, tests, and reports.
---

PostgreSQL financial `DATE` fields must be selected as text at direct database and API/read-model boundaries. Preserve `YYYY-MM-DD` semantics; do not serialize them through JavaScript `Date`, `toISOString()`, or UTC/local timezone conversion.

**Why:** The real PostgreSQL release gate returned a `DATE` as a JavaScript `Date`, and string/timezone conversion changed its representation and could shift the calendar day.

**How to apply:** Cast fields such as billing periods, enrollment start/end dates, due dates, and date-valued payment dates to text in SQL. When a legacy `pg` Date object cannot be avoided, read its local calendar components without converting timezones.