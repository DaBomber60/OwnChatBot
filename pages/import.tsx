import { useState, useEffect } from 'react';
import useSWR from 'swr';
import { useRouter } from 'next/router';
import Head from 'next/head';

const fetcher = (url: string) => fetch(url).then(res => res.json());

type Persona = { id: number; name: string; profileName?: string };
type Character = { id: number; name: string; profileName?: string; firstMessage?: string };
type CharacterGroup = { id: number; name: string; color: string; isCollapsed: boolean; sortOrder: number; characters: Character[]; };

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

  // Import execution state
  const [isImporting, setIsImporting] = useState(false);

  // Multiple import queue state
  const [isMultipleMode, setIsMultipleMode] = useState(false);
  const [importQueue, setImportQueue] = useState<QueuedImport[]>([]);
  const [isProcessingQueue, setIsProcessingQueue] = useState(false);
  const [currentProcessingIndex, setCurrentProcessingIndex] = useState<number | null>(null);

  const checkForImport = async () => {
    try {
      const response = await fetch('/api/import/check');
      const data = await response.json();
      
      if (data.logs && data.logs.length > 0) {
        setImportLogs(data.logs);
      }
      
      if (data.imported && data.data) {
        console.log('New import detected:', data.data);
        
        if (isMultipleMode) {
          // In multiple mode, add to queue and continue listening
          const queueItem: QueuedImport = {
            id: Date.now().toString(),
            data: data.data,
            timestamp: Date.now(),
            status: 'queued'
          };
          
          setImportQueue(prev => [...prev, queueItem]);
          setImportLogs(prev => [...prev, `Added import to queue: ${data.data.characterData?.name || 'Unknown'}`]);
        } else {
          // In single mode, show import options as before
          setImportedData(data.data);
          setIsPolling(false);
          
          // Initialize names from detected data
          if (data.data.detectedPersonaName) {
            setNewPersonaName(data.data.detectedPersonaName);
          }
          if (data.data.characterData?.name) {
            setNewCharacterName(data.data.characterData.name);
          }

          // Check for existing persona and character
          await checkExistingData(data.data);
          setShowImportOptions(true);
        }
        
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
  };

  const resetImport = () => {
    setImportLogs([]);
    setImportedData(null);
    setShowImportOptions(false);
    setImportError('');
    resetImportState();
    
    if (!isMultipleMode) {
      setIsPolling(true); // Resume polling if not in multiple mode
    }
  };

  const addToQueue = () => {
    if (!importedData) return;

    const queueItem: QueuedImport = {
      id: Date.now().toString(),
      data: importedData,
      timestamp: Date.now(),
      status: 'queued'
    };

    setImportQueue(prev => [...prev, queueItem]);
    resetImport(); // Clear current import and wait for next
  };

  const removeFromQueue = (id: string) => {
    setImportQueue(prev => prev.filter(item => item.id !== id));
  };

  const startProcessingQueue = async () => {
    if (importQueue.length === 0) return;

    // Stop listening when we start processing
    setIsPolling(false);
    setIsProcessingQueue(true);
    setCurrentProcessingIndex(0);
    
    // Initialize form state for first item
    const firstItem = importQueue[0];
    if (firstItem) {
      if (firstItem.data.detectedPersonaName) {
        setNewPersonaName(firstItem.data.detectedPersonaName);
      }
      if (firstItem.data.characterData?.name) {
        setNewCharacterName(firstItem.data.characterData.name);
      }
      // Reset import options for first item
      setImportOptions({
        persona: false,
        character: false,
        chat: false
      });
      setImportError(''); // Clear any previous errors
      
      // Check for existing persona and character for first item
      await checkExistingDataWithRefresh(firstItem.data);
    }
  };

  const processCurrentQueueItem = async (
    item: QueuedImport,
    options: ImportOptions,
    personaName: string,
    personaProfileName: string,
    characterName: string,
    characterProfileName: string
  ) => {
    // Update item status to processing
    setImportQueue(prev => prev.map(q => 
      q.id === item.id ? { 
        ...q, 
        status: 'processing',
        selectedOptions: options,
        personaName,
        personaProfileName,
        characterName,
        characterProfileName
      } : q
    ));

    try {
      let personaId: number | undefined;
      let characterId: number | undefined;

      // Handle persona import/creation
      if (options.persona) {
        if (!personaName.trim()) {
          throw new Error('Persona name is required');
        }

        // First check if we already created this persona in a previous queue item
        const previousPersona = importQueue.find(q => 
          q.status === 'completed' && 
          q.selectedOptions?.persona && 
          q.personaName?.toLowerCase() === personaName.trim().toLowerCase()
        );

        if (previousPersona) {
          // Reuse the persona from a previous queue item
          // We need to fetch it from the database to get the ID
          const existingPersonas = await fetch('/api/personas').then(res => res.json());
          const foundPersona = existingPersonas.find((p: Persona) => 
            p.name.toLowerCase() === personaName.trim().toLowerCase()
          );
          
          if (foundPersona) {
            personaId = foundPersona.id;
          } else {
            throw new Error('Previously created persona not found in database');
          }
        } else {
          // Check existing personas from database
          if (!personas) {
            throw new Error('Personas data not loaded');
          }
          
          const existingPersona = personas.find(p => 
            p.name.toLowerCase() === personaName.trim().toLowerCase()
          );

          if (existingPersona) {
            personaId = existingPersona.id;
          } else {
            // Create new persona
            const personaResponse = await fetch('/api/personas', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: personaName.trim(),
                profileName: personaProfileName.trim() || undefined,
                profile: item.data.userPersona || `Imported persona: ${personaName}`
              })
            });

            if (!personaResponse.ok) {
              const error = await personaResponse.json();
              throw new Error(`Failed to create persona: ${error.error}`);
            }

            const newPersona = await personaResponse.json();
            personaId = newPersona.id;
          }
        }
      }

  // Handle character import/creation
      if (options.character) {
        if (!characterName.trim()) {
          throw new Error('Character name is required');
        }

        // First check if we already created this character in a previous queue item
        // We'll match on first message since that's unique
        const previousCharacter = importQueue.find(q => 
          q.status === 'completed' && 
          q.selectedOptions?.character && 
          q.data.characterData.firstMessage === item.data.characterData.firstMessage
        );

        if (previousCharacter) {
          // Reuse the character from a previous queue item
          // We need to fetch it from the database to get the ID
          const existingCharacters = await fetch('/api/characters').then(res => res.json());
          const foundCharacter = existingCharacters.find((c: Character) => 
            c.firstMessage === item.data.characterData.firstMessage
          );
          
          if (foundCharacter) {
            characterId = foundCharacter.id;
          } else {
            throw new Error('Previously created character not found in database');
          }
        } else {
          // Check existing characters from database
          if (!chars) {
            throw new Error('Characters data not loaded');
          }
          
          const existingCharacter = chars.find(c => 
            c.firstMessage === item.data.characterData.firstMessage
          );

          if (existingCharacter) {
            characterId = existingCharacter.id;
          } else {
            // Prepare group selection (mirror single import logic)
            let groupIdToUse = selectedGroupId;
            if (isCreatingNewGroup && newGroupName.trim()) {
              try {
                groupIdToUse = await createGroup(newGroupName, newGroupColor);
              } catch (err) {
                throw new Error(`Failed to create group: ${err instanceof Error ? err.message : 'Unknown error'}`);
              }
            }

            const characterPayload: any = {
              name: characterName.trim(),
              profileName: characterProfileName.trim() || undefined,
              personality: item.data.characterData.personality,
              scenario: item.data.characterData.scenario,
              exampleDialogue: item.data.characterData.exampleDialogue,
              firstMessage: item.data.characterData.firstMessage
            };
            if (groupIdToUse != null) characterPayload.groupId = groupIdToUse;

            const characterResponse = await fetch('/api/characters', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(characterPayload)
            });

            if (!characterResponse.ok) {
              const error = await characterResponse.json();
              throw new Error(`Failed to create character: ${error.error}`);
            }

            const newCharacter = await characterResponse.json();
            characterId = newCharacter.id;
          }
        }
      }

      // Handle chat import
      if (options.chat) {
        // For chat import, we need both persona and character IDs
        // If user didn't select persona/character creation, try to find existing ones
        if (!personaId) {
          // Look for previously created persona in queue
          const previousPersonaItem = importQueue.find(q => 
            q.status === 'completed' && 
            q.selectedOptions?.persona && 
            q.data.userPersona === item.data.userPersona
          );

          if (previousPersonaItem && previousPersonaItem.personaName) {
            // Find the persona in database using fresh data
            try {
              const freshPersonas = await fetch('/api/personas').then(res => res.json());
              const foundPersona = freshPersonas.find((p: Persona) => 
                p.name.toLowerCase() === previousPersonaItem.personaName!.toLowerCase()
              );
              if (foundPersona) {
                personaId = foundPersona.id;
              }
            } catch (error) {
              console.error('Error fetching fresh personas for chat import:', error);
              // Fallback to cached data
              if (personas) {
                const foundPersona = personas.find(p => 
                  p.name.toLowerCase() === previousPersonaItem.personaName!.toLowerCase()
                );
                if (foundPersona) {
                  personaId = foundPersona.id;
                }
              }
            }
          }

          // If still no persona ID, check existing personas based on detected name using fresh data
          if (!personaId && item.data.detectedPersonaName) {
            try {
              const freshPersonas = await fetch('/api/personas').then(res => res.json());
              const existingPersona = freshPersonas.find((p: Persona) => 
                p.name.toLowerCase() === item.data.detectedPersonaName!.toLowerCase()
              );
              if (existingPersona) {
                personaId = existingPersona.id;
              }
            } catch (error) {
              console.error('Error fetching fresh personas for existing check:', error);
              // Fallback to cached data
              if (personas) {
                const existingPersona = personas.find(p => 
                  p.name.toLowerCase() === item.data.detectedPersonaName!.toLowerCase()
                );
                if (existingPersona) {
                  personaId = existingPersona.id;
                }
              }
            }
          }
        }

        if (!characterId) {
          // Look for previously created character in queue
          const previousCharacterItem = importQueue.find(q => 
            q.status === 'completed' && 
            q.selectedOptions?.character && 
            q.data.characterData.firstMessage === item.data.characterData.firstMessage
          );

          if (previousCharacterItem) {
            // Find the character in database using fresh data
            try {
              const freshCharacters = await fetch('/api/characters').then(res => res.json());
              const foundCharacter = freshCharacters.find((c: Character) => 
                c.firstMessage === item.data.characterData.firstMessage
              );
              if (foundCharacter) {
                characterId = foundCharacter.id;
              }
            } catch (error) {
              console.error('Error fetching fresh characters for chat import:', error);
              // Fallback to cached data
              if (chars) {
                const foundCharacter = chars.find(c => 
                  c.firstMessage === item.data.characterData.firstMessage
                );
                if (foundCharacter) {
                  characterId = foundCharacter.id;
                }
              }
            }
          }

          // If still no character ID, check existing characters using fresh data
          if (!characterId) {
            try {
              const freshCharacters = await fetch('/api/characters').then(res => res.json());
              const existingCharacter = freshCharacters.find((c: Character) => 
                c.firstMessage === item.data.characterData.firstMessage
              );
              if (existingCharacter) {
                characterId = existingCharacter.id;
              }
            } catch (error) {
              console.error('Error fetching fresh characters for existing check:', error);
              // Fallback to cached data
              if (chars) {
                const existingCharacter = chars.find(c => 
                  c.firstMessage === item.data.characterData.firstMessage
                );
                if (existingCharacter) {
                  characterId = existingCharacter.id;
                }
              }
            }
          }
        }

        if (!personaId || !characterId || !item.data.chatMessages) {
          throw new Error('Chat import requires both persona and character, plus chat messages');
        }

        const chatResponse = await fetch('/api/import/create-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            personaId,
            characterId,
            chatMessages: item.data.chatMessages,
            summary: item.data.summary
          })
        });

        if (!chatResponse.ok) {
          const error = await chatResponse.json();
          throw new Error(`Failed to create chat: ${error.error}`);
        }
      }

      // Update item status to completed
      setImportQueue(prev => prev.map(q => 
        q.id === item.id ? { ...q, status: 'completed' } : q
      ));

    } catch (error) {
      console.error('Error processing queue item:', error);
      
      // Update item status to failed
      setImportQueue(prev => prev.map(q => 
        q.id === item.id ? { ...q, status: 'failed', error: error instanceof Error ? error.message : 'Unknown error' } : q
      ));
    }
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

        const characterPayload: any = {
          name: newCharacterName.trim(),
          profileName: newCharacterProfileName.trim() || undefined,
          personality: importedData.characterData.personality,
          scenario: importedData.characterData.scenario,
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

      // If no chat import, redirect to home or show success
      resetImport();
      router.push('/');

    } catch (error) {
      console.error('Import error:', error);
      setImportError('An unexpected error occurred during import');
      setIsImporting(false);
    }
  };

  // Polling effect - only listen when in multiple mode OR when not processing queue
  useEffect(() => {
    let intervalId: NodeJS.Timeout | null = null;
    
    if (isPolling && (!isMultipleMode || !isProcessingQueue)) {
      intervalId = setInterval(async () => {
        await checkForImport();
      }, 1000);
    }
    
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isPolling, personas, chars, isMultipleMode, isProcessingQueue]);

  const isPersonaCheckboxDisabled = () => existingPersona !== null;
  const isCharacterCheckboxDisabled = () => existingCharacter !== null;
  const isChatAvailable = () => importedData?.chatMessages && importedData.chatMessages.length > 0;

  if (!personas || !chars || !groups) {
    return (
      <div className="container text-center">
        <div className="card">
          <div className="status-indicator">
            <div className="status-dot status-loading"></div>
            Loading...
          </div>
        </div>
      </div>
    );
  }

  // Check if we're currently processing queue
  const isShowingQueueProcessing = isProcessingQueue && currentProcessingIndex !== null && currentProcessingIndex < importQueue.length;
  const currentQueueItem = isShowingQueueProcessing ? importQueue[currentProcessingIndex!] : null;

  return (
    <div className="container">
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

        {isShowingQueueProcessing && currentQueueItem ? (
          // Queue Processing UI - Configure options for current item
          <>
            <div className="bg-info rounded-lg p-4 mb-4">
              <h4 className="font-semibold mb-2">Processing Queue Item {(currentProcessingIndex || 0) + 1} of {importQueue.length}</h4>
              <p className="text-sm">
                Configure import options for: {currentQueueItem.data.characterData?.name || 'Unknown Item'}
              </p>
            </div>

            <div className="space-y-6">
              {/* Import Options for current queue item */}
              <div className="space-y-4">
                <h4 className="font-semibold">Select Import Options:</h4>
                
                {/* Persona Option */}
                {currentQueueItem.data.userPersona && (
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
                            {currentQueueItem.data.userPersona.substring(0, 200)}
                            {currentQueueItem.data.userPersona.length > 200 ? '...' : ''}
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
                                    onClick={() => {
                                      if (newGroupName.trim()) {
                                        // Group will be created during import
                                        setIsCreatingNewGroup(false);
                                      }
                                    }}
                                  >
                                    Create
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-secondary btn-small"
                                    onClick={() => {
                                      setIsCreatingNewGroup(false);
                                      setNewGroupName('');
                                      setNewGroupColor('#6366f1');
                                    }}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                      
                        <div className="bg-secondary rounded p-3">
                          <h6 className="text-xs font-medium text-accent mb-2">Character Preview:</h6>
                          <div className="text-xs text-secondary space-y-1">
                            <p><strong>Personality:</strong> {currentQueueItem.data.characterData.personality.substring(0, 100)}...</p>
                            <p><strong>First Message:</strong> {currentQueueItem.data.characterData.firstMessage.substring(0, 100)}...</p>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>                {/* Chat Option */}
                {currentQueueItem.data.chatMessages && currentQueueItem.data.chatMessages.length > 0 && (
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
                        <p><strong>Chat Messages:</strong> {currentQueueItem.data.chatMessages.length} messages</p>
                        {currentQueueItem.data.summary && (
                          <p><strong>Summary:</strong> {currentQueueItem.data.summary.substring(0, 100)}...</p>
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
                  onClick={async () => {
                    // Process current item with selected options
                    setImportError('');
                    
                    try {
                      await processCurrentQueueItem(
                        currentQueueItem,
                        importOptions,
                        newPersonaName,
                        newPersonaProfileName,
                        newCharacterName,
                        newCharacterProfileName
                      );
                      
                      // Move to next item or finish
                      const nextIndex = (currentProcessingIndex || 0) + 1;
                      if (nextIndex >= importQueue.length) {
                        // Done processing
                        setIsProcessingQueue(false);
                        setCurrentProcessingIndex(null);
                        setIsPolling(true); // Resume listening
                        resetImportState(); // Clear form state
                      } else {
                        setCurrentProcessingIndex(nextIndex);
                        // Initialize form for next item
                        const nextItem = importQueue[nextIndex];
                        if (nextItem && nextItem.data.detectedPersonaName) {
                          setNewPersonaName(nextItem.data.detectedPersonaName);
                        }
                        if (nextItem && nextItem.data.characterData?.name) {
                          setNewCharacterName(nextItem.data.characterData.name);
                        }
                        // Reset import options for next item
                        setImportOptions({
                          persona: false,
                          character: false,
                          chat: false
                        });
                        
                        // Check for existing persona and character for next item
                        // First refresh data from database to include any recently created entities
                        if (nextItem) {
                          await checkExistingDataWithRefresh(nextItem.data);
                        }
                      }
                    } catch (error) {
                      setImportError(error instanceof Error ? error.message : 'Unknown error occurred');
                    }
                  }}
                  disabled={!importOptions.persona && !importOptions.character && !importOptions.chat}
                >
                  Process & Next
                </button>
                <button 
                  className="btn btn-secondary" 
                  onClick={async () => {
                    // Skip current item
                    const nextIndex = (currentProcessingIndex || 0) + 1;
                    if (nextIndex >= importQueue.length) {
                      setIsProcessingQueue(false);
                      setCurrentProcessingIndex(null);
                      setIsPolling(true);
                      resetImportState();
                    } else {
                      setCurrentProcessingIndex(nextIndex);
                      // Initialize form for next item
                      const nextItem = importQueue[nextIndex];
                      if (nextItem && nextItem.data.detectedPersonaName) {
                        setNewPersonaName(nextItem.data.detectedPersonaName);
                      }
                      if (nextItem && nextItem.data.characterData?.name) {
                        setNewCharacterName(nextItem.data.characterData.name);
                      }
                      setImportOptions({
                        persona: false,
                        character: false,
                        chat: false
                      });
                      
                      // Check for existing persona and character for next item
                      // First refresh data from database to include any recently created entities
                      if (nextItem) {
                        await checkExistingDataWithRefresh(nextItem.data);
                      }
                    }
                  }}
                >
                  Skip This Item
                </button>
                <button 
                  className="btn btn-secondary" 
                  onClick={() => {
                    // Cancel queue processing
                    setIsProcessingQueue(false);
                    setCurrentProcessingIndex(null);
                    setIsPolling(true);
                    resetImportState();
                  }}
                >
                  Cancel Queue Processing
                </button>
              </div>
            </div>
          </>
        ) : !showImportOptions ? (
          <>
            <div className="space-y-4">
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
                      <p className="text-sm text-muted">
                        {isMultipleMode ? 'Multiple import mode - queue items for batch processing' : 'Ready to receive data from external tools'}
                      </p>
                    </div>
                  </div>
                  <div>
                    <button
                      className={`btn btn-small ${isMultipleMode ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => {
                        const newMultipleMode = !isMultipleMode;
                        setIsMultipleMode(newMultipleMode);
                        
                        if (newMultipleMode) {
                          // Entering multiple mode - start listening if not already
                          if (!isPolling) {
                            setIsPolling(true);
                          }
                        } else {
                          // Exiting multiple mode - clear queue and reset to single mode
                          setImportQueue([]);
                          setIsProcessingQueue(false);
                          setCurrentProcessingIndex(null);
                          if (!showImportOptions && !isPolling) {
                            setIsPolling(true);
                          }
                        }
                      }}
                      title={isMultipleMode ? 'Exit multiple import mode' : 'Enable multiple import mode'}
                    >
                      {isMultipleMode ? '📦 Multiple Mode' : '📦 Enable Multiple'}
                    </button>
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

              {/* Queue Display */}
              {isMultipleMode && importQueue.length > 0 && (
                <div className="bg-secondary rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-semibold">Import Queue ({importQueue.length} items)</h4>
                    <div className="flex gap-2">
                      {!isProcessingQueue && (
                        <button
                          className="btn btn-primary btn-small"
                          onClick={startProcessingQueue}
                          disabled={importQueue.filter(i => i.status === 'queued').length === 0}
                        >
                          Start Processing ({importQueue.filter(i => i.status === 'queued').length} items)
                        </button>
                      )}
                      <button
                        className="btn btn-secondary btn-small"
                        onClick={() => setImportQueue([])}
                        disabled={isProcessingQueue}
                      >
                        Clear All
                      </button>
                    </div>
                  </div>
                  
                  <div className="space-y-3 max-h-60 overflow-y-auto">
                    {importQueue.map((item) => (
                      <div key={item.id} className="card p-3">
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className={`inline-block w-2 h-2 rounded-full ${
                                item.status === 'queued' ? 'bg-yellow-500' :
                                item.status === 'processing' ? 'bg-blue-500' :
                                item.status === 'completed' ? 'bg-green-500' : 'bg-red-500'
                              }`}></span>
                              <span className="font-medium text-sm">
                                {new Date(item.timestamp).toLocaleTimeString()}
                              </span>
                              <span className="text-muted capitalize text-xs">{item.status}</span>
                            </div>
                            <div className="text-xs text-muted">
                              {item.data.characterData?.name && `🎭 ${item.data.characterData.name}`}
                              {item.data.userPersona && ` 👤 ${item.data.detectedPersonaName || 'Persona'}`}
                              {item.data.chatMessages && ` 💬 Chat (${item.data.chatMessages.length} msgs)`}
                            </div>
                            {item.error && (
                              <div className="text-xs text-error mt-1">Error: {item.error}</div>
                            )}
                          </div>
                          <button
                            className="btn btn-danger btn-small"
                            onClick={() => removeFromQueue(item.id)}
                            disabled={isProcessingQueue || item.status === 'processing'}
                            title="Remove from queue"
                          >
                            🗑️
                          </button>
                        </div>
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
                                    onClick={() => {
                                      if (newGroupName.trim()) {
                                        // Group will be created during import
                                        setIsCreatingNewGroup(false);
                                      }
                                    }}
                                  >
                                    Create
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-secondary btn-small"
                                    onClick={() => {
                                      setIsCreatingNewGroup(false);
                                      setNewGroupName('');
                                      setNewGroupColor('#6366f1');
                                    }}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                      
                      <div className="bg-secondary rounded p-3">
                        <h6 className="text-xs font-medium text-accent mb-2">Character Preview:</h6>
                        <div className="text-xs text-secondary space-y-1">
                          <p><strong>Personality:</strong> {importedData?.characterData.personality.substring(0, 100)}...</p>
                          <p><strong>First Message:</strong> {importedData?.characterData.firstMessage.substring(0, 100)}...</p>
                        </div>
                      </div>
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
                {isMultipleMode ? (
                  <>
                    <button 
                      className="btn btn-primary" 
                      onClick={addToQueue}
                      disabled={!importOptions.persona && !importOptions.character && !importOptions.chat}
                    >
                      ➕ Add to Queue
                    </button>
                    <button 
                      className="btn btn-secondary" 
                      onClick={resetImport}
                    >
                      Skip This Import
                    </button>
                  </>
                ) : (
                  <>
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
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
