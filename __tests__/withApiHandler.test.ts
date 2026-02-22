import { withApiHandler } from '../lib/withApiHandler';
import type { NextApiRequest, NextApiResponse } from 'next';

// Mock requireAuth before it gets imported by withApiHandler
jest.mock('../lib/apiAuth', () => ({
  requireAuth: jest.fn(),
}));

import { requireAuth } from '../lib/apiAuth';

const mockReq = (overrides: Partial<NextApiRequest> = {}): NextApiRequest =>
  ({
    method: 'GET',
    url: '/api/test',
    query: {},
    headers: {},
    body: {},
    ...overrides,
  } as unknown as NextApiRequest);

function mockRes() {
  const headers: Record<string, any> = {};
  const res: any = {
    _status: 0,
    _body: null,
    _headers: headers,
    headersSent: false,
    status(code: number) {
      res._status = code;
      return res;
    },
    json(body: any) {
      res._body = body;
      return res;
    },
    end() {
      return res;
    },
    setHeader(name: string, value: any) {
      headers[name] = value;
      return res;
    },
  };
  return res as NextApiResponse & {
    _status: number;
    _body: any;
    _headers: Record<string, any>;
  };
}

describe('withApiHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (requireAuth as jest.Mock).mockResolvedValue(true);
  });

  // --- Method routing ---

  it('dispatches to the correct method handler', async () => {
    const getHandler = jest.fn();
    const postHandler = jest.fn();
    const wrapped = withApiHandler({}, { GET: getHandler, POST: postHandler });

    const req = mockReq({ method: 'GET' });
    const res = mockRes();
    await wrapped(req, res);

    expect(getHandler).toHaveBeenCalledWith(req, res, expect.any(Object));
    expect(postHandler).not.toHaveBeenCalled();
  });

  it('returns 405 for unhandled methods with Allow header', async () => {
    const wrapped = withApiHandler({}, { GET: jest.fn(), POST: jest.fn() });

    const req = mockReq({ method: 'DELETE' });
    const res = mockRes();
    await wrapped(req, res);

    expect(res._status).toBe(405);
    expect(res._body).toMatchObject({ code: 'METHOD_NOT_ALLOWED' });
    expect(res._headers['Allow']).toEqual(['GET', 'POST']);
  });

  // --- Auth ---

  it('calls requireAuth by default', async () => {
    const handler = jest.fn();
    const wrapped = withApiHandler({}, { GET: handler });

    const req = mockReq();
    const res = mockRes();
    await wrapped(req, res);

    expect(requireAuth).toHaveBeenCalledWith(req, res);
    expect(handler).toHaveBeenCalled();
  });

  it('blocks request when requireAuth returns false', async () => {
    (requireAuth as jest.Mock).mockResolvedValue(false);
    const handler = jest.fn();
    const wrapped = withApiHandler({}, { GET: handler });

    const req = mockReq();
    const res = mockRes();
    await wrapped(req, res);

    expect(requireAuth).toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it('skips auth when auth: false', async () => {
    const handler = jest.fn();
    const wrapped = withApiHandler({ auth: false }, { GET: handler });

    const req = mockReq();
    const res = mockRes();
    await wrapped(req, res);

    expect(requireAuth).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalled();
  });

  // --- ID parsing ---

  it('parses valid ID into ctx when parseId: true', async () => {
    const handler = jest.fn();
    const wrapped = withApiHandler({ parseId: true }, { GET: handler });

    const req = mockReq({ query: { id: '42' } } as any);
    const res = mockRes();
    await wrapped(req, res);

    expect(handler).toHaveBeenCalledWith(req, res, { id: 42 });
  });

  it('returns 400 for invalid ID when parseId: true', async () => {
    const handler = jest.fn();
    const wrapped = withApiHandler({ parseId: true }, { GET: handler });

    const req = mockReq({ query: { id: 'abc' } } as any);
    const res = mockRes();
    await wrapped(req, res);

    expect(res._status).toBe(400);
    expect(res._body).toMatchObject({ code: 'INVALID_ID' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('returns 400 for missing ID when parseId: true', async () => {
    const handler = jest.fn();
    const wrapped = withApiHandler({ parseId: true }, { GET: handler });

    const req = mockReq({ query: {} } as any);
    const res = mockRes();
    await wrapped(req, res);

    expect(res._status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
  });

  // --- Error handling ---

  it('catches unhandled errors and returns 500', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const handler = jest.fn().mockRejectedValue(new Error('boom'));
    const wrapped = withApiHandler({}, { GET: handler });

    const req = mockReq();
    const res = mockRes();
    await wrapped(req, res);

    expect(res._status).toBe(500);
    expect(res._body).toMatchObject({ code: 'INTERNAL_ERROR' });
    consoleSpy.mockRestore();
  });

  it('does not send error if headers already sent', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const handler = jest.fn().mockRejectedValue(new Error('boom'));
    const wrapped = withApiHandler({}, { GET: handler });

    const req = mockReq();
    const res = mockRes();
    (res as any).headersSent = true;
    await wrapped(req, res);

    // Should not try to send a response (status stays 0)
    expect(res._status).toBe(0);
    consoleSpy.mockRestore();
  });

  // --- Ordering: auth before parseId before method ---

  it('checks auth before parsing ID', async () => {
    (requireAuth as jest.Mock).mockResolvedValue(false);
    const handler = jest.fn();
    const wrapped = withApiHandler({ parseId: true }, { GET: handler });

    // ID is invalid, but auth should fail first
    const req = mockReq({ query: { id: 'abc' } } as any);
    const res = mockRes();
    await wrapped(req, res);

    expect(requireAuth).toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    // Should NOT have returned 400 for bad ID — auth blocked first
    expect(res._status).not.toBe(400);
  });

  it('checks parseId before method dispatch', async () => {
    const handler = jest.fn();
    const wrapped = withApiHandler({ parseId: true }, { GET: handler });

    // Valid method (GET) but invalid ID
    const req = mockReq({ method: 'GET', query: { id: 'bad' } } as any);
    const res = mockRes();
    await wrapped(req, res);

    expect(res._status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
  });
});
