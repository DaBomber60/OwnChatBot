Baseline regenerated on 2025-09-19 via migration `20250919_init` replacing corrupted `20250914_init`.

Previous ad-hoc `prisma db push` only workflow was replaced with a proper baseline so future schema changes can use versioned migrations. If legacy databases contain the old failed migration entry, clear the database or manually mark it rolled back before applying the new baseline.

Commands going forward:
  # Dev change
  npx prisma migrate dev --name <change>

  # Prod / deploy
  npx prisma migrate deploy

If the database is ever recreated from scratch, apply all migrations in order with `migrate deploy`.