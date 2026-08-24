import prisma from '../../../lib/prisma';
import { forbidden } from '../../../lib/apiErrors';
import { schemas, validateBody } from '../../../lib/validate';
import { withApiHandler } from '../../../lib/withApiHandler';

type PurgeTarget = 'chats' | 'characters' | 'personas' | 'everything';

export default withApiHandler({}, {
  GET: async (_req, res) => {
    const [sessions, messages, characters, characterGroups, personas] = await Promise.all([
      prisma.chatSession.count(),
      prisma.chatMessage.count(),
      prisma.character.count(),
      prisma.characterGroup.count(),
      prisma.persona.count()
    ]);
    return res.status(200).json({ sessions, messages, characters, characterGroups, personas });
  },

  POST: async (req, res) => {
    const devMode = await prisma.setting.findUnique({ where: { key: 'devMode' } });
    if (devMode?.value !== 'true') {
      return forbidden(res, 'Developer mode required', 'DEV_MODE_REQUIRED');
    }

    const body = validateBody<{ target: PurgeTarget }>(schemas.purgeDatabase, req, res);
    if (!body) return;
    const { target } = body;

    const wipeCharacters = target === 'characters' || target === 'everything';
    const wipePersonas = target === 'personas' || target === 'everything';
    const wipeGroups = target === 'everything';

    // Children before parents; settings and user prompts are never touched.
    const deleted = await prisma.$transaction(async tx => {
      await tx.messageVersion.deleteMany({});
      const messages = await tx.chatMessage.deleteMany({});
      const sessions = await tx.chatSession.deleteMany({});
      const characters = wipeCharacters ? await tx.character.deleteMany({}) : { count: 0 };
      const personas = wipePersonas ? await tx.persona.deleteMany({}) : { count: 0 };
      const characterGroups = wipeGroups ? await tx.characterGroup.deleteMany({}) : { count: 0 };
      return {
        sessions: sessions.count,
        messages: messages.count,
        characters: characters.count,
        characterGroups: characterGroups.count,
        personas: personas.count
      };
    });

    return res.status(200).json({ deleted });
  },
});
