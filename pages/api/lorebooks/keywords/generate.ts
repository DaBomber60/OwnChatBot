import { withApiHandler } from '../../../../lib/withApiHandler';
import { badRequest, serverError, apiKeyNotConfigured, upstreamError, classifyUpstreamStatus } from '../../../../lib/apiErrors';
import { schemas, validateBody } from '../../../../lib/validate';
import { getAIConfig } from '../../../../lib/aiProvider';
import { callUpstreamAI } from '../../../../lib/upstreamAI';

/**
 * POST /api/lorebooks/keywords/generate
 * 
 * Generate keyword suggestions for a lore entry using the configured AI model.
 * 
 * Body: { content: string; entryTitle?: string }
 * 
 * Returns: { keywords: string[]; reasoning?: string }
 */
export default withApiHandler({}, {
  POST: async (req, res) => {
    const body = validateBody(schemas.generateLoreKeywords, req, res);
    if (!body) return;

    const { content, entryTitle } = body as any;

    try {
      const cfg = await getAIConfig();
      if ('error' in cfg) {
        if (cfg.code === 'NO_API_KEY') {
          return apiKeyNotConfigured(res);
        }
        return badRequest(res, cfg.error, cfg.code);
      }

      // Build the keyword generation prompt
      const entryTitlePart = entryTitle ? `Title: ${entryTitle}\n\n` : '';
      const prompt = `You are an expert at analyzing text and extracting relevant keywords for triggering contextual information.

${entryTitlePart}Content:
${content}

Analyze the above lore entry and suggest 3-8 keywords that would naturally trigger this content in a conversation. 

Requirements:
- Each keyword should be 1-3 words
- Keywords should be lowercase
- Keywords should capture the main themes, entities, or concepts
- Include both obvious and subtle triggers
- Format: return ONLY a JSON object with this structure:
{
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "reasoning": "Brief explanation of why these keywords were chosen"
}

Return ONLY the JSON object, no other text.`;

      // Call the AI model via the upstream helper
      const upstreamResponse = await callUpstreamAI({
        url: cfg.url,
        apiKey: cfg.apiKey,
        body: {
          model: cfg.model,
          messages: [
            {
              role: 'user',
              content: prompt,
            }
          ],
          temperature: 1.2, // Balanced creativity and variety in keyword suggestions
          max_tokens: 500, // Keywords don't need many tokens
        },
        timeoutMs: 30000,
      });

      if (!upstreamResponse.ok) {
        const status = upstreamResponse.status;
        const code = classifyUpstreamStatus(status, upstreamResponse.rawText);
        return upstreamError(res, {
          code,
          message: `AI provider error: ${status}`,
          upstreamStatus: status,
        });
      }

      // Parse the response
      const aiContent = upstreamResponse.data?.choices?.[0]?.message?.content;
      if (!aiContent) {
        return serverError(res, 'AI model returned empty response', 'AI_EMPTY_RESPONSE');
      }

      // Extract JSON from response (handle cases where AI wraps it in markdown)
      const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return serverError(res, 'Failed to parse AI response as JSON', 'AI_PARSE_FAILED');
      }

      let parsed: any;
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        return serverError(res, 'Failed to parse AI response', 'PARSE_ERROR');
      }
      
      // Validate the response structure
      if (!Array.isArray(parsed.keywords)) {
        return serverError(res, 'AI response keywords is not an array', 'AI_INVALID_RESPONSE');
      }

      // Normalize keywords: trim, lowercase, deduplicate
      const normalized = Array.from(new Set(
        parsed.keywords
          .map((k: any) => String(k).trim().toLowerCase())
          .filter((k: string) => k.length > 0 && k.length <= 50)
      ));

      return res.status(200).json({
        keywords: normalized,
        reasoning: parsed.reasoning || undefined,
      });
    } catch (error: unknown) {
      console.error('[generateKeywords] Error:', error);
      if (error instanceof Error && error.name === 'AbortError') {
        return upstreamError(res, {
          code: 'UPSTREAM_TIMEOUT',
          message: 'AI provider request timeout',
        });
      }

      return serverError(res, 'Failed to generate keywords', 'KEYWORD_GENERATION_FAILED');
    }
  },
});
