import prisma from '../../../../lib/prisma';
import { truncateMessagesIfNeeded, injectTruncationNote } from '../../../../lib/messageUtils';
import { apiKeyNotConfigured, badRequest, notFound, serverError } from '../../../../lib/apiErrors';
import { getAIConfig, tokenFieldFor, normalizeTemperature, type AIConfig } from '../../../../lib/aiProvider';
import { buildSystemPrompt, replacePlaceholders } from '../../../../lib/systemPrompt';
import { callUpstreamAI } from '../../../../lib/upstreamAI';
import { withApiHandler } from '../../../../lib/withApiHandler';

export default withApiHandler({ parseId: true }, {
  POST: async (req, res, { id }) => {
    // Resolve AI config
    const aiCfg = await getAIConfig();
    if ('error' in aiCfg) {
      if (aiCfg.code === 'NO_API_KEY') return apiKeyNotConfigured(res);
      return serverError(res, aiCfg.error, aiCfg.code);
    }
    const { apiKey, url: upstreamUrl, model, provider, enableTemperature, tokenFieldOverride, temperature, maxTokens: requestMaxTokens, truncationLimit, summaryPrompt } = aiCfg as AIConfig;

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

    // Check if there are new messages since lastSummary
    if (!session.lastSummary) {
      return badRequest(res, 'No previous summary found. Use generate summary instead.', 'NO_PREVIOUS_SUMMARY');
    }

    // Find messages that came after the lastSummary message
    const newMessages = messages.filter((msg: { id: number }) => msg.id > session.lastSummary!);

    if (newMessages.length === 0) {
      return badRequest(res, 'No new messages to summarize since last summary.', 'NO_NEW_MESSAGES');
    }

    // Build system prompt (INCLUDING existing summary)
    const systemContent = buildSystemPrompt(persona, character, {
      summary: session.summary || undefined,
    });

    // Format only the NEW messages (messages after lastSummary)
    const formattedNewMessages = newMessages.map((m: { role: string; content: string; }) => ({ 
      role: m.role, 
      content: m.content 
    }));

    // Replace placeholders in summary prompt
    const processedSummaryPrompt = replacePlaceholders(summaryPrompt, persona.name, character.name);

    // Create the system message for summary update
    const summaryUserMessage = `[System: ${processedSummaryPrompt}, this summary should keep in mind the context of the summary values in the initial system prompt.]`;

    const allMessages = [
      { role: 'system', content: systemContent },
      { role: 'user', content: '.' },
      ...formattedNewMessages, // Only include new messages
      { role: 'user', content: summaryUserMessage }
    ];

    const truncationResult = truncateMessagesIfNeeded(allMessages, truncationLimit);

    injectTruncationNote(truncationResult);

    const tokenField = tokenFieldFor(provider, model, tokenFieldOverride);
    const normTemp = normalizeTemperature(provider, model, temperature, enableTemperature);
    const body: any = {
      model,
      ...(normTemp !== undefined ? { temperature: normTemp } : {}),
      stream: false,
      ...(requestMaxTokens ? { [tokenField]: requestMaxTokens } : {}),
      messages: truncationResult.messages
    };

    // Call API
    const upstream = await callUpstreamAI({ url: upstreamUrl, apiKey, body });

    if (!upstream.ok) {
      return serverError(res, `API request failed: ${upstream.rawText || 'Unknown error'}`, 'UPSTREAM_API_ERROR');
    }

    const data = upstream.data;

    if (!data.choices || !data.choices[0]?.message?.content) {
      return serverError(res, 'Invalid API response format', 'INVALID_UPSTREAM_FORMAT');
    }

    const generatedUpdate = data.choices[0].message.content.trim();

    // Update the summary in the database by appending the new content
    const currentSummary = session.summary || '';
    const newSummary = currentSummary 
      ? `${currentSummary}\n\n${generatedUpdate}`
      : generatedUpdate;

    // Get the ID of the most recent message
    const mostRecentMessageId = messages.length > 0 
      ? messages[messages.length - 1]?.id || null
      : null;

    await prisma.chatSession.update({
      where: { id },
      data: { 
        summary: newSummary,
        lastSummary: mostRecentMessageId, // Update to the most recent message ID
        updatedAt: new Date()
      }
    });

    return res.status(200).json({ 
      summary: newSummary,
      generatedUpdate: generatedUpdate,
      lastSummary: mostRecentMessageId,
      newMessagesCount: newMessages.length
    });
  },
});
