import { useState, useEffect, useMemo } from 'react';
import useSWR, { mutate } from 'swr';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { fetcher } from '../lib/fetcher';
import type { Persona, Character, CharacterGroup } from '../types/models';

interface ImportedData {
  characterData: {
    name: string;
    personality: string;
    scenario: string;
    exampleDialogue: string;
    firstMessage: string;
  };
  userPersona?: string;
  detectedPersonaName?: string;
  chatMessages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  summary?: string;
  hasSubstantialChat?: boolean;
  scenarioWasMissing?: boolean;
  splitSuggestion?: { canSplit: boolean; newlineCount: number; rawCombined: string } | null;
}

interface ImportOptions {
  persona: boolean;
  character: boolean;
  chat: boolean;
}

interface QueuedImport {
  id: string;
  data: ImportedData;
  timestamp: number;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  error?: string;
  // These will be set during processing, not queuing
  selectedOptions?: ImportOptions;
  personaName?: string;
  personaProfileName?: string;
  characterName?: string;
  characterProfileName?: string;
}

export default function ImportPage() {
  const router = useRouter();
  const { data: personas } = useSWR<Persona[]>('/api/personas', fetcher);
  const { data: chars } = useSWR<Character[]>('/api/characters', fetcher);
  const { data: groups } = useSWR<CharacterGroup[]>('/api/character-groups', fetcher);
  const { data: settings } = useSWR<Record<string, string>>('/api/settings', fetcher);
  const { data: importTokenData } = useSWR<{ token: string; version: number }>(!settings ? null : '/api/import/token', fetcher);

  // Get devMode from settings
  const devMode = settings?.devMode === 'true';

  // Import detection state
  const [isPolling, setIsPolling] = useState(true); // Always start polling when page loads
  const [importLogs, setImportLogs] = useState<string[]>([]);
  const [importedData, setImportedData] = useState<ImportedData | null>(null);
  const [importError, setImportError] = useState('');

  // Import selection state
  const [showImportOptions, setShowImportOptions] = useState(false);
  const [importOptions, setImportOptions] = useState<ImportOptions>({
    persona: false,
    character: false,
    chat: false
  });

  // Persona state
  const [newPersonaName, setNewPersonaName] = useState('');
  const [newPersonaProfileName, setNewPersonaProfileName] = useState('');
  const [existingPersona, setExistingPersona] = useState<Persona | null>(null);

  // Character state
  const [newCharacterName, setNewCharacterName] = useState('');
  const [newCharacterProfileName, setNewCharacterProfileName] = useState('');
  const [existingCharacter, setExistingCharacter] = useState<Character | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [isCreatingNewGroup, setIsCreatingNewGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupColor, setNewGroupColor] = useState('#6366f1');
  const [isCreatingGroupNow, setIsCreatingGroupNow] = useState(false);
  const [groupCreateError, setGroupCreateError] = useState('');
  const [enableSplit, setEnableSplit] = useState(false);
  const [selectedSplitIndex, setSelectedSplitIndex] = useState<number | null>(null);
  const [splitText, setSplitText] = useState('');
  const [splitPersonalityFirst, setSplitPersonalityFirst] = useState(true);

  const splitLines = useMemo(() => splitText.split('\n'), [splitText]);
  const paragraphBlocks = useMemo(() => {
    const blocks: Array<{ text: string; startIndex: number; endIndex: number; blankCountAfter: number }> = [];
    const isBlankLine = (idx: number) => ((splitLines[idx] ?? '').trim().length === 0);

    let index = 0;
    while (index < splitLines.length) {
      while (index < splitLines.length && isBlankLine(index)) {
        index++;
      }

      if (index >= splitLines.length) {
        break;
      }

      const start = index;
      while (index < splitLines.length && !isBlankLine(index)) {
        index++;
      }
      const end = index - 1;

      let blankCursor = index;
      while (blankCursor < splitLines.length && isBlankLine(blankCursor)) {
        blankCursor++;
      }
      const blankCount = blankCursor - index;

      blocks.push({
        text: splitLines.slice(start, end + 1).join('\n'),
        startIndex: start,
        endIndex: end,
        blankCountAfter: blankCount
      });

      index = blankCursor;
    }

    return blocks;
  }, [splitLines]);

  const availableSplitIndices = useMemo(() => {
    return paragraphBlocks.slice(0, -1).map(block => block.endIndex + 1);
  }, [paragraphBlocks]);

  const splitSegments = useMemo(() => {
    if (!enableSplit || selectedSplitIndex === null) {
      return null;
    }
    if (!availableSplitIndices.includes(selectedSplitIndex)) {
      return null;
    }

    const topPart = splitLines.slice(0, selectedSplitIndex).join('\n').trim();
    const bottomPart = splitLines.slice(selectedSplitIndex).join('\n').trim();

    return splitPersonalityFirst
      ? { personality: topPart, scenario: bottomPart }
      : { personality: bottomPart, scenario: topPart };
  }, [enableSplit, selectedSplitIndex, availableSplitIndices, splitLines, splitPersonalityFirst]);

  // Import execution state
  const [isImporting, setIsImporting] = useState(false);

  // Recent success banner state (for non-chat imports that stay on page)
  const [recentImportSuccess, setRecentImportSuccess] = useState<null | {
    persona?: { name: string; existing: boolean };
    character?: { name: string; existing: boolean };
  }>(null);
  const [showSuccess, setShowSuccess] = useState(false);

  // Multi-import queue removed – single import mode only

  const checkForImport = async () => {
    try {
      const response = await fetch('/api/import/check');
      const data = await response.json();
      
      if (data.logs && data.logs.length > 0) {
        setImportLogs(data.logs);
      }
      
      if (data.imported && data.data) {
        console.log('New import detected:', data.data);
        // Clear any prior success banner when a new import arrives
        if (recentImportSuccess) {
          setRecentImportSuccess(null);
          setShowSuccess(false);
        }
        setImportedData(data.data);
        setIsPolling(false);
        if (data.data.detectedPersonaName) setNewPersonaName(data.data.detectedPersonaName);
        if (data.data.characterData?.name) setNewCharacterName(data.data.characterData.name);
        await checkExistingData(data.data);
        setShowImportOptions(true);
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('Error checking for import:', error);
      return false;
    }
  };

  const checkExistingData = async (data: ImportedData) => {
    if (!personas || !chars) return;

    // Check for existing persona
    if (data.userPersona && data.detectedPersonaName) {
      const existing = personas.find(p => 
        p.name.toLowerCase() === data.detectedPersonaName!.toLowerCase()
      );
      if (existing) {
        setExistingPersona(existing);
      }
    }

    // Check for existing character based on first message
    if (data.characterData?.firstMessage) {
      const existing = chars.find(c => 
        c.firstMessage === data.characterData.firstMessage
      );
      if (existing) {
        setExistingCharacter(existing);
      }
    }
  };

  const checkExistingDataWithRefresh = async (data: ImportedData) => {
    // Reset existing selections first
    setExistingPersona(null);
    setExistingCharacter(null);
    
    try {
      // Fetch fresh data from database
      const [freshPersonas, freshCharacters] = await Promise.all([
        fetch('/api/personas').then(res => res.json()),
        fetch('/api/characters').then(res => res.json())
      ]);

      // Check for existing persona with fresh data
      if (data.userPersona && data.detectedPersonaName) {
        const existing = freshPersonas.find((p: Persona) => 
          p.name.toLowerCase() === data.detectedPersonaName!.toLowerCase()
        );
        if (existing) {
          setExistingPersona(existing);
        }
      }

      // Check for existing character based on first message with fresh data
      if (data.characterData?.firstMessage) {
        const existing = freshCharacters.find((c: Character) => 
          c.firstMessage === data.characterData.firstMessage
        );
        if (existing) {
          setExistingCharacter(existing);
        }
      }
    } catch (error) {
      console.error('Error fetching fresh data for existence check:', error);
      // Fallback to cached data if fresh fetch fails
      await checkExistingData(data);
    }
  };

  const resetImportState = () => {
    setImportOptions({
      persona: false,
      character: false,
      chat: false
    });
    setNewPersonaName('');
    setNewPersonaProfileName('');
    setNewCharacterName('');
    setNewCharacterProfileName('');
    setExistingPersona(null);
    setExistingCharacter(null);
    setSelectedGroupId(null);
    setIsCreatingNewGroup(false);
    setNewGroupName('');
    setNewGroupColor('#6366f1');
    setIsImporting(false);
    setEnableSplit(false);
    setSelectedSplitIndex(null);
    setSplitText('');
    setSplitPersonalityFirst(true);
  };

  const resetImport = () => {
    setImportLogs([]);
    setImportedData(null);
    setShowImportOptions(false);
    setImportError('');
    resetImportState();
    setIsPolling(true); // Always resume polling after reset
  };

  // Update import options based on dependencies
  const updateImportOptions = (option: keyof ImportOptions, value: boolean) => {
    const newOptions = { ...importOptions, [option]: value };

    // If chat is selected, enforce dependencies
    if (option === 'chat' && value) {
      if (!existingPersona && !newOptions.persona) {
        newOptions.persona = true;
      }
      if (!existingCharacter && !newOptions.character) {
        newOptions.character = true;
      }
    }

    // If chat is deselected, allow persona/character to remain selected
    if (option === 'chat' && !value) {
      // No changes needed - persona and character can remain independent
    }

    setImportOptions(newOptions);
  };

  async function createGroup(name: string, color: string): Promise<number> {
    const response = await fetch('/api/character-groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), color })
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`Failed to create group: ${err.error || 'Unknown error'}`);
    }
    const newGroup = await response.json();
    return newGroup.id;
  }

  const handleImport = async () => {
    if (!importedData) {
      setImportError('No data to import');
      return;
    }

    setIsImporting(true);
    setImportError('');

    try {
      let personaId: number | undefined;
      let characterId: number | undefined;

      // Handle persona import/creation
      if (importOptions.persona) {
        if (!newPersonaName.trim()) {
          setImportError('Persona name is required');
          setIsImporting(false);
          return;
        }

        const personaResponse = await fetch('/api/personas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: newPersonaName.trim(),
            profileName: newPersonaProfileName.trim() || undefined,
            profile: importedData.userPersona || `Imported persona: ${newPersonaName}`
          })
        });

        if (!personaResponse.ok) {
          const error = await personaResponse.json();
          setImportError(`Failed to create persona: ${error.error}`);
          setIsImporting(false);
          return;
        }

        const newPersona = await personaResponse.json();
        personaId = newPersona.id;
      } else if (existingPersona) {
        personaId = existingPersona.id;
      }

      // Handle character import/creation
      if (importOptions.character) {
        if (!newCharacterName.trim()) {
          setImportError('Character name is required');
          setIsImporting(false);
          return;
        }

        let groupIdToUse = selectedGroupId;

        // Create new group if needed
        if (isCreatingNewGroup && newGroupName.trim()) {
          try {
            groupIdToUse = await createGroup(newGroupName, newGroupColor);
          } catch (error) {
            setImportError(`Failed to create group: ${error instanceof Error ? error.message : 'Unknown error'}`);
            setIsImporting(false);
            return;
          }
        }

        let effectivePersonality = importedData.characterData.personality;
        let effectiveScenario = importedData.characterData.scenario;
        if (splitSegments) {
          effectivePersonality = splitSegments.personality;
          effectiveScenario = splitSegments.scenario;
        }

        const characterPayload: any = {
          name: newCharacterName.trim(),
          profileName: newCharacterProfileName.trim() || undefined,
          personality: effectivePersonality,
          scenario: effectiveScenario,
          exampleDialogue: importedData.characterData.exampleDialogue,
          firstMessage: importedData.characterData.firstMessage
        };
        if (groupIdToUse != null) characterPayload.groupId = groupIdToUse;

        const characterResponse = await fetch('/api/characters', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(characterPayload)
        });

        if (!characterResponse.ok) {
          const error = await characterResponse.json();
          setImportError(`Failed to create character: ${error.error}`);
          setIsImporting(false);
          return;
        }

        const newCharacter = await characterResponse.json();
        characterId = newCharacter.id;
      } else if (existingCharacter) {
        characterId = existingCharacter.id;
      }

      // Handle chat import
      if (importOptions.chat) {
        if (!personaId || !characterId || !importedData.chatMessages) {
          setImportError('Chat import requires both persona and character, plus chat messages');
          setIsImporting(false);
          return;
        }

        const chatResponse = await fetch('/api/import/create-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            personaId,
            characterId,
            chatMessages: importedData.chatMessages,
            summary: importedData.summary
          })
        });

        if (!chatResponse.ok) {
          const error = await chatResponse.json();
          setImportError(`Failed to create chat: ${error.error}`);
          setIsImporting(false);
          return;
        }

        const chatData = await chatResponse.json();
        
        // Redirect to the new chat
        router.push(`/chat/${chatData.sessionId}`);
        return;
      }

  // If no chat import, stay on importer page and resume listening
  // Record success details for banner before resetting
  setRecentImportSuccess({
    persona: personaId ? { name: (importOptions.persona ? newPersonaName.trim() : (existingPersona?.name || newPersonaName.trim())), existing: !importOptions.persona } : undefined,
    character: characterId ? { name: (importOptions.character ? newCharacterName.trim() : (existingCharacter?.name || newCharacterName.trim())), existing: !importOptions.character } : undefined
  });
  setShowSuccess(true);
  resetImport();
  // (No navigation) — user can immediately import the next item

    } catch (error) {
      console.error('Import error:', error);
      setImportError('An unexpected error occurred during import');
      setIsImporting(false);
    }
  };

  // Auto-hide success banner after a delay
  useEffect(() => {
    if (showSuccess) {
      const t = setTimeout(() => setShowSuccess(false), 6000);
      return () => clearTimeout(t);
    }
  }, [showSuccess]);

  useEffect(() => {
    if (!importedData) {
      setSplitText('');
      setSelectedSplitIndex(null);
      setEnableSplit(false);
      setSplitPersonalityFirst(true);
      return;
    }
    if (importedData.splitSuggestion?.rawCombined) {
      setSplitText(importedData.splitSuggestion.rawCombined);
    } else if (importedData.characterData?.personality) {
      setSplitText(importedData.characterData.personality);
    } else {
      setSplitText('');
    }
    setSelectedSplitIndex(null);
    setEnableSplit(false);
    setSplitPersonalityFirst(true);
  }, [importedData?.splitSuggestion?.rawCombined, importedData?.characterData?.personality, importedData]);

  useEffect(() => {
    if (selectedSplitIndex !== null && !availableSplitIndices.includes(selectedSplitIndex)) {
      setSelectedSplitIndex(null);
    }
  }, [availableSplitIndices, selectedSplitIndex]);

  // Polling effect - always listen while polling flag true
  useEffect(() => {
    let intervalId: NodeJS.Timeout | null = null;
    if (isPolling) {
      intervalId = setInterval(async () => {
        await checkForImport();
      }, 1000);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isPolling, personas, chars]);

  const isPersonaCheckboxDisabled = () => existingPersona !== null;
  const isCharacterCheckboxDisabled = () => existingCharacter !== null;
  const isChatAvailable = () => importedData?.chatMessages && importedData.chatMessages.length > 0;

  if (!personas || !chars || !groups) {
    return (
      <div className="text-center">
        <div className="card">
          <div className="status-indicator">
            <div className="status-dot status-loading"></div>
            Loading...
          </div>
        </div>
      </div>
    );
  }

  // Queue processing removed

  return (
    <>
      <Head>
        <title>Import - OwnChatBot</title>
        <meta name="description" content="Import characters, personas, and chats from external tools" />
      </Head>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-semibold mb-0">Import Data</h1>
        <button className="btn btn-secondary" onClick={() => router.push('/')}>
          🏠 Home
        </button>
      </div>

      <div className="card">
        <div className="card-header">
          <h3 className="card-title">Import from External Tools</h3>
          <p className="card-description">
            Import characters, personas, and chats from external tools!
          </p>
        </div>

        {!showImportOptions ? (
          <>
            <div className="space-y-4">
              {showSuccess && recentImportSuccess && (
                <div className="bg-success rounded-lg p-4 flex gap-3 items-start shadow-sm border border-gray-300">
                  <div className="text-2xl">✅</div>
                  <div className="flex-1">
                    <h4 className="font-semibold mb-1">Import Completed</h4>
                    <ul className="text-sm list-disc pl-5 space-y-1">
                      {recentImportSuccess.persona && (
                        <li>
                          Persona: {recentImportSuccess.persona.name}{' '}
                          {recentImportSuccess.persona.existing && <span className="text-xs text-gray-600">(existing)</span>}
                        </li>
                      )}
                      {recentImportSuccess.character && (
                        <li>
                          Character: {recentImportSuccess.character.name}{' '}
                          {recentImportSuccess.character.existing && <span className="text-xs text-gray-600">(existing)</span>}
                        </li>
                      )}
                    </ul>
                    <p className="text-xs text-gray-600 mt-2">You can start another import by triggering it from the external tool.</p>
                  </div>
                  <button
                    className="btn btn-ghost btn-small"
                    onClick={() => setShowSuccess(false)}
                    aria-label="Dismiss success banner"
                  >
                    ✕
                  </button>
                </div>
              )}
              <div className="bg-info rounded-lg p-4">
                <h4 className="font-semibold mb-2">Setup Instructions:</h4>
                <ol className="text-sm space-y-1 mb-4">
                  <li>1. Set your custom prompt to: <code>&lt;ownchatbot_importer&gt;</code></li>
                  <li>2. Make your API request from the external tool to the URL below</li>
                  <li>3. Select what you want to import from the detected data</li>
                </ol>
                
                <div className="space-y-3">
                  <div>
                    <label className="form-label text-sm">Import Marker (copy this and paste it into the &apos;Custom Prompt&apos; section):</label>
                    <div className="flex items-center gap-2">
                      <input 
                        type="text" 
                        className="form-input flex-1 text-sm font-mono" 
                        value="<ownchatbot_importer>" 
                        readOnly 
                      />
                      <button 
                        className="btn btn-secondary btn-small"
                        onClick={() => navigator.clipboard.writeText('<ownchatbot_importer>')}
                        title="Copy to clipboard"
                      >
                        📋 Copy
                      </button>
                    </div>
                  </div>
                  
                  <div>
                    <label className="form-label text-sm">API Endpoint URL (for external tools):</label>
                    <div className="flex items-center gap-2">
                      <input 
                        type="text" 
                        className="form-input flex-1 text-sm font-mono" 
                        value={`${typeof window !== 'undefined' ? window.location.origin : ''}/api/import/receive`}
                        readOnly 
                      />
                      <button 
                        className="btn btn-secondary btn-small"
                        onClick={() => navigator.clipboard.writeText(`${window.location.origin}/api/import/receive`)}
                        title="Copy URL to clipboard"
                      >
                        📋 Copy
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="form-label text-sm">API Key</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="password"
                        className="form-input flex-1 text-sm font-mono"
                        value={importTokenData?.token || 'Loading token...'}
                        readOnly
                      />
                      <button
                        className="btn btn-secondary btn-small"
                        onClick={() => importTokenData?.token && navigator.clipboard.writeText(importTokenData.token)}
                        disabled={!importTokenData?.token}
                        title="Copy API key to clipboard"
                      >
                        📋 Copy
                      </button>
                    </div>
                    <p className="text-xs text-muted mt-1">Key rotates automatically when password changes (version {importTokenData?.version ?? '…'}).</p>
                  </div>
                </div>
              </div>

              {/* Always show listening status */}
              <div className="bg-success rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="status-indicator">
                      <div className="status-dot status-loading"></div>
                    </div>
                    <div>
                      <h4 className="font-semibold mb-1">🎧 Listening for Import Data</h4>
                      <p className="text-sm text-muted">Ready to receive data from external tools</p>
                    </div>
                  </div>
                </div>
              </div>
              
              {devMode && importLogs.length > 0 && (
                <div>
                  <h4 className="font-semibold mb-2">Import Status:</h4>
                  <div className="bg-secondary rounded-lg p-3 max-h-48 overflow-y-auto">
                    {importLogs.map((log, i) => (
                      <div key={i} className={`text-sm ${log.startsWith('ERROR:') ? 'text-error' : 'text-primary'}`}>
                        {log}
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>
          </>
        ) : (
          <>
            <div className="bg-success rounded-lg p-4 mb-4">
              <h4 className="font-semibold mb-2">✅ Data Received Successfully!</h4>
              <p className="text-sm">
                Found importable data. Select what you want to import below.
              </p>
            </div>

            <div className="space-y-6">
              {/* Import Options */}
              <div className="space-y-4">
                <h4 className="font-semibold">Select Import Options:</h4>
                
                {/* Persona Option */}
                {importedData?.userPersona && (
                  <div className="border border-primary rounded-lg p-4 transition-colors duration-150 hover:bg-gray-100 hover:bg-opacity-10 mb-4">
                    <label className="flex items-center gap-3 mb-3">
                      <input
                        type="checkbox"
                        checked={importOptions.persona && !isPersonaCheckboxDisabled()}
                        disabled={isPersonaCheckboxDisabled()}
                        onChange={(e) => updateImportOptions('persona', e.target.checked)}
                        className="scale-125"
                      />
                      <span className="font-medium">
                        {existingPersona ? '👤 Persona (Exists - Will Link)' : '👤 Import Persona'}
                      </span>
                    </label>
                    
                    {existingPersona ? (
                      <div className="bg-warning rounded p-3 text-sm">
                        <p><strong>Existing persona found:</strong> {existingPersona.name}</p>
                        <p>The chat will be linked to this existing persona.</p>
                      </div>
                    ) : importOptions.persona ? (
                      <div className="space-y-3">
                        <div className="form-group">
                          <label className="form-label text-sm">Persona Name *</label>
                          <input
                            type="text"
                            className="form-input"
                            value={newPersonaName}
                            onChange={e => setNewPersonaName(e.target.value)}
                            placeholder="Enter persona name"
                          />
                        </div>
                        
                        <div className="form-group">
                          <label className="form-label text-sm">Profile Name (Optional)</label>
                          <input
                            type="text"
                            className="form-input"
                            value={newPersonaProfileName}
                            onChange={e => setNewPersonaProfileName(e.target.value)}
                            placeholder="Enter profile name (optional)"
                          />
                        </div>
                        
                        <div className="bg-secondary rounded p-3">
                          <h6 className="text-xs font-medium text-accent mb-2">Imported Persona Data:</h6>
                          <p className="text-xs text-secondary">
                            {importedData.userPersona.substring(0, 200)}
                            {importedData.userPersona.length > 200 ? '...' : ''}
                          </p>
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}

                {/* Character Option */}
                <div className="border border-primary rounded-lg p-4 transition-colors duration-150 hover:bg-gray-100 hover:bg-opacity-10 mb-4">
                  <label className="flex items-center gap-3 mb-3">
                    <input
                      type="checkbox"
                      checked={importOptions.character && !isCharacterCheckboxDisabled()}
                      disabled={isCharacterCheckboxDisabled()}
                      onChange={(e) => updateImportOptions('character', e.target.checked)}
                      className="scale-125"
                    />
                    <span className="font-medium">
                      {existingCharacter ? '🎭 Character (Exists - Will Link)' : '🎭 Import Character'}
                    </span>
                  </label>
                  
                  {existingCharacter ? (
                    <div className="bg-warning rounded p-3 text-sm">
                      <p><strong>Existing character found:</strong> {existingCharacter.name}</p>
                      <p>The chat will be linked to this existing character.</p>
                    </div>
                  ) : importOptions.character ? (
                    <div className="space-y-3">
                      <div className="form-group">
                        <label className="form-label text-sm">Character Name *</label>
                        <input
                          type="text"
                          className="form-input"
                          value={newCharacterName}
                          onChange={e => setNewCharacterName(e.target.value)}
                          placeholder="Enter character name"
                        />
                      </div>
                      
                      <div className="form-group">
                        <label className="form-label text-sm">Profile Name (Optional)</label>
                        <input
                          type="text"
                          className="form-input"
                          value={newCharacterProfileName}
                          onChange={e => setNewCharacterProfileName(e.target.value)}
                          placeholder="Enter profile name (optional)"
                        />
                      </div>
                      
                      <div className="form-group">
                        <label className="form-label text-sm">Group (Optional)</label>
                        <div className="space-y-2">
                          <select 
                            className="form-input"
                            value={isCreatingNewGroup ? 'new' : (selectedGroupId || '')}
                            onChange={e => {
                              if (e.target.value === 'new') {
                                setIsCreatingNewGroup(true);
                                setSelectedGroupId(null);
                              } else {
                                setIsCreatingNewGroup(false);
                                setSelectedGroupId(e.target.value ? parseInt(e.target.value) : null);
                              }
                            }}
                          >
                            <option value="">No Group</option>
                            {groups?.map(group => (
                              <option key={group.id} value={group.id}>
                                {group.name}
                              </option>
                            ))}
                            <option value="new">+ Create New Group</option>
                          </select>
                          
                          {isCreatingNewGroup && (
                            <div className="border rounded-lg p-3 space-y-3" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-primary)' }}>
                              <div className="form-group mb-0">
                                <input
                                  type="text"
                                  className="form-input"
                                  value={newGroupName}
                                  onChange={e => setNewGroupName(e.target.value)}
                                  placeholder="Enter group name"
                                />
                              </div>
                              <div className="flex items-center justify-between">
                                <div className="form-group mb-0">
                                  <input 
                                    type="color"
                                    className="form-input"
                                    value={newGroupColor}
                                    onChange={e => setNewGroupColor(e.target.value)}
                                    style={{ width: '50px', height: '32px', padding: '2px' }}
                                  />
                                </div>
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    className="btn btn-primary btn-small"
                                    onClick={async () => {
                                      if (!newGroupName.trim() || isCreatingGroupNow) return;
                                      setGroupCreateError('');
                                      setIsCreatingGroupNow(true);
                                      try {
                                        const id = await createGroup(newGroupName, newGroupColor);
                                        // Optimistically update SWR cache
                                        mutate('/api/character-groups');
                                        setSelectedGroupId(id);
                                        setIsCreatingNewGroup(false);
                                      } catch (err) {
                                        setGroupCreateError(err instanceof Error ? err.message : 'Failed to create group');
                                      } finally {
                                        setIsCreatingGroupNow(false);
                                      }
                                    }}
                                    disabled={isCreatingGroupNow}
                                  >
                                    {isCreatingGroupNow ? 'Creating…' : 'Create'}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-secondary btn-small"
                                    onClick={() => {
                                      setIsCreatingNewGroup(false);
                                      setNewGroupName('');
                                      setNewGroupColor('#6366f1');
                                    }}
                                    disabled={isCreatingGroupNow}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                              {groupCreateError && (
                                <div className="text-xs text-error" role="alert">{groupCreateError}</div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      
                      <div className="bg-secondary rounded p-3">
                        <h6 className="text-xs font-medium text-accent mb-2">Character Preview:</h6>
                        <div className="text-xs text-secondary space-y-1">
                          <p><strong>Personality:</strong> {(() => {
                            const baseText = splitSegments
                              ? (splitSegments.personality || '(empty)')
                              : (importedData?.characterData.personality || '(empty)');
                            return baseText.substring(0, 100) + '...';
                          })()}</p>
                          <p><strong>Scenario:</strong> {(() => {
                            const baseText = splitSegments
                              ? (splitSegments.scenario || '(empty)')
                              : (importedData?.characterData.scenario || '(empty)');
                            return baseText.substring(0, 100) + '...';
                          })()}</p>
                          <p><strong>First Message:</strong> {importedData?.characterData.firstMessage.substring(0, 100)}...</p>
                        </div>
                      </div>
                      {(!existingCharacter && importedData?.scenarioWasMissing && importedData?.splitSuggestion?.canSplit && !importedData.characterData.scenario) && (
                        <div className="mt-3 border rounded p-3 space-y-3" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-primary)' }}>
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <input
                              type="checkbox"
                              checked={enableSplit}
                              onChange={() => {
                                const next = !enableSplit;
                                setEnableSplit(next);
                                if (!next) {
                                  setSelectedSplitIndex(null);
                                  setSplitPersonalityFirst(true);
                                }
                              }}
                            />
                            <span>Split personality & scenario?</span>
                          </div>
                          {enableSplit && (
                            <div className="space-y-3">
                              {paragraphBlocks.length > 1 ? (
                                <div className="split-stack max-h-96 overflow-y-auto">
                                  {paragraphBlocks.map((block, idx) => {
                                    const boundaryIndex = block.endIndex + 1;
                                    const isLast = idx === paragraphBlocks.length - 1;
                                    const isPersonalityTop = selectedSplitIndex === boundaryIndex && splitPersonalityFirst;
                                    const isScenarioTop = selectedSplitIndex === boundaryIndex && !splitPersonalityFirst;

                                    return (
                                      <div key={`${block.startIndex}-${block.endIndex}`} className="space-y-3">
                                        <div className="split-block">
                                          <div className="split-block__text">
                                            {block.text || <span className="italic text-muted">(blank paragraph)</span>}
                                          </div>
                                        </div>

                                        {!isLast && (
                                          <div
                                            className="split-divider"
                                            role="group"
                                            aria-label={`Split options between paragraph ${idx + 1} and ${idx + 2}`}
                                          >
                                            <div className="split-divider__line" aria-hidden="true" />
                                            {block.blankCountAfter > 1 && (
                                              <div className="split-divider__badge">
                                                <span aria-hidden="true">⋯</span>
                                                {block.blankCountAfter} blank lines collapsed
                                              </div>
                                            )}
                                            <div className="split-divider__buttons">
                                              <button
                                                type="button"
                                                className={`btn ${isPersonalityTop ? 'btn-primary' : 'btn-secondary'} split-pill`}
                                                onClick={() => {
                                                  setSelectedSplitIndex(boundaryIndex);
                                                  setSplitPersonalityFirst(true);
                                                }}
                                                aria-label={`Split after paragraph ${idx + 1} with personality first`}
                                              >
                                                <strong>Personality end</strong>
                                                <span>Scenario continues ↓</span>
                                              </button>
                                              <button
                                                type="button"
                                                className={`btn ${isScenarioTop ? 'btn-primary' : 'btn-secondary'} split-pill`}
                                                onClick={() => {
                                                  setSelectedSplitIndex(boundaryIndex);
                                                  setSplitPersonalityFirst(false);
                                                }}
                                                aria-label={`Split after paragraph ${idx + 1} with scenario first`}
                                              >
                                                <strong>Scenario end</strong>
                                                <span>Personality continues ↓</span>
                                              </button>
                                            </div>
                                            <div className="split-divider__line" aria-hidden="true" />
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : (
                                <p className="text-xs text-muted">Add a newline to provide a split option.</p>
                              )}
                              {selectedSplitIndex === null && paragraphBlocks.length > 1 && (
                                <p className="text-warning text-xs">Choose where to split and which portion should become the personality.</p>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>

                {/* Chat Option */}
                {isChatAvailable() && (
                  <div className="border border-primary rounded-lg p-4 transition-colors duration-150 hover:bg-gray-100 hover:bg-opacity-10 mb-4">
                    <label className="flex items-center gap-3 mb-3">
                      <input
                        type="checkbox"
                        checked={importOptions.chat}
                        onChange={(e) => updateImportOptions('chat', e.target.checked)}
                        className="scale-125"
                      />
                      <span className="font-medium">💬 Import Chat</span>
                    </label>
                    
                    {importOptions.chat && (
                      <div className="bg-info rounded p-3 text-sm">
                        <p><strong>Chat Messages:</strong> {importedData?.chatMessages?.length} messages</p>
                        {importedData?.summary && (
                          <p><strong>Summary:</strong> {importedData.summary.substring(0, 100)}...</p>
                        )}
                        
                        {(!existingPersona && !importOptions.persona) && (
                          <p className="text-warning mt-2">
                            ⚠️ Chat import requires a persona - persona import has been automatically enabled.
                          </p>
                        )}
                        
                        {(!existingCharacter && !importOptions.character) && (
                          <p className="text-warning mt-2">
                            ⚠️ Chat import requires a character - character import has been automatically enabled.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {importError && (
                <div className="bg-error rounded-lg p-3">
                  <p className="text-sm text-white">{importError}</p>
                </div>
              )}

              <div className="flex gap-3">
                <button 
                  className="btn btn-primary" 
                  onClick={handleImport}
                  disabled={isImporting || (!importOptions.persona && !importOptions.character && !importOptions.chat)}
                >
                  {isImporting ? 'Importing...' : 'Import Selected Items'}
                </button>
                <button 
                  className="btn btn-secondary" 
                  onClick={resetImport}
                  disabled={isImporting}
                >
                  Cancel
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
