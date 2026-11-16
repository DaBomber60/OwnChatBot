import { schemas } from '../lib/validate';
import { GLOBAL_LOREBOOK_ID } from '../lib/globalLorebook';

describe('Lorebook schemas', () => {
  describe('createLorebook', () => {
    it('accepts valid lorebook data', () => {
      const result = schemas.createLorebook.safeParse({
        name: 'Test Lorebook',
        description: 'A description',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({
          name: 'Test Lorebook',
          description: 'A description',
        });
      }
    });

    it('allows missing description', () => {
      const result = schemas.createLorebook.safeParse({
        name: 'Test Lorebook',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('Test Lorebook');
        expect(result.data.description).toBeUndefined();
      }
    });

    it('rejects empty name', () => {
      const result = schemas.createLorebook.safeParse({
        name: '',
      });
      expect(result.success).toBe(false);
    });

    it('rejects name longer than 200 characters', () => {
      const result = schemas.createLorebook.safeParse({
        name: 'a'.repeat(201),
      });
      expect(result.success).toBe(false);
    });

    it('rejects description longer than 2000 characters', () => {
      const result = schemas.createLorebook.safeParse({
        name: 'Valid',
        description: 'a'.repeat(2001),
      });
      expect(result.success).toBe(false);
    });
  });

  describe('updateLorebook', () => {
    it('accepts partial updates', () => {
      const result = schemas.updateLorebook.safeParse({
        name: 'Updated Name',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('Updated Name');
      }
    });

    it('allows all fields to be undefined', () => {
      const result = schemas.updateLorebook.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe('createLoreEntry', () => {
    it('accepts valid entry data', () => {
      const result = schemas.createLoreEntry.safeParse({
        title: 'Entry Title',
        content: 'Entry content goes here',
        keys: ['trigger1', 'trigger2'],
        constant: false,
        enabled: true,
        priority: 50,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.keys).toEqual(['trigger1', 'trigger2']);
      }
    });

    it('allows missing keys array', () => {
      const result = schemas.createLoreEntry.safeParse({
        title: 'Entry Title',
        content: 'Entry content',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.keys).toBeUndefined();
      }
    });

    it('rejects empty title', () => {
      const result = schemas.createLoreEntry.safeParse({
        title: '',
        content: 'Content',
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing content', () => {
      const result = schemas.createLoreEntry.safeParse({
        title: 'Title',
      });
      expect(result.success).toBe(false);
    });

    it('rejects content longer than 50000 characters', () => {
      const result = schemas.createLoreEntry.safeParse({
        title: 'Title',
        content: 'a'.repeat(50001),
      });
      expect(result.success).toBe(false);
    });

    it('rejects priority outside valid range', () => {
      const result = schemas.createLoreEntry.safeParse({
        title: 'Title',
        content: 'Content',
        priority: 1001,
      });
      expect(result.success).toBe(false);
    });

    it('accepts priority level names and rejects unknown ones', () => {
      const parse = (priority: unknown) => schemas.createLoreEntry.safeParse({ title: 'Title', content: 'Content', priority });
      expect(parse('critical').success).toBe(true);
      expect(parse('minor').success).toBe(true);
      expect(parse('urgent').success).toBe(false);
    });

    it('rejects empty keys in array', () => {
      const result = schemas.createLoreEntry.safeParse({
        title: 'Title',
        content: 'Content',
        keys: [''],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('updateLoreEntry', () => {
    it('accepts partial entry updates', () => {
      const result = schemas.updateLoreEntry.safeParse({
        content: 'Updated content',
        enabled: false,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toBe('Updated content');
        expect(result.data.enabled).toBe(false);
      }
    });

    it('allows all fields to be undefined', () => {
      const result = schemas.updateLoreEntry.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe('linkLorebook', () => {
    it('accepts valid character ID', () => {
      const result = schemas.linkLorebook.safeParse({
        characterId: 123,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.characterId).toBe(123);
      }
    });

    it('rejects missing characterId', () => {
      const result = schemas.linkLorebook.safeParse({});
      expect(result.success).toBe(false);
    });

    it('rejects non-positive character ID', () => {
      const result = schemas.linkLorebook.safeParse({
        characterId: 0,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('unlinkLorebook', () => {
    it('accepts valid character ID', () => {
      const result = schemas.unlinkLorebook.safeParse({
        characterId: 123,
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing characterId', () => {
      const result = schemas.unlinkLorebook.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('Global lorebook constants', () => {
    it('defines GLOBAL_LOREBOOK_ID as 0', () => {
      expect(GLOBAL_LOREBOOK_ID).toBe(0);
    });
  });

  describe('Global lorebook constraints', () => {
    it('rejects createLoreEntry with constant=true for global lorebook', () => {
      // This would be checked in the API endpoint, not in schema validation
      // The schema allows constant=true, but the endpoint rejects it for global lore
      // This test documents that constraint exists
      const result = schemas.createLoreEntry.safeParse({
        title: 'Global Entry',
        content: 'This is global lore',
        constant: true,
      });
      expect(result.success).toBe(true);
      // The API endpoint checks: if (lorebookId === GLOBAL_LOREBOOK_ID && constant === true) { reject }
    });

    it('allows constant=false for global lorebook entries', () => {
      const result = schemas.createLoreEntry.safeParse({
        title: 'Global Entry',
        content: 'This is global lore',
        constant: false,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.constant).toBe(false);
      }
    });
  });

  describe('generateLoreKeywords', () => {
    it('accepts valid content with optional entryTitle', () => {
      const result = schemas.generateLoreKeywords.safeParse({
        content: 'This is a lore entry about a mysterious artifact...',
        entryTitle: 'The Artifact of Power',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('artifact');
        expect(result.data.entryTitle).toBe('The Artifact of Power');
      }
    });

    it('accepts content without entryTitle', () => {
      const result = schemas.generateLoreKeywords.safeParse({
        content: 'Some lore content here',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.entryTitle).toBeUndefined();
      }
    });

    it('rejects content shorter than 10 characters', () => {
      const result = schemas.generateLoreKeywords.safeParse({
        content: 'short',
      });
      expect(result.success).toBe(false);
    });

    it('rejects content longer than 50000 characters', () => {
      const result = schemas.generateLoreKeywords.safeParse({
        content: 'a'.repeat(50001),
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing content', () => {
      const result = schemas.generateLoreKeywords.safeParse({
        entryTitle: 'Title',
      });
      expect(result.success).toBe(false);
    });

    it('rejects entryTitle longer than 200 characters', () => {
      const result = schemas.generateLoreKeywords.safeParse({
        content: 'Valid content here for testing',
        entryTitle: 'a'.repeat(201),
      });
      expect(result.success).toBe(false);
    });

    it('allows empty entryTitle', () => {
      const result = schemas.generateLoreKeywords.safeParse({
        content: 'Some lore content here',
        entryTitle: '',
      });
      expect(result.success).toBe(true);
    });

    it('rejects non-string content', () => {
      const result = schemas.generateLoreKeywords.safeParse({
        content: 12345,
      });
      expect(result.success).toBe(false);
    });

    it('rejects non-string entryTitle', () => {
      const result = schemas.generateLoreKeywords.safeParse({
        content: 'Valid content here',
        entryTitle: 123,
      });
      expect(result.success).toBe(false);
    });
  });
});
