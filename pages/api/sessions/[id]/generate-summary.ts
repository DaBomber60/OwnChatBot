import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../../lib/prisma';
import { truncateMessagesIfNeeded } from '../../../../lib/messageUtils';
import { requireAuth } from '../../../../lib/apiAuth';
import { apiKeyNotConfigured, badRequest, methodNotAllowed, notFound, serverError } from '../../../../lib/apiErrors';
import { getAIConfig, tokenFieldFor, normalizeTemperature, DEFAULT_FALLBACK_URL, type AIConfig } from '../../../../lib/aiProvider';
import { parseId } from '../../../../lib/validate';
import { buildSystemPrompt, replacePlaceholders } from '../../../../lib/systemPrompt';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireAuth(req, res))) return;
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return methodNotAllowed(res, req.method);
  }

  const sessionId = parseId(req.query.id);

  if (sessionId === null) {
    return badRequest(res, 'Invalid session ID', 'INVALID_SESSION_ID');
  }

  try {
    // Resolve AI config (api key, provider, model, URL)
    const aiCfg = await getAIConfig();
    if ('error' in aiCfg) {
      if (aiCfg.code === 'NO_API_KEY') return apiKeyNotConfigured(res);
      return serverError(res, aiCfg.error, aiCfg.code);
    }
  const { apiKey, url: upstreamUrl, model, provider, enableTemperature, tokenFieldOverride, temperature, maxTokens: requestMaxTokens, truncationLimit, summaryPrompt } = aiCfg as AIConfig;

    // Load session details
    const session = await prisma.chatSession.findUnique({
      where: { id: sessionId },
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

    // Build system prompt (without summary since we're generating it)
    const systemContent = buildSystemPrompt(persona, character);

    // Format conversation history
    const formattedHistory = messages.map((m: { role: string; content: string; }) => ({ 
      role: m.role, 
      content: m.content 
    }));

    // Replace placeholders in summary prompt
    const processedSummaryPrompt = replacePlaceholders(summaryPrompt, persona.name, character.name);

    // Create the system message for summary generation
    const summaryUserMessage = `[System: ${processedSummaryPrompt}]`;

    const allMessages = [
      { role: 'system', content: systemContent },
      { role: 'user', content: '.' },
      ...formattedHistory,
      { role: 'user', content: summaryUserMessage }
    ];

    const truncationResult = truncateMessagesIfNeeded(allMessages, truncationLimit);

    // Add truncation note to system message if truncation occurred
    if (truncationResult.wasTruncated) {
      const systemMessage = truncationResult.messages[0];
      if (systemMessage && systemMessage.role === 'system') {
        systemMessage.content += '\n\n<truncation_note>The earliest messages of this conversation have been truncated for token count reasons, please see summary section above for any lost detail</truncation_note>';
      }
    }

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
    const apiRes = await fetch(upstreamUrl || DEFAULT_FALLBACK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!apiRes.ok) {
      const errorText = await apiRes.text();
      return serverError(res, `API request failed: ${errorText}`, 'UPSTREAM_API_ERROR');
    }

    const data = await apiRes.json();

    if (!data.choices || !data.choices[0]?.message?.content) {
      return serverError(res, 'Invalid API response format', 'INVALID_UPSTREAM_FORMAT');
    }

    const generatedSummary = data.choices[0].message.content.trim();

    // Update the summary in the database
    const currentSummary = session.summary || '';
    const newSummary = currentSummary 
      ? `${currentSummary}\n\n${generatedSummary}`
      : generatedSummary;

    // Get the ID of the most recent message
    const mostRecentMessageId = messages.length > 0 
      ? messages[messages.length - 1]?.id || null
      : null;

    await prisma.chatSession.update({
      where: { id: sessionId },
      data: { 
        summary: newSummary,
        lastSummary: mostRecentMessageId, // Store the ID of the most recent message when summary was generated
        updatedAt: new Date()
      }
    });

    return res.status(200).json({ 
      summary: newSummary,
      generatedSummary: generatedSummary,
      lastSummary: mostRecentMessageId
    });

  } catch (error) {
    console.error('Summary generation error:', error);
    return serverError(res);
  }
}
