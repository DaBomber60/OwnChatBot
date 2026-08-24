import { mockReq, mockRes, suppressConsole } from './helpers/mockHttp';

// ---------------------------------------------------------------------------
// Mocks — must be declared before the modules-under-test are imported
// ---------------------------------------------------------------------------
jest.mock('../lib/apiAuth', () => ({
  requireAuth: jest.fn().mockResolvedValue(true),
}));

jest.mock('../lib/prisma', () => {
  const db: any = {
    messageVersion: { deleteMany: jest.fn() },
    chatMessage: { deleteMany: jest.fn(), count: jest.fn() },
    chatSession: { deleteMany: jest.fn(), count: jest.fn() },
    character: { deleteMany: jest.fn(), count: jest.fn() },
    characterGroup: { deleteMany: jest.fn(), count: jest.fn() },
    persona: { deleteMany: jest.fn(), count: jest.fn() },
    userPrompt: { deleteMany: jest.fn() },
    setting: { findUnique: jest.fn(), deleteMany: jest.fn() },
  };
  // Supports both the array and the interactive callback forms.
  db.$transaction = jest.fn((arg: any) => (typeof arg === 'function' ? arg(db) : Promise.all(arg)));
  return { __esModule: true, default: db };
});

import prisma from '../lib/prisma';
import bulkDeleteHandler from '../pages/api/sessions/bulk-delete';
import bulkDeleteCharactersHandler from '../pages/api/characters/bulk-delete';
import bulkDeletePersonasHandler from '../pages/api/personas/bulk-delete';
import purgeHandler from '../pages/api/database/purge';

const db = prisma as any;

suppressConsole();

beforeEach(() => {
  jest.clearAllMocks();
  db.messageVersion.deleteMany.mockResolvedValue({ count: 0 });
  db.chatMessage.deleteMany.mockResolvedValue({ count: 0 });
  db.chatSession.deleteMany.mockResolvedValue({ count: 0 });
  db.character.deleteMany.mockResolvedValue({ count: 0 });
  db.characterGroup.deleteMany.mockResolvedValue({ count: 0 });
  db.persona.deleteMany.mockResolvedValue({ count: 0 });
  db.setting.findUnique.mockResolvedValue({ key: 'devMode', value: 'true' });
});

describe('POST /api/sessions/bulk-delete', () => {
  it('rejects non-POST methods', async () => {
    const res = mockRes();
    await bulkDeleteHandler(mockReq({ method: 'GET' }), res);
    expect(res._status).toBe(405);
    expect(res._headers['Allow']).toEqual(['POST']);
  });

  it('rejects an empty id list', async () => {
    const res = mockRes();
    await bulkDeleteHandler(mockReq({ method: 'POST', body: { ids: [] } }), res);
    expect(res._status).toBe(422);
    expect(db.chatSession.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects non-positive ids', async () => {
    const res = mockRes();
    await bulkDeleteHandler(mockReq({ method: 'POST', body: { ids: [1, -2] } }), res);
    expect(res._status).toBe(422);
    expect(db.chatSession.deleteMany).not.toHaveBeenCalled();
  });

  it('deletes versions, then messages, then sessions', async () => {
    db.chatSession.deleteMany.mockResolvedValue({ count: 2 });
    const res = mockRes();
    await bulkDeleteHandler(mockReq({ method: 'POST', body: { ids: [4, 7] } }), res);

    expect(res._status).toBe(200);
    expect(res._body).toEqual({ deleted: 2 });
    expect(db.messageVersion.deleteMany).toHaveBeenCalledWith({ where: { message: { sessionId: { in: [4, 7] } } } });
    expect(db.chatMessage.deleteMany).toHaveBeenCalledWith({ where: { sessionId: { in: [4, 7] } } });
    expect(db.chatSession.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [4, 7] } } });

    const order = [
      db.messageVersion.deleteMany.mock.invocationCallOrder[0],
      db.chatMessage.deleteMany.mock.invocationCallOrder[0],
      db.chatSession.deleteMany.mock.invocationCallOrder[0],
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(db.$transaction).toHaveBeenCalled();
  });

  it('de-duplicates repeated ids', async () => {
    const res = mockRes();
    await bulkDeleteHandler(mockReq({ method: 'POST', body: { ids: [3, 3, 5] } }), res);
    expect(db.chatSession.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [3, 5] } } });
  });
});

