import prisma from './prisma';
import { badRequest, notFound, payloadTooLarge } from './apiErrors';
import { withApiHandler } from './withApiHandler';

/** The editor exports 256px images (~20–60KB); this leaves room for an uncropped PNG. */
export const AVATAR_MAX_BYTES = 512 * 1024;

export type AvatarOwnerKind = 'character' | 'group';

export interface StoredAvatar {
  mimeType: string;
  data: Uint8Array;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(data: Uint8Array, bytes: number[], offset = 0): boolean {
  if (data.length < offset + bytes.length) return false;
  return bytes.every((byte, i) => data[offset + i] === byte);
}

const ascii = (text: string) => Array.from(text, ch => ch.charCodeAt(0));

/** Identifies an image by its leading bytes; the declared type of an upload is never trusted. */
export function sniffImageType(data: Uint8Array): string | null {
  if (startsWith(data, PNG_SIGNATURE)) return 'image/png';
  if (startsWith(data, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(data, ascii('RIFF')) && startsWith(data, ascii('WEBP'), 8)) return 'image/webp';
  return null;
}

export type AvatarDecodeResult =
  | { ok: true; avatar: StoredAvatar & { data: Buffer } }
  | { ok: false; tooLarge: boolean; message: string };

const DATA_URL_RE = /^data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/]+={0,2})$/i;

export function decodeAvatarDataUrl(input: unknown): AvatarDecodeResult {
  const fail = (message: string, tooLarge = false): AvatarDecodeResult => ({ ok: false, tooLarge, message });
  if (typeof input !== 'string') return fail('Expected an image data URL');

  const match = DATA_URL_RE.exec(input.trim());
  if (!match) return fail('Expected a base64 image data URL');

  const base64 = match[1]!;
  if (Math.floor((base64.length * 3) / 4) > AVATAR_MAX_BYTES + 2) {
    return fail(`Pictures must be ${AVATAR_MAX_BYTES / 1024}KB or smaller`, true);
  }

  const data = Buffer.from(base64, 'base64');
  if (data.length > AVATAR_MAX_BYTES) return fail(`Pictures must be ${AVATAR_MAX_BYTES / 1024}KB or smaller`, true);

  const mimeType = sniffImageType(data);
  if (!mimeType) return fail('Unsupported image format. Use PNG, JPEG, or WebP.');
  return { ok: true, avatar: { mimeType, data } };
}

export async function readAvatar(kind: AvatarOwnerKind, id: number): Promise<StoredAvatar | null> {
  if (kind === 'character') {
    return prisma.characterAvatar.findUnique({ where: { characterId: id }, select: { mimeType: true, data: true } });
  }
  return prisma.characterGroupAvatar.findUnique({ where: { groupId: id }, select: { mimeType: true, data: true } });
}

async function ownerExists(kind: AvatarOwnerKind, id: number): Promise<boolean> {
  const owner = kind === 'character'
    ? await prisma.character.findUnique({ where: { id }, select: { id: true } })
    : await prisma.characterGroup.findUnique({ where: { id }, select: { id: true } });
  return Boolean(owner);
}

/** Stores the picture and stamps the owner's avatarUpdatedAt (the client's cache-busting key). */
export async function saveAvatar(kind: AvatarOwnerKind, id: number, avatar: StoredAvatar): Promise<Date> {
  const avatarUpdatedAt = new Date();
  const { mimeType, data } = avatar;
  if (kind === 'character') {
    await prisma.$transaction([
      prisma.characterAvatar.upsert({
        where: { characterId: id },
        create: { characterId: id, mimeType, data },
        update: { mimeType, data },
      }),
      prisma.character.update({ where: { id }, data: { avatarUpdatedAt } }),
    ]);
  } else {
    await prisma.$transaction([
      prisma.characterGroupAvatar.upsert({
        where: { groupId: id },
        create: { groupId: id, mimeType, data },
        update: { mimeType, data },
      }),
      prisma.characterGroup.update({ where: { id }, data: { avatarUpdatedAt } }),
    ]);
  }
  return avatarUpdatedAt;
}

export async function removeAvatar(kind: AvatarOwnerKind, id: number): Promise<void> {
  if (kind === 'character') {
    await prisma.$transaction([
      prisma.characterAvatar.deleteMany({ where: { characterId: id } }),
      prisma.character.update({ where: { id }, data: { avatarUpdatedAt: null } }),
    ]);
  } else {
    await prisma.$transaction([
      prisma.characterGroupAvatar.deleteMany({ where: { groupId: id } }),
      prisma.characterGroup.update({ where: { id }, data: { avatarUpdatedAt: null } }),
    ]);
  }
}

