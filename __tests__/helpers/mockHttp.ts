/**
 * Shared mock factories for NextApiRequest / NextApiResponse.
 * Import from '__tests__/helpers/mockHttp' in any test file.
 */
import type { NextApiRequest, NextApiResponse } from 'next';

/** Build a minimal mock NextApiRequest with optional overrides. */
export function mockReq(overrides: Partial<NextApiRequest> = {}): NextApiRequest {
  return {
    method: 'GET',
    url: '/api/test',
    query: {},
    headers: {},
    body: {},
    ...overrides,
  } as unknown as NextApiRequest;
}

/** Build a mock NextApiResponse that records status, body, and headers. */
export function mockRes() {
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

/** Suppress console.log / console.warn / console.error during tests. */
export function suppressConsole() {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());
}
