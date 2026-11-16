import { withApiHandler } from '../../../lib/withApiHandler';
import { setGlobalLoreEnabledForSession, isGlobalLoreEnabledForSession } from '../../../lib/globalLorebook';
import { badRequest, notFound, serverError } from '../../../lib/apiErrors';
import { z } from 'zod';

const schema = z.object({
  sessionId: z.number().int().positive(),
  enabled: z.boolean(),
});

/**
 * POST /api/settings/global-lore
 * 
 * Enable or disable global lore for a specific session.
 * 
 * Body: { sessionId: number, enabled: boolean }
 * 
 * Returns: { sessionId: number, globalLoreEnabled: boolean }
 */
export default withApiHandler({}, {
  POST: async (req, res) => {
    const body = req.body;
    if (!body) {
      return badRequest(res, 'Request body required', 'BODY_REQUIRED');
    }

    const result = schema.safeParse(body);
    if (!result.success) {
      return res.status(400).json({
        error: 'Invalid request body',
        code: 'VALIDATION_ERROR',
        issues: result.error.issues,
      });
    }

    const { sessionId, enabled } = result.data;

    try {
      const updated = await setGlobalLoreEnabledForSession(sessionId, enabled);
      if (!updated) return notFound(res, 'Session not found', 'SESSION_NOT_FOUND');
      return res.status(200).json({
        sessionId,
        globalLoreEnabled: enabled,
      });
    } catch {
      return serverError(res, 'Failed to update global lore setting', 'SETTINGS_UPDATE_FAILED');
    }
  },

  GET: async (req, res) => {
    const sessionId = parseInt(req.query.sessionId as string, 10);
    if (isNaN(sessionId) || sessionId <= 0) {
      return badRequest(res, 'Valid sessionId required', 'INVALID_SESSION_ID');
    }

    try {
      const enabled = await isGlobalLoreEnabledForSession(sessionId);
      if (enabled === null) return notFound(res, 'Session not found', 'SESSION_NOT_FOUND');
      return res.status(200).json({
        sessionId,
        globalLoreEnabled: enabled,
      });
    } catch {
      return serverError(res, 'Failed to fetch global lore setting', 'SETTINGS_FETCH_FAILED');
    }
  },
});
