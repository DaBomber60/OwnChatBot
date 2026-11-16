import prisma from '../../../../lib/prisma';
import { notFound } from '../../../../lib/apiErrors';
import { getTruncationLimit, getAIConfig, DEFAULT_LORE_KEEP_ACTIVE_TURNS, DEFAULT_LORE_LIMIT } from '../../../../lib/aiProvider';
import { buildSystemPrompt } from '../../../../lib/systemPrompt';
import { injectConstantLoreIntoSystemPrompt, appendTriggeredLoreToLastUserMessage } from '../../../../lib/lorebook/injection';
import { resolveLoreForTurnSafe, latestUserMessageText } from '../../../../lib/lorebook/integration';
import { normalizeLorebookIds } from '../../../../lib/lorebook/sessionLorebooks';
import { loadUserPromptBody } from '../../../../lib/aiRequest';
import { withApiHandler } from '../../../../lib/withApiHandler';

export default withApiHandler({ parseId: true }, {
  GET: async (req, res, { id }) => {
    // Load session details
    const session = await prisma.chatSession.findUnique({
      where: { id },
      include: { 
        persona: true, 
        character: true,
        lorebooks: { select: { lorebookId: true } },
        messages: {
          orderBy: { createdAt: 'asc' }
        }
      }
    });

    if (!session) {
      return notFound(res, 'Session not found', 'SESSION_NOT_FOUND');
    }

    const { persona, character, messages } = session;
    const aiCfg = await getAIConfig();
    const truncationLimit = 'error' in aiCfg ? 400000 : aiCfg.truncationLimit;

    // Build system prompt (including summary if present)
    let systemContent = buildSystemPrompt(persona, character, {
      summary: session.summary || undefined,
    });

    // Load and append user prompt if configured
    const userPromptBody = await loadUserPromptBody().catch(() => '');

    const lore = await resolveLoreForTurnSafe({
      config: {
        lorebookIds: normalizeLorebookIds(session.lorebooks.map(l => l.lorebookId)),
        globalLoreEnabled: session.globalLoreEnabled,
      },
      history: messages,
      currentMessageText: latestUserMessageText(messages),
      keepActiveTurns: 'error' in aiCfg ? DEFAULT_LORE_KEEP_ACTIVE_TURNS : aiCfg.loreKeepActiveTurns,
      loreLimit: 'error' in aiCfg ? DEFAULT_LORE_LIMIT : aiCfg.loreLimit,
    }, '[check-limit]');
    systemContent = injectConstantLoreIntoSystemPrompt(systemContent, lore.constantEntries);

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
      ...appendTriggeredLoreToLastUserMessage(formattedHistory, lore.triggeredEntries),
    ];

    const totalCharacters = allMessages.reduce((sum, msg) => sum + msg.content.length, 0);
    const warningThreshold = Math.floor(truncationLimit * 0.9); // 90% of limit
    
    const isApproachingLimit = totalCharacters >= warningThreshold;
    const hasNoSummary = !session.summary || session.summary.trim() === '';
    const shouldBlock = isApproachingLimit && hasNoSummary;

    return res.status(200).json({
      totalCharacters,
      limit: truncationLimit,
      warningThreshold,
      percentage: Math.round((totalCharacters / truncationLimit) * 100),
      isApproachingLimit,
      hasNoSummary,
      shouldBlock,
      messageCount: messages.length,
      contextWarnedAt: session.contextWarnedAt,
    });
  },

  // Records that the "context nearly full" prompt has been shown, so it only appears once.
  POST: async (_req, res, { id }) => {
    const updated = await prisma.chatSession.updateMany({
      where: { id },
      data: { contextWarnedAt: new Date() },
    });
    if (updated.count === 0) return notFound(res, 'Session not found', 'SESSION_NOT_FOUND');
    return res.status(200).json({ ok: true });
  },
});
