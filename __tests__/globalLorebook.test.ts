jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    setting: { findUnique: jest.fn() },
    chatSession: { findUnique: jest.fn(), updateMany: jest.fn() },
  },
}));

import prisma from '../lib/prisma';
import {
  GLOBAL_LOREBOOK_ID,
  getDefaultGlobalLoreEnabled,
  isGlobalLoreEnabledForSession,
  setGlobalLoreEnabledForSession,
} from '../lib/globalLorebook';

const db = prisma as any;

beforeEach(() => jest.clearAllMocks());

describe('Global lorebook helpers', () => {
  it('reserves ID 0 for the global lorebook', () => {
    expect(GLOBAL_LOREBOOK_ID).toBe(0);
  });

  describe('getDefaultGlobalLoreEnabled', () => {
    it('defaults new chats to enabled unless the user-level setting is "false"', async () => {
      db.setting.findUnique.mockResolvedValueOnce(null);
      await expect(getDefaultGlobalLoreEnabled()).resolves.toBe(true);
      db.setting.findUnique.mockResolvedValueOnce({ key: 'globalLoreEnabled', value: 'false' });
      await expect(getDefaultGlobalLoreEnabled()).resolves.toBe(false);
    });

    it('falls back to enabled when the setting cannot be read', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => {});
      db.setting.findUnique.mockRejectedValueOnce(new Error('db down'));
      await expect(getDefaultGlobalLoreEnabled()).resolves.toBe(true);
    });
  });

  describe('per-chat toggle', () => {
    it("reads the chat's own column and reports unknown chats as null", async () => {
      db.chatSession.findUnique.mockResolvedValueOnce({ globalLoreEnabled: false });
      await expect(isGlobalLoreEnabledForSession(3)).resolves.toBe(false);
      db.chatSession.findUnique.mockResolvedValueOnce(null);
      await expect(isGlobalLoreEnabledForSession(4)).resolves.toBeNull();
    });

    it('reports whether the chat existed when updating', async () => {
      db.chatSession.updateMany.mockResolvedValueOnce({ count: 1 });
      await expect(setGlobalLoreEnabledForSession(3, false)).resolves.toBe(true);
      expect(db.chatSession.updateMany).toHaveBeenCalledWith({ where: { id: 3 }, data: { globalLoreEnabled: false } });
      db.chatSession.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(setGlobalLoreEnabledForSession(4, true)).resolves.toBe(false);
    });
  });
});
