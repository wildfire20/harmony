---
name: Admin theme cascade
description: Preventing page-specific Admin colors from being overridden by the legacy global dark-theme stylesheet.
---

Admin page-specific contrast rules must target the actual `data-theme` state and be declared after the legacy global theme rules.

**Why:** The shared stylesheet has broad theme rules with high precedence. Earlier page rules can appear correct in isolation but lose in the final cascade, producing unreadable light-on-light or dark-on-dark controls.

**How to apply:** For future Admin readability work, inspect the final cascade in both themes and keep narrow page-scoped overrides after broad global declarations rather than adding another competing early rule.