-- AlterTable
ALTER TABLE "chat_sessions" ADD COLUMN "globalLoreEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "chat_session_lorebooks" (
    "id" SERIAL NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "lorebookId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_session_lorebooks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_session_lorebooks_lorebookId_idx" ON "chat_session_lorebooks"("lorebookId");

-- CreateIndex
CREATE UNIQUE INDEX "chat_session_lorebooks_sessionId_lorebookId_key" ON "chat_session_lorebooks"("sessionId", "lorebookId");

-- AddForeignKey
ALTER TABLE "chat_session_lorebooks" ADD CONSTRAINT "chat_session_lorebooks_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_session_lorebooks" ADD CONSTRAINT "chat_session_lorebooks_lorebookId_fkey" FOREIGN KEY ("lorebookId") REFERENCES "lorebooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Ensure the global lorebook (id 0) exists. Production deploys run migrations but not the seed.
INSERT INTO "lorebooks" ("id", "name", "description", "createdAt", "updatedAt")
VALUES (0, 'Global Lorebook', 'This lorebook applies to all chats by default.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

-- Existing chats keep the lorebooks their character was linked to.
INSERT INTO "chat_session_lorebooks" ("sessionId", "lorebookId")
SELECT s."id", cl."lorebookId"
FROM "chat_sessions" s
JOIN "character_lorebooks" cl ON cl."characterId" = s."characterId"
WHERE cl."lorebookId" <> 0
ON CONFLICT DO NOTHING;

-- Carry over per-chat global lore overrides (and a disabled user-level default) from settings keys.
UPDATE "chat_sessions" s
SET "globalLoreEnabled" = false
WHERE EXISTS (
    SELECT 1 FROM "settings" st
    WHERE st."key" = 'globalLoreEnabled_' || s."id" AND st."value" = 'false'
)
OR (
    EXISTS (SELECT 1 FROM "settings" st WHERE st."key" = 'globalLoreEnabled' AND st."value" = 'false')
    AND NOT EXISTS (
        SELECT 1 FROM "settings" st
        WHERE st."key" = 'globalLoreEnabled_' || s."id" AND st."value" = 'true'
    )
);

DELETE FROM "settings" WHERE "key" ~ '^globalLoreEnabled_[0-9]+$';
