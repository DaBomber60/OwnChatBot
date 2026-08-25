-- Tracks the one-time "context window is nearly full" warning per chat.
-- Nullable on purpose: NULL means "never warned", which is the correct reading for
-- every chat that existed before this migration, so no backfill is needed.
ALTER TABLE "chat_sessions" ADD COLUMN "contextWarnedAt" TIMESTAMP(3);
