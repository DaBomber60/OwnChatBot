/**
 * @jest-environment node
 */
import { mockReq, mockRes, suppressConsole } from './helpers/mockHttp';

jest.mock('../lib/apiAuth', () => ({
  requireAuth: jest.fn().mockResolvedValue(true),
}));

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    character: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    characterGroup: { findUnique: jest.fn(), update: jest.fn() },
    characterAvatar: { findUnique: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() },
    characterGroupAvatar: { findUnique: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() },
  },
}));

import prisma from '../lib/prisma';
import { AVATAR_MAX_BYTES, decodeAvatarDataUrl, importAvatarIfMissing } from '../lib/avatarStore';
import { characterAvatarUrl, initials } from '../lib/avatar';
import characterAvatarHandler from '../pages/api/characters/[id]/avatar';
import groupAvatarHandler from '../pages/api/character-groups/[id]/avatar';
import charactersHandler from '../pages/api/characters/index';

const db = prisma as any;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
const dataUrl = (bytes: Buffer, type = 'image/png') => `data:${type};base64,${bytes.toString('base64')}`;

suppressConsole();
beforeEach(() => jest.clearAllMocks());

describe('decodeAvatarDataUrl', () => {
  it('trusts the image bytes over the declared type', () => {
    const result = decodeAvatarDataUrl(dataUrl(WEBP, 'image/png'));
    expect(result).toMatchObject({ ok: true, avatar: { mimeType: 'image/webp' } });
  });

  it('rejects non-images, other formats and oversized pictures', () => {
    expect(decodeAvatarDataUrl(42)).toMatchObject({ ok: false, tooLarge: false });
    expect(decodeAvatarDataUrl('https://example.com/a.png')).toMatchObject({ ok: false, tooLarge: false });
    expect(decodeAvatarDataUrl(dataUrl(Buffer.from('<svg onload="x"></svg>'), 'image/svg+xml'))).toMatchObject({ ok: false, tooLarge: false });

    const huge = Buffer.concat([PNG, Buffer.alloc(AVATAR_MAX_BYTES)]);
    expect(decodeAvatarDataUrl(dataUrl(huge))).toMatchObject({ ok: false, tooLarge: true });
  });
});

describe('/api/characters/:id/avatar', () => {
  it('serves the stored bytes, caching versioned URLs indefinitely', async () => {
    db.characterAvatar.findUnique.mockResolvedValue({ mimeType: 'image/png', data: new Uint8Array(PNG) });
    const res = mockRes();
    await characterAvatarHandler(mockReq({ method: 'GET', query: { id: '4', v: '123' } }), res);
    expect(res._status).toBe(200);
    expect(res._headers['Content-Type']).toBe('image/png');
    expect(res._headers['Cache-Control']).toContain('immutable');
    expect(Buffer.compare(res._body, PNG)).toBe(0);

    db.characterAvatar.findUnique.mockResolvedValue(null);
    const missing = mockRes();
    await characterAvatarHandler(mockReq({ method: 'GET', query: { id: '4' } }), missing);
    expect(missing._status).toBe(404);
  });

  it('stores an upload and stamps avatarUpdatedAt in one transaction', async () => {
    db.character.findUnique.mockResolvedValue({ id: 4 });
    const res = mockRes();
    await characterAvatarHandler(mockReq({ method: 'PUT', query: { id: '4' }, body: { image: dataUrl(PNG) } }), res);
    expect(res._status).toBe(200);
    expect(res._body.avatarUpdatedAt).toBeInstanceOf(Date);
    expect(db.characterAvatar.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { characterId: 4 },
      create: expect.objectContaining({ characterId: 4, mimeType: 'image/png' }),
    }));
    expect(db.character.update).toHaveBeenCalledWith({ where: { id: 4 }, data: { avatarUpdatedAt: res._body.avatarUpdatedAt } });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid uploads and unknown characters before writing', async () => {
    const invalid = mockRes();
    await characterAvatarHandler(mockReq({ method: 'PUT', query: { id: '4' }, body: { image: 'data:image/png;base64,AAAA' } }), invalid);
    expect(invalid._status).toBe(400);

    db.character.findUnique.mockResolvedValue(null);
    const missing = mockRes();
    await characterAvatarHandler(mockReq({ method: 'PUT', query: { id: '9' }, body: { image: dataUrl(PNG) } }), missing);
    expect(missing._status).toBe(404);
    expect(db.characterAvatar.upsert).not.toHaveBeenCalled();
  });
});

