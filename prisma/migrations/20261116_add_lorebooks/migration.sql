-- CreateTable "lorebooks"
CREATE TABLE "lorebooks" (
    "id" SERIAL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- CreateTable "lore_entries"
CREATE TABLE "lore_entries" (
    "id" SERIAL PRIMARY KEY,
    "lorebookId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "keys" TEXT NOT NULL,
    "constant" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "lore_entries_lorebookId_fkey" FOREIGN KEY ("lorebookId") REFERENCES "lorebooks"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable "character_lorebooks"
CREATE TABLE "character_lorebooks" (
    "id" SERIAL PRIMARY KEY,
    "characterId" INTEGER NOT NULL,
    "lorebookId" INTEGER NOT NULL,
    CONSTRAINT "character_lorebooks_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "character_lorebooks_lorebookId_fkey" FOREIGN KEY ("lorebookId") REFERENCES "lorebooks"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex on lorebooks.name (unique)
CREATE UNIQUE INDEX "lorebooks_name_key" ON "lorebooks"("name");

-- CreateIndex on lore_entries.lorebookId
CREATE INDEX "lore_entries_lorebookId_idx" ON "lore_entries"("lorebookId");

-- CreateIndex unique on character_lorebooks
CREATE UNIQUE INDEX "character_lorebooks_characterId_lorebookId_key" ON "character_lorebooks"("characterId", "lorebookId");


