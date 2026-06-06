---
name: db:push drops the session table
description: Why npm run db:push is unsafe here and how to add columns instead
---

# db:push wants to drop the session table

`npm run db:push` (drizzle-kit push) tries to **delete the `session` table** because it is not
declared in the Drizzle schema — it is created at runtime by connect-pg-simple / express-session
for login sessions. Accepting the prompt destroys active logins.

**Rule:** do not run an unattended `db:push` here. For additive schema changes (new nullable
columns), apply them directly with `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...` against
`$DATABASE_URL`, which leaves the session table untouched.

**Why:** the prompt is interactive and the only "yes" option also removes the session table —
data loss with no upside for a simple column add.
