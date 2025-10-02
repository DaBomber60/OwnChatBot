import { parseChatData } from '../pages/api/import/receive';

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
