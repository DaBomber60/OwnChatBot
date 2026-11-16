-- AlterTable
ALTER TABLE "character_groups" ADD COLUMN "avatarUpdatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "characters" ADD COLUMN "avatarUpdatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "character_group_avatars" (
    "groupId" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "character_group_avatars_pkey" PRIMARY KEY ("groupId")
);

-- CreateTable
CREATE TABLE "character_avatars" (
    "characterId" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "character_avatars_pkey" PRIMARY KEY ("characterId")
);

-- AddForeignKey
ALTER TABLE "character_group_avatars" ADD CONSTRAINT "character_group_avatars_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "character_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "character_avatars" ADD CONSTRAINT "character_avatars_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