describe('/api/character-groups/:id/avatar', () => {
  it('removes the picture and clears avatarUpdatedAt', async () => {
    db.characterGroup.findUnique.mockResolvedValue({ id: 2 });
    const res = mockRes();
    await groupAvatarHandler(mockReq({ method: 'DELETE', query: { id: '2' } }), res);
    expect(res._status).toBe(204);
    expect(db.characterGroupAvatar.deleteMany).toHaveBeenCalledWith({ where: { groupId: 2 } });
    expect(db.characterGroup.update).toHaveBeenCalledWith({ where: { id: 2 }, data: { avatarUpdatedAt: null } });
  });
});

describe('POST /api/characters (cloning)', () => {
  const clone = (avatarFromCharacterId: number) => mockReq({
    method: 'POST',
    body: { name: 'Aria', profileName: 'Aria - [Clone]', scenario: 's', personality: 'p', avatarFromCharacterId },
  });

  beforeEach(() => {
    db.character.findFirst.mockResolvedValue(null);
    db.character.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 11, ...data }));
  });

  it("creates the clone with a copy of the source character's picture", async () => {
    db.characterAvatar.findUnique.mockResolvedValue({ mimeType: 'image/webp', data: new Uint8Array(WEBP) });
    const res = mockRes();
    await charactersHandler(clone(4), res);
    expect(res._status).toBe(201);
    expect(db.characterAvatar.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { characterId: 4 } }));
    const { data } = db.character.create.mock.calls[0][0];
    expect(data.avatarUpdatedAt).toBeInstanceOf(Date);
    expect(data.avatar).toEqual({ create: { mimeType: 'image/webp', data: new Uint8Array(WEBP) } });
  });

  it('creates the clone without a picture when the source has none', async () => {
    db.characterAvatar.findUnique.mockResolvedValue(null);
    const res = mockRes();
    await charactersHandler(clone(4), res);
    expect(res._status).toBe(201);
    const { data } = db.character.create.mock.calls[0][0];
    expect(data).not.toHaveProperty('avatar');
    expect(data).not.toHaveProperty('avatarUpdatedAt');
  });
});

describe('importAvatarIfMissing', () => {
  const record = { ownerId: 1, mimeType: 'image/png', data: PNG.toString('base64') };

  it('never replaces a picture the local record already has', async () => {
    db.characterAvatar.findUnique.mockResolvedValue({ characterId: 5 });
    await expect(importAvatarIfMissing('character', 5, record)).resolves.toBe('skipped');
    expect(db.characterAvatar.upsert).not.toHaveBeenCalled();

    db.characterAvatar.findUnique.mockResolvedValue(null);
    await expect(importAvatarIfMissing('character', 5, record)).resolves.toBe('imported');
    await expect(importAvatarIfMissing('character', 5, { ...record, data: 'bm90IGFuIGltYWdl' })).resolves.toBe('invalid');
  });
});

describe('avatar URLs', () => {
  const at = '2026-11-17T00:00:00.000Z';
  const version = new Date(at).getTime();

  it("falls back from the character's picture to its group's, then to none", () => {
    const group = { id: 3, avatarUpdatedAt: at };
    expect(characterAvatarUrl({ id: 7, avatarUpdatedAt: at, group })).toBe(`/api/characters/7/avatar?v=${version}`);
    expect(characterAvatarUrl({ id: 7, avatarUpdatedAt: null, group })).toBe(`/api/character-groups/3/avatar?v=${version}`);
    expect(characterAvatarUrl({ id: 7, avatarUpdatedAt: null, group: { id: 3, avatarUpdatedAt: null } })).toBeNull();
    expect(characterAvatarUrl({ id: 7, avatarUpdatedAt: null, group }, null)).toBeNull();
  });

  it('builds initials from letters, keeping astral characters whole', () => {
    expect(initials('"Lady" Aria Vale')).toBe('LV');
    expect(initials('𝒜rin')).toBe('𝒜');
    expect(initials('***')).toBe('?');
  });
});
