import { parseChatData } from '../pages/api/import/receive';

// Suppress console.log noise from parseChatData
beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

// ---------------------------------------------------------------------------
// Helper to build request data with a system message
// ---------------------------------------------------------------------------
function makeRequest(systemContent: string, chatMessages: Array<{ role: string; content: string }> = []) {
  return {
    messages: [
      { role: 'system', content: systemContent },
      { role: 'user', content: '.' },
      ...chatMessages,
    ],
  };
}

// ---------------------------------------------------------------------------
// Original test — persona name replacement
// ---------------------------------------------------------------------------
describe('parseChatData user name handling', () => {
  it('replaces detected user name with {{user}} in character fields', () => {
    const requestData = {
      messages: [
        {
          role: 'system',
          content:
            '<ownchatbot_importer>' +
            'Takashi is a reserved high school student who keeps to himself.' +
            '<scenario>She mistreats Takashi, calls him names and teases him in class.</scenario>' +
            '<example_dialogs>Takashi: Hello there!\n{{char}}: Oh, Takashi, still daydreaming?</example_dialogs>' +
            '<summary>A brief summary.</summary>'
        },
        { role: 'user', content: '.' },
        { role: 'assistant', content: 'Hello, Takashi. Are you ready for class?' },
        { role: 'user', content: 'Takashi: Yeah, I guess so.' },
        { role: 'assistant', content: 'Great, {{char}} will meet you after school, Takashi.' }
      ]
    };

    const { data } = parseChatData(requestData as any);

    expect(data.detectedPersonaName).toBe('Takashi');
    expect(data.characterData.personality).not.toContain('Takashi');
    expect(data.characterData.personality).toContain('{{user}}');
    expect(data.characterData.scenario).toBe('She mistreats {{user}}, calls him names and teases him in class.');
    expect(data.characterData.exampleDialogue).toContain('{{user}}: Hello there!');
    expect(data.characterData.firstMessage).toBe('Hello, {{user}}. Are you ready for class?');
  });
});

// ---------------------------------------------------------------------------
// New-schema persona tag parsing
// ---------------------------------------------------------------------------
describe('parseChatData new-schema persona tag', () => {
  it('extracts personality from <CharacterName\'s Persona> tag', () => {
    const system =
      '<ownchatbot_importer>' +
      "<Alice's Persona>Alice is a kind wizard who helps people.</Alice's Persona>" +
      '<scenario>In a magical kingdom.</scenario>';
    const { data } = parseChatData(makeRequest(system));
    expect(data.characterData.personality).toBe('Alice is a kind wizard who helps people.');
    expect(data.characterData.scenario).toBe('In a magical kingdom.');
  });
});

