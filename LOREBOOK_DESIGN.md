# Lorebook Feature Specification

## Overview
A lorebook is a world-building companion to characters and personas. Lore entries are conditionally injected into chat requests based on keyword triggers, keeping the system prompt stable and enabling prompt caching discounts. Entries can be "constant" (always in system prompt) or "triggered" (only when keywords match).

## Data Model

### Tables

```prisma
model Lorebook {
  id          Int         @id @default(autoincrement())
  name        String      @unique
  description String?
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt
  entries     LoreEntry[]
  characters  Character[] // many-to-many
  
  @@map("lorebooks")
}

model LoreEntry {
  id         Int      @id @default(autoincrement())
  lorebookId Int
  title      String
  content    String   // The lore text
  keys       String[] // Trigger keywords, space-separated or stored as text[]
  constant   Boolean  @default(false) // If true, injected into system prompt
  enabled    Boolean  @default(true)
  priority   Int      @default(100) // Higher = triggered first; lower = if we're out of space, drop this
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  lorebook   Lorebook @relation(fields: [lorebookId], references: [id], onDelete: Cascade)
  
  @@index([lorebookId])
  @@map("lore_entries")
}

// Join table for characters ↔ lorebooks (many-to-many)
model CharacterLorebook {
  id          Int     @id @default(autoincrement())
  characterId Int
  lorebookId  Int
  character   Character @relation(fields: [characterId], references: [id], onDelete: Cascade)
  lorebook    Lorebook  @relation(fields: [lorebookId], references: [id], onDelete: Cascade)
  
  @@unique([characterId, lorebookId])
  @@map("character_lorebooks")
}
```

### Update Character model

Add a relation:
```prisma
model Character {
  // ... existing fields ...
  lorebooks CharacterLorebook[]
}
```

## Request-Time Behavior

### When a chat message is sent

1. **Collect trigger keywords** from triggered entries currently active (see Keep-Active below).
2. **Scan the last 3 messages + the new user message** for whole-word, case-insensitive matches against `entry.keys`.
3. **Collect matching entries** where `enabled=true` and `constant=false`.
4. **Sort by priority** (highest first) and accumulate up to `loreLimit` characters (default: 4000, configurable in Settings).
5. **Inject triggered lore** as a temporary user message placed just before the latest user message:
   ```
   <lore>
   [entry.title]: entry.content
   [entry.title]: entry.content
   </lore>
   ```
6. **Record triggered entry IDs** in `persistRequestWithMeta` metadata (for the debug log).
7. **Do NOT save** this lore message; it only exists for that request.
8. **Subtract lore size from truncation limit** before trimming history, so total context stays within bounds.

### Keep-Active Behavior

