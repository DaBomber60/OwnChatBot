import { getAIConfig, buildDeepSeekThinking } from '../../../lib/aiProvider';
import type { AIConfig } from '../../../lib/aiProvider';
import { callUpstreamAI } from '../../../lib/upstreamAI';
import { withApiHandler } from '../../../lib/withApiHandler';
import { serverError, apiKeyNotConfigured } from '../../../lib/apiErrors';

export default withApiHandler({}, {
  POST: async (_req, res) => {
    const cfg = await getAIConfig();
    if ('error' in cfg) return apiKeyNotConfigured(res);

    const body: Record<string, any> = {
      model: cfg.model,
      messages: [
        {
          role: 'system',
          content:
            'You are a connection test system, designed to repsond with single-word responses. In the case a user sends "ping!", you must always return "pong!"',
        },
        { role: 'user', content: 'ping!' },
      ],
      max_tokens: 16,
      stream: false,
      ...buildDeepSeekThinking(cfg as AIConfig),
    };

    const start = Date.now();
    try {
      const controller = new AbortController();
      // Hard 15-second server-side timeout
      const timeout = setTimeout(() => controller.abort(), 15_000);

      const upstream = await callUpstreamAI({
        url: cfg.url,
        apiKey: cfg.apiKey,
        body,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const latencyMs = Date.now() - start;

      if (!upstream.ok) {
        return res.status(502).json({
          ok: false,
          latencyMs,
          provider: cfg.provider,
          error: upstream.data?.error?.message || upstream.rawText || 'Upstream error',
        });
      }

      const content =
        upstream.data?.choices?.[0]?.message?.content ?? null;

      return res.status(200).json({
        ok: true,
        latencyMs,
        provider: cfg.provider,
        model: upstream.data?.model || cfg.model,
        content,
      });
    } catch (err: any) {
      const latencyMs = Date.now() - start;
      if (err?.name === 'AbortError') {
        return res.status(504).json({
          ok: false,
          latencyMs,
          provider: cfg.provider,
          error: 'Request timed out after 15 seconds',
        });
      }
      return serverError(res, err);
    }
  },
});
