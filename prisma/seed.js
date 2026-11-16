// Idempotent seed: `npx prisma db seed` (run by `npm run db:setup`).
// Plain JS so it runs with node alone. The lorebooks migration also creates the global lorebook,
// so this only matters for databases built with `prisma db push`.
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

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
  console.log('✅ Global lorebook ensured:', globalLorebook.name);

  // Whether new chats start with the global lorebook enabled (unset also means enabled).
  await prisma.setting.upsert({
    where: { key: 'globalLoreEnabled' },
    update: {},
    create: { key: 'globalLoreEnabled', value: 'true' },
  });
  console.log('✅ Global lore default ensured');

  console.log('🌱 Seeding complete!');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
