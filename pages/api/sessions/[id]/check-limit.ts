import prisma from '../../../../lib/prisma';
import { notFound } from '../../../../lib/apiErrors';
import { getTruncationLimit, getAIConfig } from '../../../../lib/aiProvider';
import { buildSystemPrompt } from '../../../../lib/systemPrompt';
import { injectConstantLoreIntoSystemPrompt, buildTriggeredLoreInjection } from '../../../../lib/lorebook/injection';
import { collectConstantEntries, collectActiveEntries, type TriggerContext } from '../../../../lib/lorebook/trigger';
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

    // Inject constant lore into system prompt
    try {
      const constantEntries = await collectConstantEntries(character.id);
      systemContent = injectConstantLoreIntoSystemPrompt(systemContent, constantEntries);
    } catch (err) {
      console.warn('[check-limit] Failed to load constant lore:', err);
    }

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

    // Estimate lore injection for the most recent user message
    let loreInjectionContent = '';
    if (formattedHistory.length > 0) {
      const lastUserMsg = [...formattedHistory].reverse().find(m => m.role === 'user');
      if (lastUserMsg) {
        try {
          const triggerContext: TriggerContext = {
            sessionId: session.id,
            characterId: character.id,
            currentMessageText: lastUserMsg.content,
            history: formattedHistory,
            keepActiveTurns: 'error' in aiCfg ? 2 : aiCfg.loreKeepActiveTurns,
          };
          const triggeredEntries = await collectActiveEntries(triggerContext);
          const { content } = buildTriggeredLoreInjection(triggeredEntries);
          loreInjectionContent = content;
        } catch (err) {
          console.warn('[check-limit] Failed to load triggered lore:', err);
        }
      }
    }

    // Calculate total character count as it would be sent to API
    const allMessages = [
      { role: 'system', content: systemContent },
      ...formattedHistory.map((m, idx) => {
        // Add lore injection estimate to the last user message
        if (idx === formattedHistory.length - 1 && m.role === 'user') {
          return { role: m.role, content: m.content + loreInjectionContent };
        }
        return m;
      })
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
