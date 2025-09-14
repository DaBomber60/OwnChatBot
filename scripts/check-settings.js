const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkSettings() {
  try {
    console.log('=== Current Settings in Database ===');
    const settings = await prisma.setting.findMany();
    settings.forEach((s) => console.log(`${s.key}: ${s.value}`));

    console.log('\n=== Looking for summaryPrompt specifically ===');
    const summaryPrompt = await prisma.setting.findUnique({ where: { key: 'summaryPrompt' } });
    if (summaryPrompt) {
      console.log('✅ summaryPrompt found:');
      console.log(summaryPrompt.value);
    } else {
      console.log('❌ summaryPrompt not found in database');
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkSettings();