// ---------------------------------------------------------------------------
// Legacy fallback parsing (no persona tag)
// ---------------------------------------------------------------------------
describe('parseChatData legacy fallback parsing', () => {
  it('extracts personality as text before first structural tag', () => {
    const system =
      '<ownchatbot_importer>' +
      'Bob is a grumpy old wizard.' +
      '<scenario>Dark tower.</scenario>' +
      '<example_dialogs>Hello!</example_dialogs>';
    const { data } = parseChatData(makeRequest(system));
    expect(data.characterData.personality).toBe('Bob is a grumpy old wizard.');
    expect(data.characterData.scenario).toBe('Dark tower.');
    expect(data.characterData.exampleDialogue).toBe('Hello!');
  });

  it('works when only <example_dialogs> is present (no scenario)', () => {
    const system =
      '<ownchatbot_importer>' +
      'Some personality text.' +
      '<example_dialogs>Chat goes here</example_dialogs>';
    const { data } = parseChatData(makeRequest(system));
    expect(data.characterData.personality).toBe('Some personality text.');
    expect(data.characterData.exampleDialogue).toBe('Chat goes here');
  });

  it('throws when no structural tags found', () => {
    const system = '<ownchatbot_importer>Just some plain text with no tags';
    expect(() => parseChatData(makeRequest(system))).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Character name detection
// ---------------------------------------------------------------------------
describe('parseChatData character name detection', () => {
  it('detects name from "I am Name" pattern', () => {
    const system =
      '<ownchatbot_importer>' +
      'I am Victoria, a noble knight.' +
      '<scenario>Castle.</scenario>';
    const { data } = parseChatData(makeRequest(system));
    expect(data.characterData.name).toBe('Victoria');
  });

  it('detects name from "My name is Name" pattern', () => {
    const system =
      '<ownchatbot_importer>' +
      'My name is Arthur, the dragon slayer.' +
      '<scenario>The lair.</scenario>';
    const { data } = parseChatData(makeRequest(system));
    expect(data.characterData.name).toBe('Arthur');
  });

  it('skips name detection when {{char}} placeholder is present', () => {
    const system =
      '<ownchatbot_importer>' +
      '{{char}} is a powerful mage. I am Victoria.' +
      '<scenario>Castle.</scenario>';
    const { data } = parseChatData(makeRequest(system));
    expect(data.characterData.name).toBe('');
  });

  it('skips name detection when {{user}} placeholder is present', () => {
    const system =
      '<ownchatbot_importer>' +
      'I am Charlie. {{user}} is my friend.' +
      '<scenario>Park.</scenario>';
    const { data } = parseChatData(makeRequest(system));
    expect(data.characterData.name).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Summary extraction
// ---------------------------------------------------------------------------
describe('parseChatData summary extraction', () => {
  it('extracts summary when present', () => {
    const system =
      '<ownchatbot_importer>' +
      'Personality here.' +
      '<scenario>Scene.</scenario>' +
      '<summary>They discussed the plan.</summary>';
    const { data } = parseChatData(makeRequest(system));
    expect(data.summary).toBe('They discussed the plan.');
  });

  it('returns empty string when no summary tag', () => {
    const system =
      '<ownchatbot_importer>' +
      'Personality here.' +
      '<scenario>Scene.</scenario>';
    const { data } = parseChatData(makeRequest(system));
    expect(data.summary).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Split suggestion logic
// ---------------------------------------------------------------------------
describe('parseChatData split suggestion', () => {
  it('offers split suggestion when scenario tag is missing and personality has newlines', () => {
    const system =
      '<ownchatbot_importer>' +
      "<Bot's Persona>Line one.\nLine two.\nLine three.</Bot's Persona>";
    const { data } = parseChatData(makeRequest(system));
    expect(data.scenarioWasMissing).toBe(true);
    expect(data.splitSuggestion).not.toBeNull();
    expect(data.splitSuggestion!.canSplit).toBe(true);
    expect(data.splitSuggestion!.newlineCount).toBe(2);
  });

  it('does not offer split when scenario tag is present', () => {
    const system =
      '<ownchatbot_importer>' +
      "<Bot's Persona>Line one.\nLine two.</Bot's Persona>" +
      '<scenario>Existing scenario.</scenario>';
    const { data } = parseChatData(makeRequest(system));
    expect(data.scenarioWasMissing).toBe(false);
    expect(data.splitSuggestion).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Chat messages and first message extraction
// ---------------------------------------------------------------------------
describe('parseChatData chat message handling', () => {
  it('captures chat messages after the first two (system + dot)', () => {
    const system =
      '<ownchatbot_importer>Bot personality.<scenario>Scene.</scenario>';
    const chatMsgs = [
      { role: 'assistant', content: 'Hello there!' },
      { role: 'user', content: 'Alice: Hi!' },
    ];
    const { data } = parseChatData(makeRequest(system, chatMsgs));
    expect(data.chatMessages).toHaveLength(2);
    expect(data.characterData.firstMessage).toBe('Hello there!');
  });

  it('detects persona name from last user message with colon format', () => {
    const system =
      '<ownchatbot_importer>Bot personality.<scenario>Scene.</scenario>';
    const chatMsgs = [
      { role: 'assistant', content: 'Hello!' },
      { role: 'user', content: 'Alice: Hey there' },
      { role: 'assistant', content: 'Nice to meet you!' },
      { role: 'user', content: 'Bob: What about me?' },
    ];
    const { data } = parseChatData(makeRequest(system, chatMsgs));
    // Should detect from the most recent user message
    expect(data.detectedPersonaName).toBe('Bob');
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------
describe('parseChatData error handling', () => {
  it('throws when messages array is missing', () => {
    expect(() => parseChatData({} as any)).toThrow();
  });

  it('throws when no system message exists', () => {
    expect(() =>
      parseChatData({ messages: [{ role: 'user', content: 'hi' }] })
    ).toThrow();
  });

  it('throws when <ownchatbot_importer> marker is missing', () => {
    // parseChatData throws an object { error: Error, logs: string[] }
    expect(() =>
      parseChatData({
        messages: [{ role: 'system', content: 'Just normal system content' }, { role: 'user', content: '.' }],
      })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// hasSubstantialChat heuristic
// ---------------------------------------------------------------------------
describe('parseChatData hasSubstantialChat', () => {
  it('returns false for minimal setup (only dot message)', () => {
    const system =
      '<ownchatbot_importer>Personality.<scenario>Scene.</scenario>';
    const { data } = parseChatData(makeRequest(system));
    expect(data.hasSubstantialChat).toBe(false);
  });

  it('returns true when multiple real messages exist', () => {
    const system =
      '<ownchatbot_importer>Personality.<scenario>Scene.</scenario>';
    const chatMsgs = [
      { role: 'assistant', content: 'Hello there!' },
      { role: 'user', content: 'Alice: How are you?' },
      { role: 'assistant', content: 'I am fine, thank you!' },
    ];
    const { data } = parseChatData(makeRequest(system, chatMsgs));
    expect(data.hasSubstantialChat).toBe(true);
  });
});
