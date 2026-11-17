import { mockReq, mockRes, suppressConsole } from './helpers/mockHttp';

jest.mock('../lib/apiAuth', () => ({
  requireAuth: jest.fn().mockResolvedValue(true),
}));

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    lorebook: { findMany: jest.fn(), findUnique: jest.fn(), deleteMany: jest.fn() },
    loreEntry: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    chatMessage: { findUnique: jest.fn(), findFirst: jest.fn() },
    setting: { findUnique: jest.fn().mockResolvedValue(null) },
  },
}));

import prisma from '../lib/prisma';
import lorebooksHandler from '../pages/api/lorebooks/index';
import lorebookHandler from '../pages/api/lorebooks/[id]';
import entriesHandler from '../pages/api/lorebooks/[id]/entries';
import entryHandler from '../pages/api/lorebooks/[id]/entries/[entryId]';
import messageLoreHandler from '../pages/api/messages/[id]/lore';
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
    expect(res._body.entries[0].keys).toEqual([
      { text: 'legacy', wholeWord: false },
      { text: 'words', wholeWord: false },
    ]);
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
  it('stores keywords with their match mode and returns them as a list', async () => {
    db.lorebook.findUnique.mockResolvedValue({ id: 3 });
    db.loreEntry.create.mockImplementation(({ data }: any) => Promise.resolve(entryRow(data)));
    const res = mockRes();
    await entriesHandler(mockReq({
      method: 'POST', query: { id: '3' },
      body: {
        title: 'Citadel', content: 'A silver fortress',
        keys: [{ text: 'Silver Citadel', wholeWord: true }, 'silver citadel', 'fortress'],
      },
    }), res);
    expect(res._status).toBe(201);
    expect(JSON.parse(db.loreEntry.create.mock.calls[0][0].data.keys)).toEqual([
      { text: 'Silver Citadel', wholeWord: true },
      { text: 'fortress', wholeWord: false },
    ]);
    expect(res._body.keys).toEqual([
      { text: 'Silver Citadel', wholeWord: true },
      { text: 'fortress', wholeWord: false },
    ]);
  });

  it('rejects keyword objects without a match mode', async () => {
    const res = mockRes();
    await entriesHandler(mockReq({
      method: 'POST', query: { id: '3' },
      body: { title: 'Citadel', content: 'A silver fortress', keys: [{ text: 'citadel' }] },
    }), res);
    expect(res._status).toBe(422);
    expect(db.loreEntry.create).not.toHaveBeenCalled();
  });

  it('stores priority levels as numbers and returns them as levels', async () => {
    db.lorebook.findUnique.mockResolvedValue({ id: 3 });
    db.loreEntry.create.mockImplementation(({ data }: any) => Promise.resolve(entryRow(data)));
    const res = mockRes();
    await entriesHandler(mockReq({
      method: 'POST', query: { id: '3' },
      body: { title: 'Citadel', content: 'A silver fortress', priority: 'critical' },
    }), res);
    expect(db.loreEntry.create.mock.calls[0][0].data.priority).toBe(400);
    expect(res._body.priority).toBe('critical');

    db.loreEntry.findUnique.mockResolvedValue(entryRow());
    db.loreEntry.update.mockImplementation(({ data }: any) => Promise.resolve(entryRow(data)));
    const patched = mockRes();
    await entryHandler(mockReq({ method: 'PATCH', query: { id: '3', entryId: '7' }, body: { priority: 250 } }), patched);
    expect(db.loreEntry.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { priority: 200 } });
    expect(patched._body.priority).toBe('helpful');
  });

  it('defaults new entries to "information"', async () => {
    db.lorebook.findUnique.mockResolvedValue({ id: 3 });
    db.loreEntry.create.mockImplementation(({ data }: any) => Promise.resolve(entryRow(data)));
    const res = mockRes();
    await entriesHandler(mockReq({ method: 'POST', query: { id: '3' }, body: { title: 'T', content: 'C' } }), res);
    expect(db.loreEntry.create.mock.calls[0][0].data.priority).toBe(100);
    expect(res._body.priority).toBe('information');
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

describe('GET /api/messages/:id/lore', () => {
  const reply = { id: 50, sessionId: 9, createdAt: now, metadata: JSON.stringify({ triggeredLoreIds: [7, 8, 99], matchedLoreIds: [7] }) };

  it('lists the entries a reply used in pick order, with why each was included', async () => {
    db.chatMessage.findUnique.mockResolvedValue(reply);
    db.chatMessage.findFirst.mockResolvedValue({ content: 'We rode toward the Silver   Citadel at dawn.' });
    db.loreEntry.findMany.mockResolvedValue([
      { ...entryRow({ id: 8, title: 'Old Road', keys: '["road"]', priority: 300 }), lorebook: { name: 'Bestiary' } },
      { ...entryRow({ keys: '[{"text":"silver citadel","wholeWord":true},{"text":"fortress","wholeWord":true}]', priority: 100 }), lorebook: { name: 'Places' } },
    ]);

    const res = mockRes();
    await messageLoreHandler(mockReq({ method: 'GET', query: { id: '50' } }), res);

    expect(res._status).toBe(200);
    expect(res._body.missingCount).toBe(1);
    expect(res._body.keepActiveTurns).toBe(5);
    expect(res._body.entries.map((e: any) => [e.title, e.reason, e.matchedKeywords, e.lorebookName])).toEqual([
      ['Old Road', 'active', [], 'Bestiary'],
      ['Citadel', 'matched', ['silver citadel'], 'Places'],
    ]);
    // Keywords are checked against the user message the reply answered.
    expect(db.chatMessage.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ sessionId: 9, role: 'user' }),
    }));
  });

  it('returns no entries for a reply without lore, and 404 for an unknown message', async () => {
    db.chatMessage.findUnique.mockResolvedValue({ ...reply, metadata: null });
    const empty = mockRes();
    await messageLoreHandler(mockReq({ method: 'GET', query: { id: '50' } }), empty);
    expect(empty._body).toMatchObject({ entries: [], missingCount: 0 });
    expect(db.loreEntry.findMany).not.toHaveBeenCalled();

    db.chatMessage.findUnique.mockResolvedValue(null);
    const missing = mockRes();
    await messageLoreHandler(mockReq({ method: 'GET', query: { id: '51' } }), missing);
    expect(missing._status).toBe(404);
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
