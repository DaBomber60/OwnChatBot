import prisma from './prisma';

export async function getPasswordVersion(): Promise<number> {
  const versionSetting = await prisma.setting.findUnique({ where: { key: 'authPasswordVersion' } });
  if (!versionSetting) return 1;
  const parsed = parseInt(versionSetting.value, 10);
  return isNaN(parsed) ? 1 : parsed;
}
