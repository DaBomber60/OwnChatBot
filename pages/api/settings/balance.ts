import { getAIConfig } from '../../../lib/aiProvider';
import type { AIConfig } from '../../../lib/aiProvider';
import { upstreamTimeoutMs } from '../../../lib/upstreamAI';
import { withApiHandler } from '../../../lib/withApiHandler';
import { apiKeyNotConfigured, badRequest, upstreamError, classifyUpstreamStatus } from '../../../lib/apiErrors';
import { redactString } from '../../../lib/redact';

export default withApiHandler({}, {
  GET: async (_req, res) => {
    const cfg = await getAIConfig();
    if ('error' in cfg) return apiKeyNotConfigured(res);

    if (cfg.provider !== 'deepseek') {
      return badRequest(res, 'Balance check is only available for the DeepSeek provider', 'PROVIDER_UNSUPPORTED');
    }

    const timeoutMs = upstreamTimeoutMs(cfg as AIConfig, false);
    try {
      // Not a completions call, so it can't go through callUpstreamAI.
      const upstream = await fetch('https://api.deepseek.com/user/balance', {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${cfg.apiKey}`,
        },
        signal: AbortSignal.timeout(timeoutMs),
      });

      const data = await upstream.json().catch(() => undefined);

      if (!upstream.ok) {
        const message = redactString(data?.error?.message || data?.detail || 'Failed to fetch balance');
        return upstreamError(res, {
          code: classifyUpstreamStatus(upstream.status, message),
          message,
          upstreamStatus: upstream.status,
        });
      }

      return res.status(200).json(data);
    } catch (err: any) {
      const timedOut = err?.name === 'AbortError' || err?.name === 'TimeoutError';
      return upstreamError(res, {
        code: timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_API_ERROR',
        message: timedOut ? 'Balance request timed out' : 'Failed to fetch balance',
        status: timedOut ? 504 : 502,
      });
    }
  },
});
