---
name: PostgreSQL date expression typing
description: Why nullable bound parameters used in SQL expressions need explicit date casts.
---

When nullable bound parameters are combined inside an expression such as `COALESCE`, cast each parameter to `date` before assigning the expression to a date column.

**Why:** Railway PostgreSQL resolved two bound date strings inside an uncast `COALESCE` as text and rejected the insert with SQLSTATE 42804, even though direct parameter-to-date assignments worked elsewhere.

**How to apply:** For nullable dates used in computed SQL expressions, use explicit `::date` casts rather than relying on assignment-context coercion.