describe('POST /api/characters/bulk-delete', () => {
  it('rejects non-POST methods', async () => {
    const res = mockRes();
    await bulkDeleteCharactersHandler(mockReq({ method: 'GET' }), res);
    expect(res._status).toBe(405);
    expect(res._headers['Allow']).toEqual(['POST']);
  });

  it('rejects an empty id list', async () => {
    const res = mockRes();
    await bulkDeleteCharactersHandler(mockReq({ method: 'POST', body: { ids: [] } }), res);
    expect(res._status).toBe(422);
    expect(db.character.deleteMany).not.toHaveBeenCalled();
  });

  it('cascades through versions, messages and sessions before the characters', async () => {
    db.character.deleteMany.mockResolvedValue({ count: 2 });
    const res = mockRes();
    await bulkDeleteCharactersHandler(mockReq({ method: 'POST', body: { ids: [8, 9] } }), res);

    expect(res._status).toBe(200);
    expect(res._body).toEqual({ deleted: 2 });
    expect(db.messageVersion.deleteMany).toHaveBeenCalledWith({ where: { message: { session: { characterId: { in: [8, 9] } } } } });
    expect(db.chatMessage.deleteMany).toHaveBeenCalledWith({ where: { session: { characterId: { in: [8, 9] } } } });
    expect(db.chatSession.deleteMany).toHaveBeenCalledWith({ where: { characterId: { in: [8, 9] } } });
    expect(db.character.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [8, 9] } } });

    const order = [
      db.messageVersion.deleteMany.mock.invocationCallOrder[0],
      db.chatMessage.deleteMany.mock.invocationCallOrder[0],
      db.chatSession.deleteMany.mock.invocationCallOrder[0],
      db.character.deleteMany.mock.invocationCallOrder[0],
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(db.$transaction).toHaveBeenCalled();
  });

  it('de-duplicates repeated ids', async () => {
    const res = mockRes();
    await bulkDeleteCharactersHandler(mockReq({ method: 'POST', body: { ids: [2, 2, 6] } }), res);
    expect(db.character.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [2, 6] } } });
  });
});

describe('POST /api/personas/bulk-delete', () => {
  it('rejects non-POST methods', async () => {
    const res = mockRes();
    await bulkDeletePersonasHandler(mockReq({ method: 'GET' }), res);
    expect(res._status).toBe(405);
    expect(res._headers['Allow']).toEqual(['POST']);
  });

  it('rejects non-positive ids', async () => {
    const res = mockRes();
    await bulkDeletePersonasHandler(mockReq({ method: 'POST', body: { ids: [1, 0] } }), res);
    expect(res._status).toBe(422);
    expect(db.persona.deleteMany).not.toHaveBeenCalled();
  });

  it('cascades through versions, messages and sessions before the personas', async () => {
    db.persona.deleteMany.mockResolvedValue({ count: 1 });
    const res = mockRes();
    await bulkDeletePersonasHandler(mockReq({ method: 'POST', body: { ids: [11] } }), res);

    expect(res._status).toBe(200);
    expect(res._body).toEqual({ deleted: 1 });
    expect(db.messageVersion.deleteMany).toHaveBeenCalledWith({ where: { message: { session: { personaId: { in: [11] } } } } });
    expect(db.chatMessage.deleteMany).toHaveBeenCalledWith({ where: { session: { personaId: { in: [11] } } } });
    expect(db.chatSession.deleteMany).toHaveBeenCalledWith({ where: { personaId: { in: [11] } } });
    expect(db.persona.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [11] } } });

    const order = [
      db.messageVersion.deleteMany.mock.invocationCallOrder[0],
      db.chatMessage.deleteMany.mock.invocationCallOrder[0],
      db.chatSession.deleteMany.mock.invocationCallOrder[0],
      db.persona.deleteMany.mock.invocationCallOrder[0],
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});

