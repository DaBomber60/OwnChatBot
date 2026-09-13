import prisma from '../../../lib/prisma';
import {
  PROVIDER_KEY_SETTING,
  PROVIDER_MODELS_URL,
  failureTimeoutMs,
  filterProviderModels,
  isModelListProvider,
} from '../../../lib/aiProvider';
import { withApiHandler } from '../../../lib/withApiHandler';
import { apiKeyNotConfigured, badRequest, upstreamError, classifyUpstreamStatus } from '../../../lib/apiErrors';
import { redactString } from '../../../lib/redact';

export default withApiHandler({}, {
  GET: async (req, res) => {
    // Takes the provider from the query rather than the saved config so the settings page can
    // list models for a provider the user has picked but not saved yet.
    const requested = typeof req.query.provider === 'string' ? req.query.provider : '';
    if (!isModelListProvider(requested)) {
      return badRequest(res, 'Model listing is not available for this provider', 'PROVIDER_UNSUPPORTED');
    }

    const keySetting = PROVIDER_KEY_SETTING[requested];
    const rows = await prisma.setting.findMany({
      where: { key: { in: [keySetting, 'apiKey', 'apiFailureTimeout'] } },
    });
    const map: Record<string, string> = {};
    for (const r of rows) map[r.key] = r.value;

    const apiKey = map[keySetting] || map.apiKey || '';
    if (!apiKey) return apiKeyNotConfigured(res);

    const timeoutMs = failureTimeoutMs(parseInt(map.apiFailureTimeout ?? '', 10), false);

    try {
      // Not a completions call, so it can't go through callUpstreamAI.
      const upstream = await fetch(PROVIDER_MODELS_URL[requested], {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        signal: AbortSignal.timeout(timeoutMs),
      });

      const data = await upstream.json().catch(() => undefined);

      if (!upstream.ok) {
        const message = redactString(data?.error?.message || data?.detail || 'Failed to fetch model list');
        return upstreamError(res, {
          code: classifyUpstreamStatus(upstream.status, message),
          message,
          upstreamStatus: upstream.status,
        });
      }

      const ids: string[] = Array.isArray(data?.data)
        ? data.data.map((m: any) => m?.id).filter((id: any): id is string => typeof id === 'string')
        : [];

      return res.status(200).json({ provider: requested, models: filterProviderModels(requested, ids) });
    } catch (err: any) {
      const timedOut = err?.name === 'AbortError' || err?.name === 'TimeoutError';
      return upstreamError(res, {
        code: timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_API_ERROR',
        message: timedOut ? 'Model list request timed out' : 'Failed to fetch model list',
        status: timedOut ? 504 : 502,
      });
    }
  },
});
