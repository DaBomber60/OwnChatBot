import prisma from '../../../../lib/prisma';
import { notFound } from '../../../../lib/apiErrors';
import { getTruncationLimit } from '../../../../lib/aiProvider';
import { buildSystemPrompt } from '../../../../lib/systemPrompt';
import { withApiHandler } from '../../../../lib/withApiHandler';

export default withApiHandler({ parseId: true }, {
  GET: async (req, res, { id }) => {
    // Load session details
    const session = await prisma.chatSession.findUnique({
      where: { id },
      include: { 
        persona: true, 
        character: true,
        messages: {
          orderBy: { createdAt: 'asc' }
        }
      }
    });

    if (!session) {
      return notFound(res, 'Session not found', 'SESSION_NOT_FOUND');
    }

    const { persona, character, messages } = session;

    // Build system prompt (including summary if present)
    const systemContent = buildSystemPrompt(persona, character, {
      summary: session.summary || undefined,
    });

    // Format history with persona name prefix for user messages
    const formattedHistory = messages.map((m) => {
      if (m.role === 'user') {
        const content = m.content.startsWith(`${persona.name}: `) 
          ? m.content 
          : `${persona.name}: ${m.content}`;
        return { role: m.role, content };
      }
      return { role: m.role, content: m.content };
    });

    // Calculate total character count as it would be sent to API
    const allMessages = [
      { role: 'system', content: systemContent },
      { role: 'user', content: '.' },
      ...formattedHistory
    ];

    const totalCharacters = allMessages.reduce((sum, msg) => sum + msg.content.length, 0);
    // Use settings-based limit with defaults
    const limit = await getTruncationLimit();
    const warningThreshold = Math.floor(limit * 0.9); // 90% of limit
    
    const isApproachingLimit = totalCharacters >= warningThreshold;
    const hasNoSummary = !session.summary || session.summary.trim() === '';
    const shouldBlock = isApproachingLimit && hasNoSummary;

    return res.status(200).json({
      totalCharacters,
      limit,
      warningThreshold,
      percentage: Math.round((totalCharacters / limit) * 100),
      isApproachingLimit,
      hasNoSummary,
      shouldBlock,
      messageCount: messages.length
    });
  },
});