describe('/api/database/purge', () => {
  it('GET returns row counts', async () => {
    db.chatSession.count.mockResolvedValue(3);
    db.chatMessage.count.mockResolvedValue(42);
    db.character.count.mockResolvedValue(5);
    db.characterGroup.count.mockResolvedValue(2);
    db.persona.count.mockResolvedValue(1);

    const res = mockRes();
    await purgeHandler(mockReq({ method: 'GET' }), res);

    expect(res._status).toBe(200);
    expect(res._body).toEqual({ sessions: 3, messages: 42, characters: 5, characterGroups: 2, personas: 1 });
  });

  it('POST is forbidden when developer mode is off', async () => {
    db.setting.findUnique.mockResolvedValue({ key: 'devMode', value: 'false' });
    const res = mockRes();
    await purgeHandler(mockReq({ method: 'POST', body: { target: 'chats' } }), res);

    expect(res._status).toBe(403);
    expect(res._body.code).toBe('DEV_MODE_REQUIRED');
    expect(db.chatSession.deleteMany).not.toHaveBeenCalled();
  });

  it('POST is forbidden when the devMode setting is missing', async () => {
    db.setting.findUnique.mockResolvedValue(null);
    const res = mockRes();
    await purgeHandler(mockReq({ method: 'POST', body: { target: 'everything' } }), res);

    expect(res._status).toBe(403);
    expect(db.chatSession.deleteMany).not.toHaveBeenCalled();
  });

  it('POST rejects an unknown target', async () => {
    const res = mockRes();
    await purgeHandler(mockReq({ method: 'POST', body: { target: 'settings' } }), res);

    expect(res._status).toBe(422);
    expect(db.chatSession.deleteMany).not.toHaveBeenCalled();
  });

  it('target "chats" leaves characters, groups and personas alone', async () => {
    db.chatSession.deleteMany.mockResolvedValue({ count: 6 });
    db.chatMessage.deleteMany.mockResolvedValue({ count: 60 });

    const res = mockRes();
    await purgeHandler(mockReq({ method: 'POST', body: { target: 'chats' } }), res);

    expect(res._status).toBe(200);
    expect(res._body).toEqual({
      deleted: { sessions: 6, messages: 60, characters: 0, characterGroups: 0, personas: 0 },
    });
    expect(db.character.deleteMany).not.toHaveBeenCalled();
    expect(db.characterGroup.deleteMany).not.toHaveBeenCalled();
    expect(db.persona.deleteMany).not.toHaveBeenCalled();
  });

  it('target "characters" wipes characters but not personas or groups', async () => {
    db.character.deleteMany.mockResolvedValue({ count: 4 });

    const res = mockRes();
    await purgeHandler(mockReq({ method: 'POST', body: { target: 'characters' } }), res);

    expect(res._body.deleted.characters).toBe(4);
    expect(db.persona.deleteMany).not.toHaveBeenCalled();
    expect(db.characterGroup.deleteMany).not.toHaveBeenCalled();
  });

  it('target "personas" wipes personas but not characters or groups', async () => {
    db.persona.deleteMany.mockResolvedValue({ count: 2 });

    const res = mockRes();
    await purgeHandler(mockReq({ method: 'POST', body: { target: 'personas' } }), res);

    expect(res._body.deleted.personas).toBe(2);
    expect(db.character.deleteMany).not.toHaveBeenCalled();
    expect(db.characterGroup.deleteMany).not.toHaveBeenCalled();
  });

  it('target "everything" wipes all five tables but never settings or user prompts', async () => {
    const res = mockRes();
    await purgeHandler(mockReq({ method: 'POST', body: { target: 'everything' } }), res);

    expect(res._status).toBe(200);
    expect(db.messageVersion.deleteMany).toHaveBeenCalled();
    expect(db.chatMessage.deleteMany).toHaveBeenCalled();
    expect(db.chatSession.deleteMany).toHaveBeenCalled();
    expect(db.character.deleteMany).toHaveBeenCalled();
    expect(db.characterGroup.deleteMany).toHaveBeenCalled();
    expect(db.persona.deleteMany).toHaveBeenCalled();
    expect(db.setting.deleteMany).not.toHaveBeenCalled();
    expect(db.userPrompt.deleteMany).not.toHaveBeenCalled();
  });

  it('target "everything" deletes children before their parents', async () => {
    const res = mockRes();
    await purgeHandler(mockReq({ method: 'POST', body: { target: 'everything' } }), res);

    const order = [
      db.messageVersion.deleteMany.mock.invocationCallOrder[0],
      db.chatMessage.deleteMany.mock.invocationCallOrder[0],
      db.chatSession.deleteMany.mock.invocationCallOrder[0],
      db.character.deleteMany.mock.invocationCallOrder[0],
      db.characterGroup.deleteMany.mock.invocationCallOrder[0],
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});
