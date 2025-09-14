-- Baseline initial migration regenerated 2025-09-19 to replace corrupted prior file
-- Schema: ownchatbot

CREATE TABLE "personas" (
    "id" SERIAL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "profileName" TEXT,
    "profile" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "character_groups" (
    "id" SERIAL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "isCollapsed" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "characters" (
    "id" SERIAL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "profileName" TEXT,
    "bio" TEXT,
    "scenario" TEXT NOT NULL,
    "personality" TEXT NOT NULL,
    "firstMessage" TEXT NOT NULL,
    "exampleDialogue" TEXT NOT NULL,
    "groupId" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "chat_sessions" (
    "id" SERIAL PRIMARY KEY,
    "personaId" INTEGER NOT NULL,
    "characterId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastApiRequest" TEXT,
    "lastApiResponse" TEXT,
    "summary" TEXT,
    "description" TEXT,
    "lastSummary" INTEGER,
    "notes" TEXT
);

CREATE TABLE "chat_messages" (
    "id" SERIAL PRIMARY KEY,
    "sessionId" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "message_versions" (
    "id" SERIAL PRIMARY KEY,
    "messageId" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "user_prompts" (
    "id" SERIAL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "settings" (
    "key" TEXT PRIMARY KEY,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- Indexes & Constraints
CREATE UNIQUE INDEX "personas_name_profileName_key" ON "personas"("name", "profileName");
CREATE UNIQUE INDEX "character_groups_name_key" ON "character_groups"("name");
CREATE INDEX "characters_groupId_idx" ON "characters"("groupId");
CREATE UNIQUE INDEX "characters_name_profileName_key" ON "characters"("name", "profileName");
CREATE INDEX "chat_sessions_personaId_idx" ON "chat_sessions"("personaId");
CREATE INDEX "chat_sessions_characterId_idx" ON "chat_sessions"("characterId");
CREATE INDEX "chat_sessions_updatedAt_idx" ON "chat_sessions"("updatedAt");
CREATE UNIQUE INDEX "chat_sessions_personaId_characterId_createdAt_key" ON "chat_sessions"("personaId", "characterId", "createdAt");
CREATE INDEX "chat_messages_sessionId_idx" ON "chat_messages"("sessionId");
CREATE INDEX "chat_messages_createdAt_idx" ON "chat_messages"("createdAt");
CREATE INDEX "message_versions_messageId_idx" ON "message_versions"("messageId");
CREATE UNIQUE INDEX "message_versions_messageId_version_key" ON "message_versions"("messageId", "version");
CREATE UNIQUE INDEX "user_prompts_title_key" ON "user_prompts"("title");

ALTER TABLE "characters" ADD CONSTRAINT "characters_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "character_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "personas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "message_versions" ADD CONSTRAINT "message_versions_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
