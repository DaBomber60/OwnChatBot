import { mockReq, mockRes, suppressConsole } from './helpers/mockHttp';

jest.mock('../lib/apiAuth', () => ({
  requireAuth: jest.fn().mockResolvedValue(true),
}));

jest.mock('../lib/prisma', () => {
  const db: any = {
    lorebook: { findMany: jest.fn() },
    characterLorebook: { findMany: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
    chatSessionLorebook: { deleteMany: jest.fn(), createMany: jest.fn() },
    chatSession: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn(), create: jest.fn() },
    character: { findUnique: jest.fn() },
    setting: { findUnique: jest.fn() },
  };
  db.$transaction = jest.fn((arg: any) => (typeof arg === 'function' ? arg(db) : Promise.all(arg)));
  return { __esModule: true, default: db };
});

import prisma from '../lib/prisma';
import {
  normalizeLorebookIds,
  triggerLorebookIds,
  resolveInitialSessionLore,
  setCharacterDefaultLorebooks,
  exportedSessionLorebookLookup,
} from '../lib/lorebook/sessionLorebooks';
import sessionsHandler from '../pages/api/sessions/index';
import sessionLorebooksHandler from '../pages/api/sessions/[id]/lorebooks';
import characterLorebooksHandler from '../pages/api/characters/[id]/lorebooks';

const db = prisma as any;
let existingLorebookIds: Set<number>;

suppressConsole();

beforeEach(() => {
  jest.clearAllMocks();
  existingLorebookIds = new Set([1, 2, 3, 4, 5]);
  db.lorebook.findMany.mockImplementation(({ where }: any) =>
    Promise.resolve(where.id.in.filter((id: number) => existingLorebookIds.has(id)).map((id: number) => ({ id })))
  );
  db.characterLorebook.findMany.mockResolvedValue([]);
  db.characterLorebook.deleteMany.mockResolvedValue({ count: 0 });
  db.characterLorebook.createMany.mockResolvedValue({ count: 0 });
  db.chatSessionLorebook.deleteMany.mockResolvedValue({ count: 0 });
  db.chatSessionLorebook.createMany.mockResolvedValue({ count: 0 });
  db.chatSession.update.mockResolvedValue({});
  db.chatSession.findMany.mockResolvedValue([]);
  db.setting.findUnique.mockResolvedValue(null);
});

const characterDefaults = (...ids: number[]) =>
  db.characterLorebook.findMany.mockResolvedValue(ids.map(lorebookId => ({ lorebookId })));

describe('normalizeLorebookIds / triggerLorebookIds', () => {
  it('dedupes and drops the global lorebook and invalid IDs', () => {
    expect(normalizeLorebookIds([3, 1, 3, 0, -2, 1.5, '4', null])).toEqual([3, 1]);
  });

  it('adds the global lorebook to trigger sources only when the chat has it enabled', () => {
    expect(triggerLorebookIds({ lorebookIds: [2], globalLoreEnabled: true })).toEqual([2, 0]);
    expect(triggerLorebookIds({ lorebookIds: [2], globalLoreEnabled: false })).toEqual([2]);
  });
});

describe('resolveInitialSessionLore', () => {
  it("copies the character's default lorebooks when none are chosen", async () => {
    characterDefaults(2, 3);
    await expect(resolveInitialSessionLore(9)).resolves.toEqual({ lorebookIds: [2, 3], globalLoreEnabled: true });
    expect(db.characterLorebook.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { characterId: 9 } }));
  });

  it('uses an explicit selection instead of the defaults, including removing all of them', async () => {
    characterDefaults(2, 3);
    await expect(resolveInitialSessionLore(9, { lorebookIds: [5] })).resolves.toMatchObject({ lorebookIds: [5] });
    await expect(resolveInitialSessionLore(9, { lorebookIds: [] })).resolves.toMatchObject({ lorebookIds: [] });
    expect(db.characterLorebook.findMany).not.toHaveBeenCalled();
  });

  it('skips lorebooks that no longer exist', async () => {
    characterDefaults(2, 42);
    await expect(resolveInitialSessionLore(9)).resolves.toMatchObject({ lorebookIds: [2] });
  });

  it('starts with the global lorebook per the user-level default unless chosen explicitly', async () => {
    db.setting.findUnique.mockResolvedValue({ key: 'globalLoreEnabled', value: 'false' });
    await expect(resolveInitialSessionLore(9)).resolves.toMatchObject({ globalLoreEnabled: false });
    await expect(resolveInitialSessionLore(9, { globalLoreEnabled: true })).resolves.toMatchObject({ globalLoreEnabled: true });
  });
});