- On each request, check if any entry triggered in the last N turns (e.g., 3 turns).
- If so, include it again as if it matched keywords (even if keywords don't match this turn).
- If it's re-triggered while active: counter resets to N.
- This prevents lore from flickering in and out and avoids prompt caching breaks.
- Store `lastTriggeredAt` (messageId, not timestamp) on each entry per session, or include in the debug log.

### System Prompt Injection (Constant Entries)

Entries with `constant=true` are always included in the system prompt, similar to example dialogue. They appear in a new `<lore>` section after example dialogue:

```
<example_dialogue>...</example_dialogue>
<lore>
[Constant Entry 1]: content
[Constant Entry 2]: content
</lore>
The following is a conversation...
```

This keeps them stable for prompt caching and avoids needing to inject them as temporary messages.

## Settings

Add to Settings (in `pages/api/settings/models.ts` or similar):
- `loreLimit` (integer, default: 4000 characters)
- `loreKeepActiveTurns` (integer, default: 3 turns)

## UI / Management

### New page: `/lorebooks`

- **List view:** All lorebooks, grouped by character(s) they're attached to.
- **Create new:** Name + description.
- **Edit lorebook:**
  - Title and description
  - Add/edit/delete entries
  
### Entry Editor

Fields:
- **Title** (short identifier, e.g., "The Red Guard")
- **Content** (the lore text)
- **Keywords** (display as a list; allow add/remove)
- **Constant** (toggle: "always in system prompt" vs "triggered only")
- **Enabled** (toggle)
- **Priority** (integer slider, 0–200, default 100)

**Auto-Keyword Generation Button:**
1. Call `POST /api/lorebooks/generate-keywords`
2. Send: `{ entryContent: string, optionalSessionId?: number }`
3. If `sessionId` provided, also send last 2–3 messages for context ("link a chat").
4. Receive: `{ keywords: string[], explanation?: string }`
5. Populate the keywords field; user can edit before saving.

### Character Association

When editing a Character, add a "Link Lorebooks" section:
- Checkboxes or multi-select for available lorebooks.
- Only lorebooks whose entries can be saved when cloning or exporting.

## API Endpoints

### List Lorebooks
`GET /api/lorebooks`
- Returns: array of `{ id, name, description, entryCount, linkedCharacters }`

### Create Lorebook
`POST /api/lorebooks`
- Body: `{ name: string, description?: string }`
- Returns: `{ id, name, description }`

### Get Lorebook (with entries)
`GET /api/lorebooks/:id`
- Returns: full lorebook + all entries

### Update Lorebook
`PATCH /api/lorebooks/:id`
- Body: `{ name?, description? }`

### Delete Lorebook
`DELETE /api/lorebooks/:id`

### Create Entry
`POST /api/lorebooks/:id/entries`
- Body: `{ title, content, keys: string[], constant?: boolean, priority?: number }`
- Returns: `{ id, ... }`

### Update Entry
`PATCH /api/lorebooks/:id/entries/:entryId`
- Body: partial entry fields

### Delete Entry
`DELETE /api/lorebooks/:id/entries/:entryId`

### Auto-Generate Keywords
`POST /api/lorebooks/generate-keywords`
- Body: `{ entryContent: string, sessionId?: number }`
- Returns: `{ keywords: string[] }`
- Implementation:
  1. Build a prompt like: *"Generate 5–15 keywords that would trigger this lore entry in a roleplay chat. The keywords should be specific terms that naturally appear in dialogue or narrative. Return only a JSON array of strings."*
  2. If `sessionId`: append last 2–3 messages for context.
  3. Call the AI model (use current settings).
  4. Parse the keywords from the response.

### Link Lorebooks to Character
`PATCH /api/characters/:id`
- Body: `{ ..., loreIds?: number[] }` (new optional field)
- Creates/updates CharacterLorebook join rows.

## Database Export/Import

### Export (`/api/database/export`)
Add lorebooks and lore entries to the export payload:
```json
{
  "lorebooks": [...],
  "loreEntries": [...],
  "characters": [
    { "id": 1, "name": "...", "loreIds": [1, 3] },
    ...
  ],
  ...
}
```

### Import (`/api/database/import`)
- Create new Lorebook rows (map old → new IDs).
- Create new LoreEntry rows.
- Update CharacterLorebook mappings.

## Modifications to Existing Code

### `lib/systemPrompt.ts`
- **`buildSystemPrompt()`** now takes an optional `constantLoreEntries?: LoreEntry[]`.
- After example dialogue, inject constant entries in a `<lore>` section.

### `lib/aiRequest.ts`
- **`buildConversationPrompt()`** now:
  1. Fetches the character's linked lorebooks.
  2. Triggers entries based on the last few messages + new user message.
  3. Checks keep-active status.
  4. Injects triggered lore as a temporary message before the user message.
  5. Returns metadata: `triggeredEntryIds: number[]`.
  6. Subtracts lore size from truncation limit.

### `lib/aiProvider.ts`
- Add `loreLimit` and `loreKeepActiveTurns` to `AIConfig`.
- Add getters for these settings with defaults.

### `pages/api/sessions/[id]/check-limit.ts`
- Include constant lore + triggered lore in the character count estimate.
- Include user prompt body (currently missing).
- Include DeepSeek thinking guidance (currently missing).

### `lib/apiLog.ts` / `persistRequestWithMeta()`
- Store `triggeredLoreEntryIds` in the debug metadata.
- Display as a badge on replies: `📖 3 entries`.

### `pages/api/chat/index.ts` and `pages/api/messages/[id]/variants.ts`
- Pass triggered entry IDs to the logging layer.
- No logic changes; the heavy lifting is in `buildConversationPrompt()`.

### `pages/api/database/export.ts` and `pages/api/database/import.ts`
- Include lorebooks and join table.

### `pages/api/sessions/[id]/clone.ts`
- Inherit the original session's character, which carries the lorebook links.
- No changes needed (already cascades).

## DeepSeek v4-Pro Limits Update

Update defaults in `lib/aiProvider.ts`:

| Setting | Current | DeepSeek v4-Pro | Reason |
|---------|---------|-----------------|--------|
| `DEFAULT_TRUNCATION_LIMIT` | 150,000 chars | 400,000 chars (~64K tokens at avg 0.16 chars/token) | v4-pro supports 128K context; 64K is safe |
| `DEFAULT_MAX_TOKENS` | 4,096 | 8,192 | v4-pro handles larger responses |
| `loreLimit` | N/A | 4,000 chars | New setting; reasonable default |
| `loreKeepActiveTurns` | N/A | 3 | New setting; standard behavior |

Make these configurable in Settings so other providers (OpenAI, OpenRouter) don't break.

## Stable History Trimming (Future, but add to backlog)

Once lore insertion is stable, add a `lastTrimmedMessageId` on ChatSession. When truncation happens:
- Move the cut point forward in larger steps (e.g., every 5 turns instead of every turn).
- Keep the cut point stable across requests so prompt caching discounts apply to more requests.
- Optionally trigger an auto-summary update at the cut point.

## Testing Strategy

1. **Unit tests** for keyword matching (whole-word, case-insensitive, full-message scan).
2. **Integration tests** for lore injection and truncation interaction.
3. **E2E tests** for the UI: create lorebook, add entries, generate keywords, link to character, send chat.
4. **Export/import round-trip:** lorebooks survive export and re-import.

