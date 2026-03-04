import { getAIConfig } from '../../../lib/aiProvider';
import { withApiHandler } from '../../../lib/withApiHandler';
import { apiKeyNotConfigured } from '../../../lib/apiErrors';

export default withApiHandler({}, {
  GET: async (_req, res) => {
    const cfg = await getAIConfig();
    if ('error' in cfg) return apiKeyNotConfigured(res);

    if (cfg.provider !== 'deepseek') {
      return res.status(400).json({ error: 'Balance check is only available for the DeepSeek provider' });
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      const upstream = await fetch('https://api.deepseek.com/user/balance', {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${cfg.apiKey}`,
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const data = await upstream.json();

      if (!upstream.ok) {
        return res.status(502).json({
          error: data?.error?.message || data?.detail || 'Failed to fetch balance',
        });
      }

      return res.status(200).json(data);
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        return res.status(504).json({ error: 'Balance request timed out' });
      }
      return res.status(500).json({ error: 'Failed to fetch balance' });
    }
  },
});
