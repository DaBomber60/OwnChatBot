import type { NextApiRequest, NextApiResponse, NextApiHandler } from 'next';
import { requireAuth } from './apiAuth';
import { badRequest, methodNotAllowed, serverError } from './apiErrors';
import { parseId } from './validate';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';

export interface HandlerContext {
  /** Parsed numeric ID from req.query.id — only populated when parseId option is set */
  id: number;
}

type MethodHandler = (
  req: NextApiRequest,
  res: NextApiResponse,
  ctx: HandlerContext,
) => unknown;

export interface ApiHandlerOptions {
  /** Require JWT authentication via requireAuth() (default: true) */
  auth?: boolean;
  /** Parse req.query.id as a positive integer and provide as ctx.id (default: false) */
  parseId?: boolean;
}

type MethodHandlers = Partial<Record<HttpMethod, MethodHandler>>;

/**
 * Higher-order function wrapping Next.js API route handlers.
 *
 * Handles:
 * - Auth check via requireAuth() (opt-out with `auth: false`)
 * - Method routing with automatic `Allow` header & 405 fallback
 * - ID parsing from `req.query.id` (opt-in with `parseId: true`)
 * - Top-level try/catch with 500 fallback (skipped when headers already sent)
 */
export function withApiHandler(
  options: ApiHandlerOptions,
  handlers: MethodHandlers,
): NextApiHandler {
  const { auth = true, parseId: shouldParseId = false } = options;
  const allowedMethods = Object.keys(handlers) as HttpMethod[];

  return async (req: NextApiRequest, res: NextApiResponse) => {
    // 1. Auth guard
    if (auth && !(await requireAuth(req, res))) return;

    // 2. ID parsing
    const ctx = {} as HandlerContext;
    if (shouldParseId) {
      const id = parseId(req.query.id);
      if (id === null) return badRequest(res, 'Invalid ID', 'INVALID_ID');
      ctx.id = id;
    }

    // 3. Method dispatch
    const handler = handlers[req.method as HttpMethod];
    if (!handler) {
      res.setHeader('Allow', allowedMethods);
      return methodNotAllowed(res, req.method);
    }

    // 4. Execute with safety net
    try {
      await handler(req, res, ctx);
    } catch (error) {
      console.error(`[${req.method} ${req.url}] Unhandled error:`, error);
      if (!res.headersSent) {
        return serverError(res);
      }
    }
  };
}
