import {
  parseMessageMetadata,
  getTriggeredLoreIds,
  getMatchedLoreIds,
  hasTriggeredLore,
  createMessageMetadata,
  serializeLoreMetadata,
  remapLoreMetadata,
} from '../lib/messageMetadata';

describe('Message Metadata Utilities', () => {
  describe('parseMessageMetadata', () => {
    it('should parse valid JSON metadata', () => {
      const json = JSON.stringify({ triggeredLoreIds: [1, 2, 3] });
      const result = parseMessageMetadata(json);

      expect(result.triggeredLoreIds).toEqual([1, 2, 3]);
    });

    it('should return empty object for null metadata', () => {
      const result = parseMessageMetadata(null);
      expect(result).toEqual({});
    });

    it('should return empty object for undefined metadata', () => {
      const result = parseMessageMetadata(undefined);
      expect(result).toEqual({});
    });

    it('should handle invalid JSON gracefully', () => {
      const result = parseMessageMetadata('invalid json {');
      expect(result).toEqual({});
    });

    it('should handle empty string metadata', () => {
      const result = parseMessageMetadata('');
      expect(result).toEqual({});
    });

    it('should preserve other metadata fields', () => {
      const json = JSON.stringify({
        triggeredLoreIds: [5],
        customField: 'value',
        nested: { data: true },
      });
      const result = parseMessageMetadata(json);

      expect(result.triggeredLoreIds).toEqual([5]);
      expect(result.customField).toBe('value');
      expect(result.nested).toEqual({ data: true });
    });
  });

  describe('getTriggeredLoreIds', () => {
    it('should extract triggered lore IDs from metadata', () => {
      const json = JSON.stringify({ triggeredLoreIds: [10, 20, 30] });
      const result = getTriggeredLoreIds(json);

      expect(result).toEqual([10, 20, 30]);
    });

    it('should return empty array when no lore IDs', () => {
      const json = JSON.stringify({ triggeredLoreIds: [] });
      const result = getTriggeredLoreIds(json);

      expect(result).toEqual([]);
    });

    it('should return empty array for null metadata', () => {
      const result = getTriggeredLoreIds(null);
      expect(result).toEqual([]);
    });

    it('should return empty array when field is missing', () => {
      const json = JSON.stringify({ otherField: 'value' });
      const result = getTriggeredLoreIds(json);

      expect(result).toEqual([]);
    });

    it('should handle invalid JSON gracefully', () => {
      const result = getTriggeredLoreIds('invalid {json}');
      expect(result).toEqual([]);
    });
  });

  describe('hasTriggeredLore', () => {
    it('should return true when lore IDs are present', () => {
      const json = JSON.stringify({ triggeredLoreIds: [1, 2] });
      const result = hasTriggeredLore(json);

      expect(result).toBe(true);
    });

    it('should return false when lore IDs array is empty', () => {
      const json = JSON.stringify({ triggeredLoreIds: [] });
      const result = hasTriggeredLore(json);

      expect(result).toBe(false);
    });

    it('should return false for null metadata', () => {
      const result = hasTriggeredLore(null);
      expect(result).toBe(false);
    });

    it('should return false when field is missing', () => {
      const json = JSON.stringify({ other: 'data' });
      const result = hasTriggeredLore(json);

      expect(result).toBe(false);
    });

    it('should return false for invalid JSON', () => {
      const result = hasTriggeredLore('bad json');
      expect(result).toBe(false);
    });
  });

  describe('createMessageMetadata', () => {
    it('should create metadata with triggered lore IDs', () => {
      const result = createMessageMetadata([5, 10, 15]);

      expect(result).toEqual({
        triggeredLoreIds: [5, 10, 15],
      });
    });

    it('should create metadata with empty array by default', () => {
      const result = createMessageMetadata();

      expect(result).toEqual({
        triggeredLoreIds: [],
      });
    });

    it('should handle empty input array', () => {
      const result = createMessageMetadata([]);

      expect(result).toEqual({
        triggeredLoreIds: [],
      });
    });

    it('should preserve array order', () => {
      const input = [3, 1, 2];
      const result = createMessageMetadata(input);

      expect(result.triggeredLoreIds).toEqual([3, 1, 2]);
    });
  });

  describe('Round-trip JSON serialization', () => {
    it('should preserve data through JSON round-trip', () => {
      const original = { triggeredLoreIds: [7, 8, 9] };
      const json = JSON.stringify(original);
      const parsed = parseMessageMetadata(json);

      expect(parsed).toEqual(original);
    });

    it('should preserve triggered lore IDs in chat message workflow', () => {
      const triggeredIds = [42, 43];
      const metadata = createMessageMetadata(triggeredIds);
      const jsonStr = JSON.stringify(metadata);
      const retrieved = getTriggeredLoreIds(jsonStr);

      expect(retrieved).toEqual(triggeredIds);
    });

    it('should indicate presence of triggered lore through workflow', () => {
      const metadata = createMessageMetadata([100]);
      const jsonStr = JSON.stringify(metadata);
      const hasLore = hasTriggeredLore(jsonStr);

      expect(hasLore).toBe(true);
    });

    it('should indicate absence of triggered lore through workflow', () => {
      const metadata = createMessageMetadata([]);
      const jsonStr = JSON.stringify(metadata);
      const hasLore = hasTriggeredLore(jsonStr);

      expect(hasLore).toBe(false);
    });
  });

  describe('Edge cases', () => {
    it('should handle very large lore ID arrays', () => {
      const largeArray = Array.from({ length: 1000 }, (_, i) => i + 1);
      const result = createMessageMetadata(largeArray);

      expect(result.triggeredLoreIds).toHaveLength(1000);
      expect((result.triggeredLoreIds as number[])[0]).toBe(1);
      expect((result.triggeredLoreIds as number[])[999]).toBe(1000);
    });

    it('should handle duplicate lore IDs', () => {
      const result = createMessageMetadata([1, 1, 2, 2, 3]);

      // Should preserve duplicates as passed
      expect(result.triggeredLoreIds).toEqual([1, 1, 2, 2, 3]);
    });

    it('should handle whitespace-only string as empty metadata', () => {
      const result = parseMessageMetadata('   ');
      expect(result).toEqual({});
    });

    it('should treat JSON that is not an object as empty metadata', () => {
      expect(parseMessageMetadata('[1,2]')).toEqual({});
      expect(parseMessageMetadata('null')).toEqual({});
      expect(getTriggeredLoreIds('42')).toEqual([]);
    });

    it('should ignore non-integer IDs', () => {
      expect(getTriggeredLoreIds(JSON.stringify({ triggeredLoreIds: [1, '2', 3.5, null, 4] }))).toEqual([1, 4]);
    });
  });

  describe('Keep-active matches', () => {
    it('stores keyword matches separately from everything injected', () => {
      const json = JSON.stringify(createMessageMetadata([1, 2, 3], [2]));
      expect(getTriggeredLoreIds(json)).toEqual([1, 2, 3]);
      expect(getMatchedLoreIds(json)).toEqual([2]);
    });

    it('returns no matches for metadata written without them', () => {
      expect(getMatchedLoreIds(JSON.stringify({ triggeredLoreIds: [1] }))).toEqual([]);
    });
  });

  describe('serializeLoreMetadata', () => {
    it('returns null when no lore was involved, so plain replies store no metadata', () => {
      expect(serializeLoreMetadata([], [])).toBeNull();
    });

    it('serializes injected and matched IDs', () => {
      expect(JSON.parse(serializeLoreMetadata([4, 5], [5])!)).toEqual({ triggeredLoreIds: [4, 5], matchedLoreIds: [5] });
    });
  });

  describe('remapLoreMetadata (database import)', () => {
    const idMap = new Map([[1, 101], [2, 102]]);

    it('rewrites entry IDs and drops ones that were not imported', () => {
      const json = JSON.stringify({ triggeredLoreIds: [1, 2, 3], matchedLoreIds: [2, 3], other: 'kept' });
      expect(JSON.parse(remapLoreMetadata(json, idMap)!)).toEqual({
        triggeredLoreIds: [101, 102],
        matchedLoreIds: [102],
        other: 'kept',
      });
    });

    it('returns null for empty or unreadable metadata', () => {
      expect(remapLoreMetadata(null, idMap)).toBeNull();
      expect(remapLoreMetadata('not json', idMap)).toBeNull();
    });
  });
});
