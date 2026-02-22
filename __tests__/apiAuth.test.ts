import type { NextApiRequest, NextApiResponse } from 'next';
import { mockReq, mockRes, suppressConsole } from './helpers/mockHttp';

// ---------------------------------------------------------------------------
// Mocks — must be declared before the module-under-test is imported
// ---------------------------------------------------------------------------
jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    setting: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('../lib/jwtSecret', () => ({
  getJwtSecret: jest.fn().mockResolvedValue('test-jwt-secret'),
}));

jest.mock('../lib/jwtCrypto', () => ({
  verifyJwtHs256: jest.fn(),
}));

import { requireAuth } from '../lib/apiAuth';
import prisma from '../lib/prisma';
import { verifyJwtHs256 } from '../lib/jwtCrypto';

suppressConsole();

// Convenience alias for the mocked Prisma setting lookup
const mockFindUnique = prisma.setting.findUnique as jest.Mock;
const mockVerify = verifyJwtHs256 as jest.Mock;

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe('requireAuth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // --- Public paths ---

  it.each([
    '/api/auth/login',
    '/api/auth/setup',
    '/api/auth/verify',
    '/api/auth/logout',
    '/api/health',
    '/api/internal/password-version',
  ])('returns true for public path %s without checking token', async (url) => {
    const req = mockReq({ url });
    const res = mockRes();
    const result = await requireAuth(req, res);
    expect(result).toBe(true);
    expect(mockVerify).not.toHaveBeenCalled();
  });

  // --- Missing cookie ---

  it('returns false and sends 401 when no auth cookie is present', async () => {
    const req = mockReq({ url: '/api/test', headers: {} });
    const res = mockRes();
    const result = await requireAuth(req, res);
    expect(result).toBe(false);
    expect(res._status).toBe(401);
  });

  it('returns false when cookie header exists but hcb_auth is missing', async () => {
    const req = mockReq({ url: '/api/test', headers: { cookie: 'other=value' } });
    const res = mockRes();
    const result = await requireAuth(req, res);
    expect(result).toBe(false);
    expect(res._status).toBe(401);
  });

  // --- Invalid token ---

  it('returns false when JWT verification fails (invalid)', async () => {
    mockVerify.mockResolvedValue({ valid: false });
    const req = mockReq({ url: '/api/test', headers: { cookie: 'hcb_auth=bad-token' } });
    const res = mockRes();
    const result = await requireAuth(req, res);
    expect(result).toBe(false);
    expect(res._status).toBe(401);
    expect(res._body).toMatchObject({ error: 'Invalid or expired token' });
  });

  // --- Password version mismatch ---

  it('returns false when token version does not match DB version', async () => {
    mockVerify.mockResolvedValue({ valid: true, payload: { v: 1 } });
    mockFindUnique.mockResolvedValue({ key: 'authPasswordVersion', value: '2' });

    const req = mockReq({ url: '/api/test', headers: { cookie: 'hcb_auth=valid-token' } });
    const res = mockRes();
    const result = await requireAuth(req, res);
    expect(result).toBe(false);
    expect(res._status).toBe(401);
    expect(res._body).toMatchObject({ code: 'TOKEN_VERSION_MISMATCH' });
  });

  // --- Happy path ---

  it('returns true when token is valid and version matches', async () => {
    mockVerify.mockResolvedValue({ valid: true, payload: { v: 2 } });
    mockFindUnique.mockResolvedValue({ key: 'authPasswordVersion', value: '2' });

    const req = mockReq({ url: '/api/test', headers: { cookie: 'hcb_auth=valid-token' } });
    const res = mockRes();
    const result = await requireAuth(req, res);
    expect(result).toBe(true);
    expect(res._status).toBe(0); // No response sent
  });

  it('returns true when no password version setting exists (defaults to 1) and token v is 1', async () => {
    mockVerify.mockResolvedValue({ valid: true, payload: { v: 1 } });
    mockFindUnique.mockResolvedValue(null);

    const req = mockReq({ url: '/api/test', headers: { cookie: 'hcb_auth=valid-token' } });
    const res = mockRes();
    const result = await requireAuth(req, res);
    expect(result).toBe(true);
  });

  // --- Exception handling ---

  it('returns false with 401 if verifyJwtHs256 throws', async () => {
    mockVerify.mockRejectedValue(new Error('crypto exploded'));
    const req = mockReq({ url: '/api/test', headers: { cookie: 'hcb_auth=bad' } });
    const res = mockRes();
    const result = await requireAuth(req, res);
    expect(result).toBe(false);
    expect(res._status).toBe(401);
  });
});
