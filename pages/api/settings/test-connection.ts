import { getAIConfig, buildDeepSeekThinking } from '../../../lib/aiProvider';
import type { AIConfig } from '../../../lib/aiProvider';
import { callUpstreamAI, upstreamTimeoutMs } from '../../../lib/upstreamAI';
import { withApiHandler } from '../../../lib/withApiHandler';
import { apiKeyNotConfigured, upstreamError, classifyUpstreamStatus } from '../../../lib/apiErrors';
import { redactString } from '../../../lib/redact';

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
    const timeoutMs = upstreamTimeoutMs(cfg as AIConfig, false);
    try {
      const upstream = await callUpstreamAI({
        url: cfg.url,
        apiKey: cfg.apiKey,
        body,
        timeoutMs,
      });

      const latencyMs = Date.now() - start;

      if (!upstream.ok) {
        const message = redactString(upstream.data?.error?.message || upstream.rawText || 'Upstream error');
        return upstreamError(res, {
          code: classifyUpstreamStatus(upstream.status, message),
          message,
          upstreamStatus: upstream.status,
          extra: { ok: false, latencyMs, provider: cfg.provider },
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
      const timedOut = err?.name === 'AbortError' || err?.name === 'TimeoutError';
      return upstreamError(res, {
        code: timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_API_ERROR',
        message: timedOut
          ? `Request timed out after ${Math.round(timeoutMs / 1000)} seconds`
          : redactString(err?.message || 'Connection test failed'),
        status: timedOut ? 504 : 502,
        extra: { ok: false, latencyMs, provider: cfg.provider },
      });
    }
  },
});
