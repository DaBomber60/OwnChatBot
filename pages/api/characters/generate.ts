import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAuth } from '../../../lib/apiAuth';
import { apiKeyNotConfigured, badRequest, methodNotAllowed, serverError } from '../../../lib/apiErrors';
import { getAIConfig, tokenFieldFor, normalizeTemperature } from '../../../lib/aiProvider';
import prisma from '../../../lib/prisma';
import { schemas, validateBody } from '../../../lib/validate';

// This endpoint does NOT persist a character; it returns generated fields so the client can review/edit then save.
// POST /api/characters/generate
// Body: { name, profileName?, description, sliders?: { key: number } }
// Returns: { scenario, personality, firstMessage, exampleDialogue, rawPrompt }

const DEFAULT_FALLBACK_URL = 'https://api.deepseek.com/chat/completions';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireAuth(req, res))) return;
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return methodNotAllowed(res, req.method);
  }

  const body = validateBody(schemas.generateCharacter, req, res);
  if (!body) return; // validation already responded
  const { name, profileName, description, sliders, perspective = 'first' } = body as any;

  try {
    const aiCfg = await getAIConfig();
    if ('error' in aiCfg) {
      if (aiCfg.code === 'NO_API_KEY') return apiKeyNotConfigured(res);
      return serverError(res, aiCfg.error, aiCfg.code);
    }
    const { apiKey, url: upstreamUrl, model, provider, enableTemperature, tokenFieldOverride } = aiCfg as any;

    // Pull optional temperature setting
    let temperature = 0.7;
    try {
      const setting = await prisma.setting.findUnique({ where: { key: 'temperature' } });
      if (setting?.value) {
        const t = parseFloat(setting.value);
        if (!isNaN(t)) temperature = t;
      }
    } catch {}

    const tokenField = tokenFieldFor(provider, model, tokenFieldOverride);
    const normTemp = normalizeTemperature(provider, model, temperature, enableTemperature);

    // Build structured parameters list for prompt
    const sliderText = sliders && Object.keys(sliders).length
      ? Object.entries(sliders).map(([k, v]) => `${k}: ${v}`).join('; ')
      : 'NONE (assistant may determine appropriate values)';

    // Provide instructions to produce four clearly delimited sections
    const perspectiveLine = perspective === 'third'
      ? `This will be in third person, allowing the assistant to take control of the world in general, as well as ${name || 'Character'}.`
      : `This will be in first person, allowing the assistant to take full control of ${name || 'Character'}. But add some third-person context inside * *like this*.`;

    const systemInstructions = `You are an assistant that creates detailed AI chat character profiles. Return concise but vivid content. Avoid repeating the user description verbatim: expand and enrich it.
Return JSON ONLY with keys: scenario, personality, firstMessage, exampleDialogue. In all situations, when teferring to the user's character, use the placeholder \`{{user}}\`. Separate paragraphs with 2 new line characters '\n' to keep everything readable. Formatting notes: Dialogue must always be contained "within double quoutes", thoughts must be be *italicised*, and high-impact words must be **bold**
Perspective: ${perspective.toUpperCase()} POV. ${perspectiveLine}
- scenario: at least 3 paragraphs establishing context/backstory, be creative and create a scenario that will engulf the user and give them reason to engage with and continue this story. This should give a sense of direction for the story in the medium-long term. This should be 500-1000 words. 
- personality: a hybrid section of at least 3 paragraphs and bullet points, highlighting specific traits, behaviors, and physical appearance of the character (no markdown bullets, just plain medium to long sentences). This should be 400-800 words, ALWAYS INCLUDE at least 10 bullet point details. Bullet points should be in markdown format.
- firstMessage: An scene-setting opening that is at least 3 paragraphs long, this should fit the scenario and personality, and be a lunch-pad into a long-form open-ended story between ${name || 'Character'} and \`{{user}}\`. This should be at least 500 words in length.
- exampleDialogue: 3-6 alternating example dialogue exchanges in the format: Character: line\nUser: line ... DO NOT include names other than ${name || 'Character'} and \`{{user}}\`. Keep it natural. This section should be at least 200 words.`;

  const userPrompt = `Generate a character based on the following user description: "${description}"\nName: ${name}${profileName ? ` (Profile Name: ${profileName})` : ''}\nPerspective: ${perspective}\nParameters (0-100 each, AUTO indicates you should determine the inherit strength of these modifiers based on context): ${sliderText}\nEmphasize coherence across sections.`;

    const messages = [
      { role: 'system', content: systemInstructions },
      { role: 'user', content: userPrompt }
    ];

    // Token limit logic similar to other endpoints
    let requestMaxTokens: number | undefined = 2048;
    try {
      const maxTokensSetting = await prisma.setting.findUnique({ where: { key: 'maxTokens' } });
      if (maxTokensSetting?.value) {
        const parsed = parseInt(maxTokensSetting.value);
        if (!isNaN(parsed)) requestMaxTokens = Math.max(512, Math.min(8192, parsed));
      }
    } catch {}

    const bodyPayload: any = {
      model,
      ...(normTemp !== undefined ? { temperature: normTemp } : {}),
      stream: false,
      ...(requestMaxTokens ? { [tokenField]: requestMaxTokens } : {}),
      messages
    };

    const upstreamRes = await fetch(upstreamUrl || DEFAULT_FALLBACK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(bodyPayload)
    });

    if (!upstreamRes.ok) {
      const text = await upstreamRes.text();
      return serverError(res, 'Generation API error: ' + text, 'UPSTREAM_API_ERROR');
    }

    const data = await upstreamRes.json();
    const content: string | undefined = data?.choices?.[0]?.message?.content;
    if (!content) return serverError(res, 'Malformed upstream response', 'INVALID_UPSTREAM');

    // Attempt to parse JSON block; if model wrapped it in markdown fences, strip them.
    const cleaned = content.replace(/^```json\n?|```$/g, '').trim();
    let parsed: any;
    try { parsed = JSON.parse(cleaned); } catch {
      // Try to extract JSON via regex fallback
      const match = content.match(/\{[\s\S]*\}/);
      if (match) {
        try { parsed = JSON.parse(match[0]); } catch {}
      }
    }

    if (!parsed || typeof parsed !== 'object') {
      return res.status(200).json({
        scenario: '',
        personality: '',
        firstMessage: '',
        exampleDialogue: '',
        raw: content,
        warning: 'Could not parse JSON; raw content returned'
      });
    }

    return res.status(200).json({
      scenario: parsed.scenario || '',
      personality: parsed.personality || '',
      firstMessage: parsed.firstMessage || '',
      exampleDialogue: parsed.exampleDialogue || '',
      rawPrompt: userPrompt,
      perspective
    });
  } catch (err) {
    console.error('Character generation error:', err);
    return serverError(res, 'Failed to generate character', 'CHARACTER_GENERATE_FAILED');
  }
}
