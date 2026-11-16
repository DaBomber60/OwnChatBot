import { mockReq, mockRes, suppressConsole } from './helpers/mockHttp';

jest.mock('../lib/apiAuth', () => ({
  requireAuth: jest.fn().mockResolvedValue(true),
}));

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    lorebook: { findMany: jest.fn(), findUnique: jest.fn(), deleteMany: jest.fn() },
    loreEntry: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
  },
}));

import prisma from '../lib/prisma';
import lorebooksHandler from '../pages/api/lorebooks/index';
import lorebookHandler from '../pages/api/lorebooks/[id]';
import entriesHandler from '../pages/api/lorebooks/[id]/entries';
import entryHandler from '../pages/api/lorebooks/[id]/entries/[entryId]';
import { sendJson } from '../lib/fetcher';

const db = prisma as any;
const now = new Date('2026-11-16T00:00:00Z');
const entryRow = (overrides: Record<string, unknown> = {}) => ({
  id: 7, lorebookId: 3, title: 'Citadel', content: 'A silver fortress', keys: '["silver citadel"]',
  constant: false, enabled: true, priority: 100, createdAt: now, updatedAt: now, ...overrides,
});

suppressConsole();
beforeEach(() => jest.clearAllMocks());

describe('GET /api/lorebooks', () => {
  it('lists lorebooks with usage counts, global lorebook first', async () => {
    db.lorebook.findMany.mockResolvedValue([
      { id: 5, name: 'Bestiary', description: null, _count: { entries: 2, characters: 1, sessions: 4 } },
      { id: 0, name: 'Global Lorebook', description: 'x', _count: { entries: 1, characters: 0, sessions: 0 } },
    ]);
    const res = mockRes();
    await lorebooksHandler(mockReq({ method: 'GET', query: { view: 'summary' } }), res);
    expect(res._status).toBe(200);
    expect(res._body.map((lb: any) => lb.id)).toEqual([0, 5]);
    expect(res._body[1]).toEqual({ id: 5, name: 'Bestiary', description: null, entryCount: 2, characterCount: 1, chatCount: 4 });
  });
});

describe('/api/lorebooks/:id', () => {
  it('loads the global lorebook (id 0) with entry keywords as lists', async () => {
    db.lorebook.findUnique.mockResolvedValue({
      id: 0, name: 'Global Lorebook', description: null, createdAt: now, updatedAt: now,
      entries: [entryRow({ lorebookId: 0, keys: 'legacy words' })],
      characters: [],
      _count: { sessions: 0 },
    });
    const res = mockRes();
    await lorebookHandler(mockReq({ method: 'GET', query: { id: '0' } }), res);
    expect(res._status).toBe(200);
    expect(res._body.isGlobal).toBe(true);
    expect(res._body.entries[0].keys).toEqual(['legacy', 'words']);
  });

  it('rejects malformed IDs and refuses to delete the global lorebook', async () => {
    const bad = mockRes();
    await lorebookHandler(mockReq({ method: 'GET', query: { id: '-1' } }), bad);
    expect(bad._status).toBe(400);

    const res = mockRes();
    await lorebookHandler(mockReq({ method: 'DELETE', query: { id: '0' } }), res);
    expect(res._status).toBe(403);
    expect(db.lorebook.deleteMany).not.toHaveBeenCalled();
  });
});

describe('lore entry routes', () => {
  it('stores keywords as a JSON list and returns them as a list', async () => {
    db.lorebook.findUnique.mockResolvedValue({ id: 3 });
    db.loreEntry.create.mockImplementation(({ data }: any) => Promise.resolve(entryRow(data)));
    const res = mockRes();
    await entriesHandler(mockReq({
      method: 'POST', query: { id: '3' },
      body: { title: 'Citadel', content: 'A silver fortress', keys: ['Silver Citadel', 'silver citadel', 'fortress'] },
    }), res);
    expect(res._status).toBe(201);
    expect(db.loreEntry.create.mock.calls[0][0].data.keys).toBe('["Silver Citadel","fortress"]');
    expect(res._body.keys).toEqual(['Silver Citadel', 'fortress']);
  });

  it('can clear all keywords', async () => {
    db.loreEntry.findUnique.mockResolvedValue(entryRow());
    db.loreEntry.update.mockImplementation(({ data }: any) => Promise.resolve(entryRow(data)));
    const res = mockRes();
    await entryHandler(mockReq({ method: 'PATCH', query: { id: '3', entryId: '7' }, body: { keys: [] } }), res);
    expect(res._status).toBe(200);
    expect(db.loreEntry.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { keys: '[]' } });
  });

  it('treats an entry from another lorebook as not found', async () => {
    db.loreEntry.findUnique.mockResolvedValue(entryRow({ lorebookId: 9 }));
    const res = mockRes();
    await entryHandler(mockReq({ method: 'DELETE', query: { id: '3', entryId: '7' } }), res);
    expect(res._status).toBe(404);
    expect(db.loreEntry.delete).not.toHaveBeenCalled();
  });

  it('refuses to make a global lorebook entry always-included', async () => {
    db.loreEntry.findUnique.mockResolvedValue(entryRow({ lorebookId: 0 }));
    const res = mockRes();
    await entryHandler(mockReq({ method: 'PATCH', query: { id: '0', entryId: '7' }, body: { constant: true } }), res);
    expect(res._status).toBe(400);
    expect(res._body.code).toBe('GLOBAL_LOREBOOK_TRIGGER_ONLY');
    expect(db.loreEntry.update).not.toHaveBeenCalled();
  });
});

describe('sendJson', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  it('surfaces the first validation issue as the error message', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false, status: 422, statusText: 'Unprocessable Entity',
      json: () => Promise.resolve({ error: 'Invalid request body', code: 'VALIDATION_ERROR', issues: [{ path: ['title'], message: 'Required' }] }),
    }) as any;
    await expect(sendJson('/api/x', 'POST', {})).rejects.toMatchObject({ message: 'title: Required', status: 422, code: 'VALIDATION_ERROR' });
  });
});
