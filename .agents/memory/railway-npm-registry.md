---
name: Railway npm registry portability
description: Prevent Replit-only npm registry URLs from breaking Railway dependency installation.
---

Lockfiles deployed to Railway must not contain `package-firewall.replit.local` URLs.

**Why:** Railway cannot resolve Replit's internal npm proxy, and an explicit public `--registry` flag does not override exact `resolved` URLs already stored in a lockfile.

**How to apply:** After dependency or lockfile updates, search the client lockfile for Replit-internal hosts and reproduce Railway's public-registry `npm ci` command before deployment.