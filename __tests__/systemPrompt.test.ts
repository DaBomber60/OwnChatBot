import { replacePlaceholders, buildSystemPrompt } from '../lib/systemPrompt';
import type { SystemPromptPersona, SystemPromptCharacter, BuildSystemPromptOpts } from '../lib/systemPrompt';

// ---------------------------------------------------------------------------
// replacePlaceholders
// ---------------------------------------------------------------------------
describe('replacePlaceholders', () => {
  it('replaces {{user}} and {{char}} (double-brace)', () => {
    expect(replacePlaceholders('Hello {{user}}, I am {{char}}.', 'Alice', 'Bob'))
      .toBe('Hello Alice, I am Bob.');
  });

  it('replaces {user} and {char} (single-brace)', () => {
    expect(replacePlaceholders('Hi {user}, meet {char}.', 'Alice', 'Bob'))
      .toBe('Hi Alice, meet Bob.');
  });

  it('is case-insensitive', () => {
    expect(replacePlaceholders('{{USER}} meets {{CHAR}}', 'Alice', 'Bob'))
      .toBe('Alice meets Bob');
  });

  it('replaces multiple occurrences', () => {
    expect(replacePlaceholders('{{user}} and {{user}} talk to {{char}}', 'A', 'B'))
      .toBe('A and A talk to B');
  });

  it('handles empty string', () => {
    expect(replacePlaceholders('', 'Alice', 'Bob')).toBe('');
  });

  it('returns text unchanged when no placeholders present', () => {
    expect(replacePlaceholders('No placeholders here.', 'Alice', 'Bob'))
      .toBe('No placeholders here.');
  });

  it('handles mixed brace styles in the same string', () => {
    expect(replacePlaceholders('{user} and {{char}}', 'Alice', 'Bob'))
      .toBe('Alice and Bob');
  });
});

// ---------------------------------------------------------------------------
// buildSystemPrompt
// ---------------------------------------------------------------------------
describe('buildSystemPrompt', () => {
  const persona: SystemPromptPersona = { name: 'Alice', profile: 'A curious adventurer.' };
  const character: SystemPromptCharacter = {
    name: 'Bob',
    personality: 'A wise wizard.',
    scenario: '{{user}} enters the tower of {{char}}.',
    exampleDialogue: '{{user}}: Hello\n{{char}}: Greetings!',
  };

  it('builds a prompt with all required sections', () => {
    const prompt = buildSystemPrompt(persona, character);
    expect(prompt).toContain('<system>');
    expect(prompt).toContain('<Alice>A curious adventurer.</Alice>');
    expect(prompt).toContain('<Bob>A wise wizard.</Bob>');
    expect(prompt).toContain('<scenario>Alice enters the tower of Bob.</scenario>');
    expect(prompt).toContain('<example_dialogue>');
    expect(prompt).toContain('Alice: Hello');
    expect(prompt).toContain('Bob: Greetings!');
    expect(prompt).toContain('The following is a conversation between Alice and Bob.');
  });

  it('replaces placeholders in all text fields', () => {
    const prompt = buildSystemPrompt(persona, character);
    expect(prompt).not.toContain('{{user}}');
    expect(prompt).not.toContain('{{char}}');
  });

  it('includes summary when provided', () => {
    const opts: BuildSystemPromptOpts = { summary: 'They fought a dragon.' };
    const prompt = buildSystemPrompt(persona, character, opts);
    expect(prompt).toContain('<summary>Summary of what happened: They fought a dragon.</summary>');
  });

  it('skips summary when empty string', () => {
    const prompt = buildSystemPrompt(persona, character, { summary: '' });
    expect(prompt).not.toContain('<summary>');
  });

  it('skips summary when not provided', () => {
    const prompt = buildSystemPrompt(persona, character);
    expect(prompt).not.toContain('<summary>');
  });

  it('appends userPromptBody when provided', () => {
    const opts: BuildSystemPromptOpts = { userPromptBody: 'Always respond in verse.' };
    const prompt = buildSystemPrompt(persona, character, opts);
    expect(prompt).toContain('Always respond in verse.');
  });

  it('skips userPromptBody when empty', () => {
    const prompt = buildSystemPrompt(persona, character, { userPromptBody: '' });
    // Should not add an extra empty line at the end
    const lines = prompt.split('\n');
    expect(lines[lines.length - 1]).not.toBe('');
  });

  it('replaces placeholders inside summary and userPromptBody', () => {
    const opts: BuildSystemPromptOpts = {
      summary: '{{char}} saved {{user}}.',
      userPromptBody: 'Pretend {{user}} is royalty.',
    };
    const prompt = buildSystemPrompt(persona, character, opts);
    expect(prompt).toContain('Bob saved Alice.');
    expect(prompt).toContain('Pretend Alice is royalty.');
  });

  it('always starts with system tag', () => {
    const prompt = buildSystemPrompt(persona, character);
    expect(prompt.startsWith('<system>')).toBe(true);
  });

  it('places summary before scenario', () => {
    const opts: BuildSystemPromptOpts = { summary: 'Summary text' };
    const prompt = buildSystemPrompt(persona, character, opts);
    const summaryIdx = prompt.indexOf('<summary>');
    const scenarioIdx = prompt.indexOf('<scenario>');
    expect(summaryIdx).toBeLessThan(scenarioIdx);
  });
});
