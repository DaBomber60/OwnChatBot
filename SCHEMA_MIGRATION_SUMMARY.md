# Lorebook Schema & Migration Summary

## Changes Made

### 1. Updated Prisma Schema (`prisma/schema.prisma`)

#### New Models Added:
- **`Lorebook`** – Container for lore entries
  - `id`: Primary key
  - `name`: Unique identifier (e.g., "The Red Guard World")
  - `description`: Optional narrative description
  - Relations: many entries, many characters (via join table)

- **`LoreEntry`** – Individual lore snippets
  - `id`: Primary key
  - `lorebookId`: Foreign key to Lorebook
  - `title`: Short identifier (e.g., "The Red Guard")
  - `content`: The lore text itself
  - `keys`: Space-separated keywords for triggering (stored as TEXT)
  - `constant`: Boolean flag (true = always in system prompt)
  - `enabled`: Toggle on/off without deleting
  - `priority`: Integer (0-200, default 100); higher = triggered first
  - Timestamps: `createdAt`, `updatedAt`

- **`CharacterLorebook`** – Join table (many-to-many)
  - Links characters to lorebooks
  - Supports one character using multiple lorebooks
  - Supports one lorebook attached to multiple characters
  - Cascading delete on both sides

#### Updated Models:
- **`Character`** – Added relation `lorebooks: CharacterLorebook[]`
  - Existing fields unchanged
  - Only addition is the new relationship

### 2. Created Migration File (`prisma/migrations/20261116_add_lorebooks/migration.sql`)

SQL migration includes:
- Create 3 new tables with proper types and constraints
- Create unique index on `lorebooks.name`
- Create index on `lore_entries.lorebookId` for query performance
- Create unique composite index on `character_lorebooks(characterId, lorebookId)`
- Add foreign key constraints with CASCADE deletes
- Proper timestamp handling (TIMESTAMP(3))

## Validation Completed

✅ **Schema Formatting** – `npx prisma format` passed  
✅ **Type Generation** – Prisma client regenerated successfully  
✅ **TypeScript Check** – `npm run type-check` passed (zero errors)  
✅ **SQL Syntax** – Migration SQL is valid PostgreSQL

## What's NOT Included (Next Steps)

The following will be implemented in later tasks:

- [ ] API endpoints for CRUD operations on lorebooks
- [ ] Keyword generation endpoint (AI-powered)
- [ ] Lore injection logic in `buildConversationPrompt`
- [ ] UI pages for lorebook management
- [ ] Character editor integration
- [ ] Chat UI badges showing triggered lore
- [ ] Export/import support
- [ ] Settings for lore limits

## How to Test/Deploy

1. **Commit this change** – Schema + migration are ready for version control
2. **Run on dev machine** – `npm run db:setup` then `npm run prisma:migrate`
3. **Run in Docker** – Migration will auto-apply when container starts
4. **Rollback if needed** – Prisma keeps migration history; can `reset` if necessary

## Notes

- Migration is idempotent (safe to run multiple times)
- Cascading deletes ensure referential integrity (deleting a character removes its lorebook links)
- The `keys` field is stored as TEXT; in later PRs we can parse/split as needed in application code
- No data loss on existing tables (only additions)
- Indexes added for query performance (especially important for keyword matching queries)