describe('setCharacterDefaultLorebooks', () => {
  beforeEach(() => {
    db.character.findUnique.mockResolvedValue({ id: 9 });
    characterDefaults(1);
    db.chatSession.findMany.mockResolvedValue([{ id: 10 }, { id: 11 }]);
  });

  it('returns null for an unknown character', async () => {
    db.character.findUnique.mockResolvedValue(null);
    await expect(setCharacterDefaultLorebooks(9, [1])).resolves.toBeNull();
  });

  it('replaces the defaults without touching existing chats by default', async () => {
    const result = await setCharacterDefaultLorebooks(9, [1, 2]);
    expect(result).toEqual({ lorebookIds: [1, 2], addedIds: [2], chatsUpdated: 0 });
    expect(db.characterLorebook.deleteMany).toHaveBeenCalledWith({ where: { characterId: 9, lorebookId: { notIn: [1, 2] } } });
    expect(db.characterLorebook.createMany).toHaveBeenCalledWith({
      data: [{ characterId: 9, lorebookId: 1 }, { characterId: 9, lorebookId: 2 }],
      skipDuplicates: true,
    });
    expect(db.chatSessionLorebook.createMany).not.toHaveBeenCalled();
  });

  it('adds only the newly added defaults to existing chats when asked', async () => {
    const result = await setCharacterDefaultLorebooks(9, [1, 2], true);
    expect(result).toMatchObject({ addedIds: [2], chatsUpdated: 2 });
    expect(db.chatSession.findMany).toHaveBeenCalledWith({ where: { characterId: 9 }, select: { id: true } });
    expect(db.chatSessionLorebook.createMany).toHaveBeenCalledWith({
      data: [{ sessionId: 10, lorebookId: 2 }, { sessionId: 11, lorebookId: 2 }],
      skipDuplicates: true,
    });
  });

  it('never removes lorebooks from existing chats when a default is removed', async () => {
    const result = await setCharacterDefaultLorebooks(9, [], true);
    expect(result).toMatchObject({ lorebookIds: [], addedIds: [], chatsUpdated: 0 });
    expect(db.chatSessionLorebook.deleteMany).not.toHaveBeenCalled();
    expect(db.chatSessionLorebook.createMany).not.toHaveBeenCalled();
  });
});

describe('exportedSessionLorebookLookup', () => {
  it('uses chat-level links when the export has them', () => {
    const lookup = exportedSessionLorebookLookup({
      sessionLorebooks: [{ sessionId: 1, lorebookId: 7 }, { sessionId: 1, lorebookId: 8 }],
      characterLorebooks: [{ characterId: 3, lorebookId: 9 }],
    });
    expect(lookup({ id: 1, characterId: 3 })).toEqual([7, 8]);
    expect(lookup({ id: 2, characterId: 3 })).toEqual([]);
  });

  it("falls back to the character's links for exports made before chat-level links", () => {
    const lookup = exportedSessionLorebookLookup({ characterLorebooks: [{ characterId: 3, lorebookId: 9 }] });
    expect(lookup({ id: 1, characterId: 3 })).toEqual([9]);
    expect(lookup({ id: 2, characterId: 4 })).toEqual([]);
  });
});