/**
 * GET    → the picture bytes (immutable caching when requested with ?v=<avatarUpdatedAt>)
 * PUT    { image: dataURL } → { avatarUpdatedAt }
 * DELETE → 204
 */
export function createAvatarHandler(kind: AvatarOwnerKind) {
  const label = kind === 'character' ? 'Character' : 'Group';
  const ownerMissing = (res: Parameters<typeof notFound>[0]) =>
    notFound(res, `${label} not found`, kind === 'character' ? 'CHARACTER_NOT_FOUND' : 'GROUP_NOT_FOUND');

  return withApiHandler({ parseId: true }, {
    GET: async (req, res, { id }) => {
      const avatar = await readAvatar(kind, id);
      if (!avatar) return notFound(res, `${label} has no picture`, 'AVATAR_NOT_FOUND');

      const body = Buffer.from(avatar.data);
      res.setHeader('Content-Type', avatar.mimeType);
      res.setHeader('Content-Length', String(body.length));
      res.setHeader('X-Content-Type-Options', 'nosniff');
      // Versioned URLs change whenever the picture does, so they can be cached forever.
      res.setHeader('Cache-Control', req.query.v ? 'private, max-age=31536000, immutable' : 'private, no-cache');
      return res.status(200).send(body);
    },

    PUT: async (req, res, { id }) => {
      const decoded = decodeAvatarDataUrl(req.body?.image);
      if (!decoded.ok) {
        return decoded.tooLarge
          ? payloadTooLarge(res, decoded.message, 'AVATAR_TOO_LARGE')
          : badRequest(res, decoded.message, 'INVALID_AVATAR');
      }
      if (!(await ownerExists(kind, id))) return ownerMissing(res);

      const avatarUpdatedAt = await saveAvatar(kind, id, decoded.avatar);
      return res.status(200).json({ avatarUpdatedAt });
    },

    DELETE: async (_req, res, { id }) => {
      if (!(await ownerExists(kind, id))) return ownerMissing(res);
      await removeAvatar(kind, id);
      return res.status(204).end();
    },
  });
}

/** Avatars serialized into database exports; the bytes travel as base64. */
export interface ExportedAvatar {
  ownerId: number;
  mimeType: string;
  data: string;
}

export async function exportAvatars(): Promise<{ characterAvatars: ExportedAvatar[]; characterGroupAvatars: ExportedAvatar[] }> {
  const [characterRows, groupRows] = await Promise.all([
    prisma.characterAvatar.findMany({ orderBy: { characterId: 'asc' } }),
    prisma.characterGroupAvatar.findMany({ orderBy: { groupId: 'asc' } }),
  ]);
  const toExport = (ownerId: number, row: StoredAvatar): ExportedAvatar => ({
    ownerId,
    mimeType: row.mimeType,
    data: Buffer.from(row.data).toString('base64'),
  });
  return {
    characterAvatars: characterRows.map(row => toExport(row.characterId, row)),
    characterGroupAvatars: groupRows.map(row => toExport(row.groupId, row)),
  };
}

/** Validates an exported avatar record the same way as an upload. */
export function decodeExportedAvatar(record: unknown): StoredAvatar | null {
  if (!record || typeof record !== 'object') return null;
  const { mimeType, data } = record as Partial<ExportedAvatar>;
  if (typeof data !== 'string' || typeof mimeType !== 'string') return null;
  const decoded = decodeAvatarDataUrl(`data:${mimeType};base64,${data}`);
  return decoded.ok ? decoded.avatar : null;
}

/** Restores an exported picture onto an owner that has none; an existing picture is never replaced. */
export async function importAvatarIfMissing(
  kind: AvatarOwnerKind,
  ownerId: number,
  record: unknown,
): Promise<'imported' | 'skipped' | 'invalid'> {
  const avatar = decodeExportedAvatar(record);
  if (!avatar) return 'invalid';
  const existing = kind === 'character'
    ? await prisma.characterAvatar.findUnique({ where: { characterId: ownerId }, select: { characterId: true } })
    : await prisma.characterGroupAvatar.findUnique({ where: { groupId: ownerId }, select: { groupId: true } });
  if (existing) return 'skipped';
  await saveAvatar(kind, ownerId, avatar);
  return 'imported';
}
