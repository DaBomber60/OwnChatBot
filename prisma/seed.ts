import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Ensure global lorebook exists with ID 0
  const globalLorebook = await prisma.lorebook.upsert({
    where: { id: 0 },
    update: {
      name: 'Global Lorebook',
      description: 'This lorebook applies to all chats by default.',
    },
    create: {
      id: 0,
      name: 'Global Lorebook',
      description: 'This lorebook applies to all chats by default.',
    },
  });

  console.log('✅ Global lorebook ensured:', globalLorebook);

  // Ensure user-level global lore setting exists
  const globalLoreSetting = await prisma.setting.upsert({
    where: { key: 'globalLoreEnabled' },
    update: {}, // Don't change if it exists
    create: {
      key: 'globalLoreEnabled',
      value: 'true',
    },
  });

  console.log('✅ Global lore setting ensured:', globalLoreSetting);

  console.log('🌱 Seeding complete!');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