describe('POST /api/sessions', () => {
  beforeEach(() => db.chatSession.create.mockResolvedValue({ id: 50 }));

  it("creates the chat with the character's default lorebooks", async () => {
    characterDefaults(2);
    const res = mockRes();
    await sessionsHandler(mockReq({ method: 'POST', body: { personaId: 1, characterId: 9, skipFirstMessage: true } }), res);
    expect(res._status).toBe(201);
    expect(db.chatSession.create).toHaveBeenCalledWith({
      data: { personaId: 1, characterId: 9, globalLoreEnabled: true, lorebooks: { create: [{ lorebookId: 2 }] } },
    });
  });

  it('creates the chat with the lorebooks chosen at creation time', async () => {
    characterDefaults(2);
    const res = mockRes();
    await sessionsHandler(mockReq({
      method: 'POST',
      body: { personaId: 1, characterId: 9, skipFirstMessage: true, lorebookIds: [4, 5], globalLoreEnabled: false },
    }), res);
    expect(res._status).toBe(201);
    expect(db.chatSession.create).toHaveBeenCalledWith({
      data: { personaId: 1, characterId: 9, globalLoreEnabled: false, lorebooks: { create: [{ lorebookId: 4 }, { lorebookId: 5 }] } },
    });
  });
});

describe('/api/sessions/:id/lorebooks', () => {
  it('returns 404 for an unknown chat', async () => {
    db.chatSession.findUnique.mockResolvedValue(null);
    const res = mockRes();
    await sessionLorebooksHandler(mockReq({ method: 'GET', query: { id: '7' } }), res);
    expect(res._status).toBe(404);
  });

  it("returns the chat's lorebooks, global toggle, and the character defaults", async () => {
    db.chatSession.findUnique
      .mockResolvedValueOnce({ characterId: 9 })
      .mockResolvedValueOnce({ globalLoreEnabled: false, lorebooks: [{ lorebookId: 3 }] });
    characterDefaults(1, 3);
    const res = mockRes();
    await sessionLorebooksHandler(mockReq({ method: 'GET', query: { id: '7' } }), res);
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ lorebookIds: [3], globalLoreEnabled: false, characterDefaultIds: [1, 3] });
  });

  it("replaces the chat's lorebooks and global toggle", async () => {
    db.chatSession.findUnique
      .mockResolvedValueOnce({ id: 7 })
      .mockResolvedValueOnce({ globalLoreEnabled: false, lorebooks: [{ lorebookId: 4 }] });
    const res = mockRes();
    await sessionLorebooksHandler(mockReq({
      method: 'PUT', query: { id: '7' }, body: { lorebookIds: [4, 99], globalLoreEnabled: false },
    }), res);
    expect(res._status).toBe(200);
    expect(db.chatSessionLorebook.deleteMany).toHaveBeenCalledWith({ where: { sessionId: 7, lorebookId: { notIn: [4] } } });
    expect(db.chatSessionLorebook.createMany).toHaveBeenCalledWith({ data: [{ sessionId: 7, lorebookId: 4 }], skipDuplicates: true });
    expect(db.chatSession.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { globalLoreEnabled: false } });
    expect(res._body).toEqual({ lorebookIds: [4], globalLoreEnabled: false });
  });

  it('rejects linking the global lorebook as a regular lorebook', async () => {
    const res = mockRes();
    await sessionLorebooksHandler(mockReq({ method: 'PUT', query: { id: '7' }, body: { lorebookIds: [0] } }), res);
    expect(res._status).toBe(422);
    expect(db.chatSessionLorebook.createMany).not.toHaveBeenCalled();
  });
});

describe('/api/characters/:id/lorebooks', () => {
  it('reports the defaults and how many chats the character already has', async () => {
    db.character.findUnique.mockResolvedValue({ _count: { sessions: 4 } });
    characterDefaults(2);
    const res = mockRes();
    await characterLorebooksHandler(mockReq({ method: 'GET', query: { id: '9' } }), res);
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ lorebookIds: [2], existingChatCount: 4 });
  });

  it('returns 404 when saving defaults for an unknown character', async () => {
    db.character.findUnique.mockResolvedValue(null);
    const res = mockRes();
    await characterLorebooksHandler(mockReq({ method: 'PUT', query: { id: '9' }, body: { lorebookIds: [1] } }), res);
    expect(res._status).toBe(404);
  });
});
