-- AddColumn metadata to ChatMessage for storing triggered lore IDs and other metadata
ALTER TABLE "chat_messages" ADD COLUMN "metadata" TEXT;
