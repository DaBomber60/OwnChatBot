import { useState, useEffect, useRef, useReducer, useMemo } from 'react';
import UserPromptsManager from '../components/UserPromptsManager';
import { DEFAULT_USER_PROMPT_TITLE } from '../lib/defaultUserPrompt';
import useSWR from 'swr';
import { useRouter } from 'next/router';
import { logout } from '../lib/auth';
import Head from 'next/head';
import type { AIProvider } from '../types/models';
import { DEFAULT_THINKING_GUIDANCE, DEFAULT_API_FAILURE_TIMEOUT, clampApiFailureTimeout } from '../lib/aiProvider';

// --- Settings reducer (single state object replaces 24 individual useState calls) ---

interface SettingsState {
  // API / Provider
  apiKey: string;
  keysByProvider: Record<string, string>;
  aiProvider: AIProvider;
  apiBaseUrl: string;
  modelName: string;
  enableTemperatureOverride: boolean;
  maxTokenFieldName: string;
  stream: boolean;
  originalApiKey: string;
  // Prompt & model params
  defaultPromptId: number | null;
  temperature: number;
  maxCharacters: number;
  maxTokens: number;
  devMode: boolean;
  summaryPrompt: string;
  // Limits
  limitBio: number;
  limitScenario: number;
  limitPersonality: number;
  limitFirstMessage: number;
  limitExampleDialogue: number;
  limitSummary: number;
  limitNotes: number;
  limitGenerateDescription: number;
  limitMessageContent: number;
  apiFailureTimeout: number;
  // DeepSeek thinking/reasoning
  deepseekThinking: 'disabled' | 'enabled';
  deepseekReasoningEffort: 'high' | 'max';
  deepseekThinkingGuidance: string;
}

const DEFAULT_SUMMARY_PROMPT = 'Create a brief, focused summary (~100 words) of the roleplay between {{char}} and {{user}}. Include:\\n\\n- Key events and decisions\\n- Important emotional moments\\n- Location/time changes\\n\\nRules: Only summarize provided transcript. No speculation. Single paragraph format.';

const initialSettingsState: SettingsState = {
  apiKey: '',
  keysByProvider: {},
  aiProvider: 'deepseek',
  apiBaseUrl: '',
  modelName: '',
  enableTemperatureOverride: true,
  maxTokenFieldName: '',
  stream: true,
  originalApiKey: '',
  defaultPromptId: null,
  temperature: 1,
  maxCharacters: 150000,
  maxTokens: 4096,
  devMode: false,
  summaryPrompt: DEFAULT_SUMMARY_PROMPT,
  limitBio: 2500,
  limitScenario: 25000,
  limitPersonality: 25000,
  limitFirstMessage: 25000,
  limitExampleDialogue: 25000,
  limitSummary: 20000,
  limitNotes: 10000,
  limitGenerateDescription: 3000,
  limitMessageContent: 8000,
  apiFailureTimeout: 20,
  deepseekThinking: 'disabled',
  deepseekReasoningEffort: 'high',
  deepseekThinkingGuidance: DEFAULT_THINKING_GUIDANCE,
};

// Maps the raw settings rows onto a complete SettingsState. Key insertion order matches
// initialSettingsState so settingsFingerprint() stays comparable.
function settingsFromDb(db: Record<string, string>): SettingsState {
  const loaded: Record<string, string> = {
    deepseek: db.apiKey_deepseek || '',
    openai: db.apiKey_openai || '',
    openrouter: db.apiKey_openrouter || '',
    anthropic: db.apiKey_anthropic || '',
    custom: db.apiKey_custom || '',
  };
  const storedProvider = (db.aiProvider as AIProvider) || 'deepseek';
  // Migrate legacy apiKey into the selected provider slot if that slot is empty
  if (db.apiKey && !loaded[storedProvider]) loaded[storedProvider] = db.apiKey;
  const currentKey = loaded[storedProvider] || '';

  return {
    ...initialSettingsState,
    apiKey: currentKey,
    keysByProvider: loaded,
    // Temporarily hide anthropic; coerce to deepseek if encountered
    aiProvider: storedProvider === 'anthropic' ? 'deepseek' : storedProvider,
    apiBaseUrl: db.apiBaseUrl || '',
    modelName: db.modelName || '',
    enableTemperatureOverride: db.modelEnableTemperature === undefined ? true : db.modelEnableTemperature === 'true',
    maxTokenFieldName: db.maxTokenFieldName || '',
    // Default streaming to true if the setting has never been saved (undefined)
    stream: db.stream === undefined ? true : db.stream === 'true',
    originalApiKey: currentKey,
    defaultPromptId: db.defaultPromptId ? Number(db.defaultPromptId) : null,
    temperature: db.temperature ? parseFloat(db.temperature) : 1,
    maxCharacters: db.maxCharacters ? Math.max(30000, Math.min(2500000, parseInt(db.maxCharacters))) : 150000,
    maxTokens: db.maxTokens ? Math.max(256, Math.min(256000, parseInt(db.maxTokens))) : 4096,
    devMode: db.devMode === 'true',
    summaryPrompt: db.summaryPrompt || DEFAULT_SUMMARY_PROMPT,
    limitBio: db.limit_bio ? parseInt(db.limit_bio) : 2500,
    limitScenario: db.limit_scenario ? parseInt(db.limit_scenario) : 25000,
    limitPersonality: db.limit_personality ? parseInt(db.limit_personality) : 25000,
    limitFirstMessage: db.limit_firstMessage ? parseInt(db.limit_firstMessage) : 25000,
    limitExampleDialogue: db.limit_exampleDialogue ? parseInt(db.limit_exampleDialogue) : 25000,
    limitSummary: db.limit_summary ? parseInt(db.limit_summary) : 20000,
    limitNotes: db.limit_notes ? parseInt(db.limit_notes) : 10000,
    limitGenerateDescription: db.limit_generateDescription ? parseInt(db.limit_generateDescription) : 3000,
    limitMessageContent: db.limit_messageContent ? parseInt(db.limit_messageContent) : 8000,
    apiFailureTimeout: db.apiFailureTimeout ? clampApiFailureTimeout(parseInt(db.apiFailureTimeout)) : DEFAULT_API_FAILURE_TIMEOUT,
    deepseekThinking: db.deepseekThinking === 'enabled' ? 'enabled' : 'disabled',
    deepseekReasoningEffort: db.deepseekReasoningEffort === 'max' ? 'max' : 'high',
    deepseekThinkingGuidance: db.deepseekThinkingGuidance ?? DEFAULT_THINKING_GUIDANCE,
  };
}

// originalApiKey is a display-only mirror of the saved key, so it must not affect dirtiness.
const settingsFingerprint = (s: SettingsState) => JSON.stringify({ ...s, originalApiKey: '' });

type SettingsAction =
  | { type: 'SET_FIELD'; field: keyof SettingsState; value: any }
  | { type: 'LOAD_ALL'; payload: Partial<SettingsState> }
  | { type: 'UPDATE_API_KEY'; value: string; provider: string };

function settingsReducer(state: SettingsState, action: SettingsAction): SettingsState {
  switch (action.type) {
    case 'SET_FIELD':
      return { ...state, [action.field]: action.value };
    case 'LOAD_ALL':
      return { ...state, ...action.payload };
    case 'UPDATE_API_KEY':
      return {
        ...state,
        apiKey: action.value,
        keysByProvider: { ...state.keysByProvider, [action.provider]: action.value },
      };
    default:
      return state;
  }
}

export default function SettingsPage() {
  const appVersion = (process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0').replace(/^v/, '');

  // Settings state (single reducer replaces 24 individual useState calls)
  const [state, dispatch] = useReducer(settingsReducer, initialSettingsState);

  // UI toggles (not part of settings data loading)
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false);
  const [limitsOpen, setLimitsOpen] = useState(false);
  const [apiKeyEditing, setApiKeyEditing] = useState(false);

  // Unsaved-change tracking for the floating save bar
  const [baseline, setBaseline] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const currentFingerprint = useMemo(() => settingsFingerprint(state), [state]);
  const isDirty = baseline !== null && baseline !== currentFingerprint;
  const isDirtyRef = useRef(false);
  isDirtyRef.current = isDirty;

  // Connection test state
  const [connStatus, setConnStatus] = useState<'idle' | 'testing' | 'ok' | 'slow' | 'degraded' | 'down'>('idle');
  const [connLatency, setConnLatency] = useState<number | null>(null);
  const [connError, setConnError] = useState<string>('');

  // DeepSeek balance state
  const [dsBalance, setDsBalance] = useState<string | null>(null);
  const [dsBalanceLoading, setDsBalanceLoading] = useState(false);
  const [dsBalanceError, setDsBalanceError] = useState<string>('');

  const isFixedTemp = (prov: string, model: string) => prov === 'openai' && /^gpt-5/i.test(model || '');

  const connStatusModifier =
    connStatus === 'ok' ? 'settings-status--ok' :
    connStatus === 'slow' ? 'settings-status--warn' :
    connStatus === 'degraded' || connStatus === 'down' ? 'settings-status--error' :
    connStatus === 'testing' ? 'settings-status--testing' : '';

  const { data: userPrompts, error: userPromptsError, mutate: mutateUserPrompts } = useSWR<{id: number; title: string; body: string;} | { error?: string } | null>(
    '/api/user-prompts',
    (url: string) => fetch(url).then(async res => {
      const json = await res.json();
      return json;
    })
  );

  // Password form state (standalone)
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswordSection, setShowPasswordSection] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  // Import/Export state (standalone)
  const [importStatus, setImportStatus] = useState<'idle' | 'importing' | 'success' | 'error'>('idle');
  const [importMessage, setImportMessage] = useState('');
  const [exportLoading, setExportLoading] = useState(false);
  const [importProgress, setImportProgress] = useState<string>('');
  const [importSettingsEnabled, setImportSettingsEnabled] = useState(true);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const { data: dbSettings, mutate: mutateSettings } = useSWR<Record<string, string>>(
    '/api/settings',
    (url: string) => fetch(url).then(res => res.json())
  );

  // Toast notification state (standalone)
  const [toast, setToast] = useState<null | { message: string; type?: 'success' | 'error' }>(null);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };
  const router = useRouter();

  // --- Connection test handler ---
  const runConnectionTest = async () => {
    setConnStatus('testing');
    setConnLatency(null);
    setConnError('');

    const start = Date.now();
    // Timer ticks to update status while waiting
    const timerId = setInterval(() => {
      const elapsed = Date.now() - start;
      if (elapsed >= 10000) setConnStatus('degraded');
      else if (elapsed >= 5000) setConnStatus('slow');
    }, 500);

    try {
      const controller = new AbortController();
      const hardTimeout = setTimeout(() => controller.abort(), 15000);

      const res = await fetch('/api/settings/test-connection', {
        method: 'POST',
        signal: controller.signal,
      });
      clearTimeout(hardTimeout);
      clearInterval(timerId);

      const elapsed = Date.now() - start;
      setConnLatency(elapsed);

      const data = await res.json();

      // Easter egg: log every response to the console
      console.log('[Connection Test Response]', data);

      if (!res.ok || !data.ok) {
        setConnStatus('down');
        setConnError(data.error || `HTTP ${res.status}`);
        return;
      }

      // Classify by total round-trip time
      if (elapsed >= 10000) setConnStatus('degraded');
      else if (elapsed >= 5000) setConnStatus('slow');
      else setConnStatus('ok');
    } catch (err: any) {
      clearInterval(timerId);
      const elapsed = Date.now() - start;
      setConnLatency(elapsed);
      console.log('[Connection Test Error]', err);
      setConnStatus('down');
      setConnError(err?.name === 'AbortError' ? 'Request timed out' : (err?.message || 'Network error'));
    }
  };

  // --- DeepSeek balance fetcher ---
  const fetchBalance = async () => {
    setDsBalanceLoading(true);
    setDsBalanceError('');
    setDsBalance(null);
    try {
      const res = await fetch('/api/settings/balance');
      const data = await res.json();
      if (!res.ok) {
        setDsBalanceError(data.error || 'Failed to fetch balance');
      } else if (data.balance_infos?.length) {
        const info = data.balance_infos[0];
        const symbol = info.currency === 'USD' ? '$' : info.currency + ' ';
        setDsBalance(`${symbol}${info.total_balance}`);
      } else {
        setDsBalanceError('No balance info returned');
      }
    } catch (err: any) {
      setDsBalanceError(err?.message || 'Network error');
    } finally {
      setDsBalanceLoading(false);
    }
  };

  // Auto-fetch balance when provider is deepseek and key exists
  useEffect(() => {
    if (state.aiProvider === 'deepseek' && state.originalApiKey) {
      fetchBalance();
    } else {
      setDsBalance(null);
      setDsBalanceError('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.aiProvider, state.originalApiKey]);

  useEffect(() => {
    if (!dbSettings) return;
    // Never let a background revalidation overwrite edits that haven't been saved yet
    if (isDirtyRef.current) return;

    const next = settingsFromDb(dbSettings);
    if (apiKeyEditing) {
      const { apiKey, keysByProvider, originalApiKey, ...rest } = next;
      dispatch({ type: 'LOAD_ALL', payload: rest });
      return;
    }
    dispatch({ type: 'LOAD_ALL', payload: next });
    setBaseline(settingsFingerprint(next));
  }, [dbSettings, apiKeyEditing]);

  const handleDiscard = () => {
    if (!dbSettings) return;
    const next = settingsFromDb(dbSettings);
    dispatch({ type: 'LOAD_ALL', payload: next });
    setApiKeyEditing(false);
    setBaseline(settingsFingerprint(next));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Persist only the selected provider key + keep others intact
          // We send all provider-specific keys so backend upserts them independently.
          apiKey: '', // keep legacy slot empty going forward
          apiKey_deepseek: state.keysByProvider.deepseek || '',
          apiKey_openai: state.keysByProvider.openai || '',
          apiKey_openrouter: state.keysByProvider.openrouter || '',
          apiKey_anthropic: state.keysByProvider.anthropic || '',
          apiKey_custom: state.keysByProvider.custom || '',
          aiProvider: state.aiProvider,
          apiBaseUrl: state.aiProvider === 'custom' ? state.apiBaseUrl : '',
          modelName: state.modelName,
          modelEnableTemperature: String(state.enableTemperatureOverride),
          maxTokenFieldName: state.maxTokenFieldName,
          stream: String(state.stream),
          defaultPromptId: state.defaultPromptId ?? '',
          temperature: state.temperature.toString(),
          maxCharacters: String(state.maxCharacters),
          maxTokens: String(state.maxTokens),
          devMode: String(state.devMode),
          summaryPrompt: state.summaryPrompt,
          // Limits persistence
          limit_bio: String(state.limitBio),
          limit_scenario: String(state.limitScenario),
          limit_personality: String(state.limitPersonality),
          limit_firstMessage: String(state.limitFirstMessage),
          limit_exampleDialogue: String(state.limitExampleDialogue),
          limit_summary: String(state.limitSummary),
          limit_notes: String(state.limitNotes),
          limit_generateDescription: String(state.limitGenerateDescription),
          limit_messageContent: String(state.limitMessageContent),
          apiFailureTimeout: String(state.apiFailureTimeout),
          deepseekThinking: state.deepseekThinking,
          deepseekReasoningEffort: state.deepseekReasoningEffort,
          deepseekThinkingGuidance: state.deepseekThinkingGuidance,
        })
      });
      if (res.ok) {
        setBaseline(currentFingerprint);
        mutateSettings();
        if (apiKeyEditing) {
          dispatch({ type: 'SET_FIELD', field: 'originalApiKey', value: state.apiKey });
          setApiKeyEditing(false);
        }
        showToast('Settings saved');
      } else {
        showToast('Error saving settings', 'error');
      }
    } catch {
      showToast('Error saving settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordChange = async () => {
    setPasswordError('');

    if (!newPassword || !confirmPassword) {
      setPasswordError('Please fill in all password fields');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match');
      return;
    }

    if (newPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters long');
      return;
    }

    try {
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword })
      });

      if (response.ok) {
  setNewPassword('');
  setConfirmPassword('');
  setShowPasswordSection(false);
  showToast('Password updated');
      } else {
        const data = await response.json();
        setPasswordError(data.error || 'Failed to change password');
      }
    } catch {
      setPasswordError('Network error. Please try again.');
    }
  };

  const handleExportDatabase = async () => {
    setExportLoading(true);
    // Clear any previous import status when starting export
    setImportStatus('idle');
    setImportMessage('');
    
    try {
      const response = await fetch('/api/database/export');
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        
        // Get filename from Content-Disposition header or use default
        const contentDisposition = response.headers.get('Content-Disposition');
        const filenameMatch = contentDisposition?.match(/filename="(.+)"/);
        const filename = filenameMatch ? filenameMatch[1] : `ownchatbot-export-${new Date().toISOString().split('T')[0]}.zip`;
        
        a.download = filename || `ownchatbot-export-${new Date().toISOString().split('T')[0]}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        
  // (No settings toast for export per requirements)
      } else {
        const error = await response.json();
        setImportStatus('error');
        setImportMessage(`Export failed: ${error.error || 'Unknown error'}`);
        setTimeout(() => setImportStatus('idle'), 5000);
      }
    } catch (error) {
      setImportStatus('error');
      setImportMessage('Network error during export. Please try again.');
      setTimeout(() => setImportStatus('idle'), 5000);
    } finally {
      setExportLoading(false);
    }
  };

  const handleExportLegacyJson = async () => {
    setExportLoading(true);
    // Clear any previous import status when starting export
    setImportStatus('idle');
    setImportMessage('');
    
    try {
      const response = await fetch('/api/database/export?format=json');
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        
        // Get filename from Content-Disposition header or use default
        const contentDisposition = response.headers.get('Content-Disposition');
        const filenameMatch = contentDisposition?.match(/filename="(.+)"/);
        const filename = filenameMatch ? filenameMatch[1] : `ownchatbot-export-${new Date().toISOString().split('T')[0]}.json`;
        
        a.download = filename || `ownchatbot-export-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        
  // (No settings toast for export per requirements)
      } else {
        const error = await response.json();
        setImportStatus('error');
        setImportMessage(`Export failed: ${error.error || 'Unknown error'}`);
        setTimeout(() => setImportStatus('idle'), 5000);
      }
    } catch (error) {
      setImportStatus('error');
      setImportMessage('Network error during export. Please try again.');
      setTimeout(() => setImportStatus('idle'), 5000);
    } finally {
      setExportLoading(false);
    }
  };

  const handleImportDatabase = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Clear any previous status messages
    setImportStatus('idle');
    setImportMessage('');
    setImportProgress('');

    const isZipFile = file.name.toLowerCase().endsWith('.zip');
    const isJsonFile = file.name.toLowerCase().endsWith('.json');

    if (!isZipFile && !isJsonFile) {
      setImportStatus('error');
      setImportMessage('Please select a valid .zip or .json export file.');
      setTimeout(() => setImportStatus('idle'), 5000);
      return;
    }

    setImportStatus('importing');
    setImportProgress('📤 Preparing file upload...');
    setImportMessage('Starting import process...');

    try {
      const formData = new FormData();
      formData.append('importSettings', String(importSettingsEnabled));
      formData.append('file', file);

      // Show file size info for large files
      const fileSizeMB = (file.size / (1024 * 1024)).toFixed(1);
      if (file.size > 5 * 1024 * 1024) { // Files larger than 5MB
        setImportProgress('⏳ Processing large file...');
        setImportMessage(`Importing large database (${fileSizeMB}MB)... This may take several minutes. Please be patient.`);
      } else {
        setImportProgress('🔄 Uploading and processing...');
        setImportMessage('Processing database file...');
      }

      // Simulate progress updates for better UX
      const progressInterval = setInterval(() => {
        const currentTime = Date.now();
        const elapsed = (currentTime - startTime) / 1000;
        
        if (elapsed < 5) {
          setImportProgress('📤 Uploading file...');
        } else if (elapsed < 15) {
          setImportProgress('🔍 Analyzing database structure...');
        } else if (elapsed < 30) {
          setImportProgress('⚙️ Processing records...');
        } else if (elapsed < 60) {
          setImportProgress('💾 Importing data...');
        } else {
          setImportProgress('🔄 Finalizing import...');
        }
      }, 3000);

      const startTime = Date.now();

      const response = await fetch('/api/database/import', {
        method: 'POST',
        body: formData,
        // Increase timeout for large files (15 minutes)
        signal: AbortSignal.timeout(15 * 60 * 1000)
      });

      clearInterval(progressInterval);
      const result = await response.json();

      if (response.ok && result.success) {
        setImportStatus('success');
        setImportProgress(''); // Clear progress on success
        const { totalImported, totalSkipped, totalErrors } = result.summary;
        const { imported, skipped } = result.results;
        
        let message = `🎉 Import completed successfully!\n\n`;
        message += `📊 Detailed Import Summary:\n\n`;
        
        // Character Groups
        if (imported.characterGroups > 0 || skipped.characterGroups > 0) {
          message += `📁 Character Groups: ${imported.characterGroups} imported`;
          if (skipped.characterGroups > 0) message += `, ${skipped.characterGroups} skipped`;
          message += `\n`;
        }
        
        // Personas
        if (imported.personas > 0 || skipped.personas > 0) {
          message += `👤 Personas: ${imported.personas} imported`;
          if (skipped.personas > 0) message += `, ${skipped.personas} skipped`;
          message += `\n`;
        }
        
        // Characters
        if (imported.characters > 0 || skipped.characters > 0) {
          message += `🤖 Characters: ${imported.characters} imported`;
          if (skipped.characters > 0) message += `, ${skipped.characters} skipped`;
          message += `\n`;
        }
        
        // Global Prompts
        if (imported.userPrompts > 0 || skipped.userPrompts > 0) {
          message += `📝 Global Prompts: ${imported.userPrompts} imported`;
          if (skipped.userPrompts > 0) message += `, ${skipped.userPrompts} skipped`;
          message += `\n`;
        }
        
        // Settings
        if (imported.settings > 0 || skipped.settings > 0) {
          message += `⚙️ Settings: ${imported.settings} new`;
          if (skipped.settings > 0) message += `, ${skipped.settings} updated`;
          message += `\n`;
        } else if (!importSettingsEnabled) {
          message += `⚙️ Settings: skipped (not selected)\n`;
        }
        
        // Chat Sessions
        if (imported.chatSessions > 0 || skipped.chatSessions > 0) {
          message += `💬 Chat Sessions: ${imported.chatSessions} imported`;
          if (skipped.chatSessions > 0) message += `, ${skipped.chatSessions} skipped`;
          message += `\n`;
        }
        
        // Chat Messages
        if (imported.chatMessages > 0 || skipped.chatMessages > 0) {
          message += `📨 Chat Messages: ${imported.chatMessages} imported`;
          if (skipped.chatMessages > 0) message += `, ${skipped.chatMessages} skipped`;
          message += `\n`;
        }
        
        // Message Versions
        if (imported.messageVersions > 0 || skipped.messageVersions > 0) {
          message += `🔄 Message Versions: ${imported.messageVersions} imported`;
          if (skipped.messageVersions > 0) message += `, ${skipped.messageVersions} skipped`;
          message += `\n`;
        }
        
        message += `\n📈 Overall Totals:\n`;
        message += `• ${totalImported} total records imported\n`;
        message += `• ${totalSkipped} total records skipped/updated\n`;
        
        if (totalErrors > 0) {
          message += `• ${totalErrors} errors encountered\n`;
        }
        
        if (result.results.renamedCharacters?.length > 0) {
          message += `\n🏷️ Characters kept separate (content differed from an existing character):\n`;
          message += result.results.renamedCharacters.map((note: string) => `• ${note}`).join('\n');
          message += `\n`;
        }
        
        if (result.results.errors.length > 0) {
          message += `\n⚠️ Import Errors:\n`;
          if (result.results.errors.length <= 10) {
            message += result.results.errors.map((err: string) => `• ${err}`).join('\n');
          } else {
            message += result.results.errors.slice(0, 10).map((err: string) => `• ${err}`).join('\n');
            message += `\n... and ${result.results.errors.length - 10} more errors`;
          }
        }
        
        setImportMessage(message);
        // Don't auto-hide success messages - let user dismiss manually
      } else {
        setImportStatus('error');
        setImportProgress(''); // Clear progress on error
        setImportMessage(`Import failed: ${result.error || 'Unknown error'}`);
        // Error messages auto-hide after 10 seconds
        setTimeout(() => setImportStatus('idle'), 10000);
      }
    } catch (error) {
      setImportStatus('error');
      setImportProgress('');
      let errorMessage = 'Import failed. ';
      
      if (error instanceof Error) {
        if (error.name === 'AbortError' || error.message.includes('timeout')) {
          errorMessage += 'The import took too long and timed out. This can happen with very large files. Please try breaking the import into smaller chunks or contact support.';
        } else if (error.message.includes('Failed to fetch') || error.message.includes('Network error')) {
          errorMessage += 'Network connection failed. This often happens with large files. Please check your connection and try again.';
        } else {
          errorMessage += `Error: ${error.message}`;
        }
      } else {
        errorMessage += 'Please check your file and try again.';
      }
      
      setImportMessage(errorMessage);
      // Error messages auto-hide after 15 seconds for large file errors
      setTimeout(() => setImportStatus('idle'), 15000);
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  return (
    <>
      {toast && (
        <div className="toast-container">
          <div className={`toast ${toast.type === 'error' ? 'toast-error' : 'toast-success'}`}>
            {toast.message}
          </div>
        </div>
      )}
      <Head>
        <title>Settings - OwnChatBot Configuration</title>
        <meta name="description" content="Configure your AI API settings, manage user prompts, and update security settings." />
      </Head>

      <div className="settings-header">
        <div>
          <h1 className="text-3xl font-semibold mb-0">Settings</h1>
          <p className="settings-header__meta">Version {appVersion}</p>
        </div>
        <div className="settings-header__actions">
          <button className="btn btn-secondary" onClick={logout} title="Sign out">
            🚪 Logout
          </button>
          <button className="btn btn-secondary" onClick={() => router.push('/')}>
            🏠 Home
          </button>
        </div>
      </div>

      <div className="settings-grid">
        <div className="card settings-card">
          <div className="card-header">
            <h3 className="card-title">🔌 Provider &amp; Connection</h3>
            <p className="card-description">Where requests are sent and which key is used</p>
          </div>
          <div className="form-group">
            <label className="form-label">AI Provider</label>
            <select
              className="form-select"
              value={state.aiProvider}
              onChange={e => {
                const next = e.target.value as any;
                const newKey = state.keysByProvider[next] || '';
                dispatch({ type: 'LOAD_ALL', payload: { aiProvider: next, originalApiKey: newKey, apiKey: newKey } });
                setApiKeyEditing(false);
              }}
            >
              <option value="deepseek">DeepSeek</option>
              <option value="openai">OpenAI</option>
              <option value="openrouter">OpenRouter</option>
              <option value="custom">Custom (OpenAI-compatible)</option>
            </select>
            <p className="settings-hint">Select a preset or choose Custom to supply your own base URL and model.</p>
          </div>

          <div className="form-group">
            <label className="form-label flex items-center justify-between">
              <span>API Key</span>
              {state.originalApiKey && !apiKeyEditing && (
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  onClick={() => {
                    setApiKeyEditing(true);
                    dispatch({ type: 'SET_FIELD', field: 'apiKey', value: state.originalApiKey });
                  }}
                >
                  Edit
                </button>
              )}
              {apiKeyEditing && (
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  onClick={() => {
                    setApiKeyEditing(false);
                    dispatch({ type: 'UPDATE_API_KEY', value: state.originalApiKey, provider: state.aiProvider });
                  }}
                  title="Cancel editing and revert"
                >
                  Cancel
                </button>
              )}
            </label>
            {(!state.originalApiKey || apiKeyEditing) ? (
              <input
                type="password"
                className="form-input"
                value={state.apiKey}
                onChange={e => {
                  dispatch({ type: 'UPDATE_API_KEY', value: e.target.value, provider: state.aiProvider });
                }}
                placeholder="sk-..."
                style={{ fontFamily: 'monospace' }}
                disabled={!apiKeyEditing && !!state.originalApiKey}
              />
            ) : (
              <input
                type="password"
                className="form-input"
                value={'********'}
                disabled
                style={{ fontFamily: 'monospace' }}
                readOnly
              />
            )}
            {state.originalApiKey && !apiKeyEditing && (
              <p className="settings-hint">Click Edit to modify the stored key.</p>
            )}
            {apiKeyEditing && (
              <p className="settings-hint">Editing API key — Save to apply, or Cancel to revert.</p>
            )}
          </div>

          {state.aiProvider === 'custom' && (
            <div className="form-group">
              <label className="form-label">Custom API Base URL</label>
              <input
                type="text"
                className="form-input"
                value={state.apiBaseUrl}
                onChange={e => dispatch({ type: 'SET_FIELD', field: 'apiBaseUrl', value: e.target.value })}
                placeholder="https://your-endpoint.example.com/v1/chat/completions"
                style={{ fontFamily: 'monospace' }}
              />
              <p className="settings-hint">Full endpoint URL (OpenAI-compatible chat completions).</p>
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Model Override (optional)</label>
            <input
              type="text"
              className="form-input"
              value={state.modelName}
              onChange={e => dispatch({ type: 'SET_FIELD', field: 'modelName', value: e.target.value })}
              placeholder={state.aiProvider === 'deepseek' ? 'deepseek-v4-flash'
                : state.aiProvider === 'openai' ? 'gpt-5-mini'
                : state.aiProvider === 'openrouter' ? 'openrouter/auto'
                : 'your-model-name'}
              style={{ fontFamily: 'monospace' }}
            />
            <p className="settings-hint">Leave blank to use the preset default for the selected provider.</p>
          </div>

          <div className={`settings-status ${connStatusModifier}`}>
            <span className="settings-status__text">
              <span className="settings-status__dot" />
              <span className="settings-status__label">
                {connStatus === 'idle' && 'Connection not tested'}
                {connStatus === 'testing' && 'Testing connection...'}
                {connStatus === 'ok' && `API connected${connLatency ? ` (${connLatency}ms)` : ''}`}
                {connStatus === 'slow' && `Slow response${connLatency ? ` (${connLatency}ms)` : '...'}`}
                {connStatus === 'degraded' && `API degraded${connLatency ? ` (${connLatency}ms)` : '...'}`}
                {connStatus === 'down' && 'API down'}
              </span>
              {connError && <span className="settings-status__detail">— {connError}</span>}
            </span>
            <button
              type="button"
              className="btn btn-secondary btn-small"
              onClick={runConnectionTest}
              disabled={connStatus === 'testing'}
            >
              {connStatus === 'testing' ? 'Testing...' : 'Test'}
            </button>
          </div>

          {state.aiProvider === 'deepseek' && (
            <div className="settings-status">
              <span className="settings-status__text">
                <span className="settings-status__label">Remaining balance</span>
                {dsBalanceLoading && <span className="settings-status__detail">Loading...</span>}
                {dsBalance && <span className="settings-status__detail">{dsBalance}</span>}
                {dsBalanceError && <span className="settings-status__detail">{dsBalanceError}</span>}
                {!dsBalanceLoading && !dsBalance && !dsBalanceError && <span className="settings-status__detail">—</span>}
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={fetchBalance}
                disabled={dsBalanceLoading}
              >
                {dsBalanceLoading ? 'Checking...' : 'Refresh'}
              </button>
            </div>
          )}
        </div>

        {/* Reasoning (DeepSeek only) */}
        {state.aiProvider === 'deepseek' && (
          <div className="card settings-card">
            <div className="card-header">
              <h3 className="card-title">🧠 Reasoning</h3>
              <p className="card-description">DeepSeek thinking mode</p>
            </div>

            <div className="form-group">
              <label className="form-label">Thinking / Reasoning Mode</label>
              <select
                className="form-select"
                value={state.deepseekThinking}
                onChange={e => dispatch({ type: 'SET_FIELD', field: 'deepseekThinking', value: e.target.value })}
              >
                <option value="disabled">Disabled</option>
                <option value="enabled">Enabled</option>
              </select>
              <p className="settings-hint">More thorough responses, at the cost of extra tokens.</p>
            </div>

            {state.deepseekThinking === 'enabled' && (
              <>
                <div className="form-group">
                  <label className="form-label">Reasoning Effort</label>
                  <select
                    className="form-select"
                    value={state.deepseekReasoningEffort}
                    onChange={e => dispatch({ type: 'SET_FIELD', field: 'deepseekReasoningEffort', value: e.target.value })}
                  >
                    <option value="high">High</option>
                    <option value="max">Max</option>
                  </select>
                  <p className="settings-hint">Controls how much reasoning effort the model applies.</p>
                </div>
                <div className="form-group">
                  <label className="form-label">Thinking Guidance</label>
                  <textarea
                    className="form-textarea"
                    rows={4}
                    value={state.deepseekThinkingGuidance}
                    onChange={e => dispatch({ type: 'SET_FIELD', field: 'deepseekThinkingGuidance', value: e.target.value })}
                    placeholder={DEFAULT_THINKING_GUIDANCE}
                  />
                  <p className="settings-hint">Appended to the first user message when thinking is enabled. Invisible to you; only sent to the model.</p>
                </div>
              </>
            )}
          </div>
        )}

        {/* Generation */}
        <div className="card settings-card">
          <div className="card-header">
            <h3 className="card-title">🎛️ Generation</h3>
            <p className="card-description">How replies are produced</p>
          </div>

          <div className="form-group">
            <label className="form-label flex items-center gap-3">
              <input
                type="checkbox"
                checked={state.stream}
                onChange={e => dispatch({ type: 'SET_FIELD', field: 'stream', value: e.target.checked })}
                className="form-checkbox"
              />
              Enable Streamed Chat
            </label>
            <p className="settings-hint">Stream responses for a real-time conversation experience.</p>
          </div>

          <div className="form-group">
            <label className="form-label">
              Temperature: {isFixedTemp(state.aiProvider, state.modelName || '') ? '1 (fixed)' : state.temperature.toFixed(1)}
            </label>
            <input
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={isFixedTemp(state.aiProvider, state.modelName || '') ? 1 : state.temperature}
              onChange={e => dispatch({ type: 'SET_FIELD', field: 'temperature', value: parseFloat(e.target.value) })}
              className="form-range w-full"
              disabled={isFixedTemp(state.aiProvider, state.modelName || '') || !state.enableTemperatureOverride}
            />
            <div className="settings-range-scale">
              <span>Focused</span>
              <span>Balanced</span>
              <span>Creative</span>
            </div>
            {isFixedTemp(state.aiProvider, state.modelName || '') && (
              <p className="settings-hint">Selected model enforces a fixed temperature of 1.</p>
            )}
            {!state.enableTemperatureOverride && !isFixedTemp(state.aiProvider, state.modelName || '') && (
              <p className="settings-hint">Temperature is switched off under Advanced model parameters.</p>
            )}
          </div>

          <div className="form-group">
            <label className="form-label">
              Max characters in context: {state.maxCharacters.toLocaleString()}
            </label>
            <input
              type="range"
              min="30000"
              max="2500000"
              step="10000"
              value={state.maxCharacters}
              onChange={e => dispatch({ type: 'SET_FIELD', field: 'maxCharacters', value: parseInt(e.target.value) })}
              className="form-range w-full"
            />
            <div className="settings-range-scale">
              <span>30,000</span>
              <span>150,000 (default)</span>
              <span>2,500,000</span>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">
              Max tokens per response: {state.maxTokens}
            </label>
            <input
              type="range"
              min="256"
              max="256000"
              step="128"
              value={state.maxTokens}
              onChange={e => dispatch({ type: 'SET_FIELD', field: 'maxTokens', value: parseInt(e.target.value) })}
              className="form-range w-full"
            />
            <div className="settings-range-scale">
              <span>256</span>
              <span>4096 (default)</span>
              <span>256,000</span>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">
              API failure timeout: {state.apiFailureTimeout}s
            </label>
            <input
              type="range"
              min="5"
              max="240"
              step="5"
              value={state.apiFailureTimeout}
              onChange={e => dispatch({ type: 'SET_FIELD', field: 'apiFailureTimeout', value: parseInt(e.target.value) })}
              className="form-range w-full"
            />
            <div className="settings-range-scale">
              <span>5s</span>
              <span>20s (default)</span>
              <span>240s</span>
            </div>
            <p className="settings-hint">
              If nothing arrives within this time, the request is cancelled and an error is shown.
              Streamed replies allow twice this long between chunks.
            </p>
          </div>

          <div className="form-group">
            <button
              type="button"
              className="btn btn-secondary settings-disclosure"
              onClick={() => setModelSettingsOpen(o => !o)}
            >
              <span>Advanced model parameters</span>
              <span>{modelSettingsOpen ? '▲' : '▼'}</span>
            </button>
            {modelSettingsOpen && (
              <div className="settings-panel">
                <div>
                  <label className="form-label flex items-center gap-3">
                    <input
                      type="checkbox"
                      className="form-checkbox"
                      checked={state.enableTemperatureOverride}
                      onChange={e => dispatch({ type: 'SET_FIELD', field: 'enableTemperatureOverride', value: e.target.checked })}
                    />
                    Enable Temperature Parameter
                  </label>
                  <p className="settings-hint">Uncheck to omit temperature entirely (provider default).</p>
                </div>
                <div>
                  <label className="form-label">Max Token Field Name Override</label>
                  <input
                    type="text"
                    className="form-input"
                    value={state.maxTokenFieldName}
                    onChange={e => dispatch({ type: 'SET_FIELD', field: 'maxTokenFieldName', value: e.target.value })}
                    placeholder={state.aiProvider === 'openai' ? 'max_completion_tokens' : 'max_tokens'}
                    style={{ fontFamily: 'monospace' }}
                  />
                  <p className="settings-hint">Override the upstream JSON field name for the token limit. Leave blank for auto-detect ({state.aiProvider === 'openai' ? 'max_completion_tokens' : 'max_tokens'}).</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Prompts */}
        <div className="card settings-card">
          <div className="card-header">
            <h3 className="card-title">📝 Prompts</h3>
            <p className="card-description">Templates applied to every chat</p>
          </div>

          <div className="form-group">
            <label className="form-label">Active Global Prompt</label>
            {Array.isArray(userPrompts) ? (
              <select 
                className="form-select"
                value={state.defaultPromptId || ''} 
                onChange={e => dispatch({ type: 'SET_FIELD', field: 'defaultPromptId', value: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">None</option>
                {userPrompts.map(p => (
                  <option key={p.id} value={p.id}>{p.title}</option>
                ))}
              </select>
            ) : (
              <div className="text-sm text-error">
                {(userPrompts as any)?.error === 'Unauthorized' ? 'Session expired – please log in again.' : 'No prompts available.'}
                <div className="mt-2">
                  <button className="btn btn-secondary btn-small" onClick={() => router.push('/login')}>Go to Login</button>
                </div>
              </div>
            )}
          </div>

          <div className="form-group">
            <label className="form-label">Summary Generation Prompt</label>
            <textarea
              className="form-textarea"
              value={state.summaryPrompt}
              onChange={e => dispatch({ type: 'SET_FIELD', field: 'summaryPrompt', value: e.target.value })}
              placeholder="Prompt template for AI summary generation..."
              rows={3}
            />
            <p className="settings-hint">
              Use {'{{char}}'} and {'{{user}}'} placeholders. Supports \n for line breaks.
            </p>
          </div>
        </div>

        {/* Advanced */}
        <div className="card settings-card">
          <div className="card-header">
            <h3 className="card-title">🧪 Advanced</h3>
            <p className="card-description">Validation limits and debugging</p>
          </div>

          <div className="form-group">
            <button
              type="button"
              className="btn btn-secondary settings-disclosure"
              onClick={() => setLimitsOpen(o => !o)}
            >
              <span>Field length limits</span>
              <span>{limitsOpen ? '▲' : '▼'}</span>
            </button>
            {limitsOpen && (
              <div className="settings-panel">
                <p className="settings-hint">Maximum character lengths enforced when creating or updating data. Message &amp; Variant share one limit.</p>
                <div className="settings-fields">
                  <div>
                    <label className="form-label">Bio</label>
                    <input type="number" className="form-input" value={state.limitBio} onChange={e=>dispatch({ type: 'SET_FIELD', field: 'limitBio', value: parseInt(e.target.value)||0 })} min={500} max={200000} />
                  </div>
                  <div>
                    <label className="form-label">Scenario</label>
                    <input type="number" className="form-input" value={state.limitScenario} onChange={e=>dispatch({ type: 'SET_FIELD', field: 'limitScenario', value: parseInt(e.target.value)||0 })} min={1000} max={300000} />
                  </div>
                  <div>
                    <label className="form-label">Personality</label>
                    <input type="number" className="form-input" value={state.limitPersonality} onChange={e=>dispatch({ type: 'SET_FIELD', field: 'limitPersonality', value: parseInt(e.target.value)||0 })} min={1000} max={300000} />
                  </div>
                  <div>
                    <label className="form-label">First Message</label>
                    <input type="number" className="form-input" value={state.limitFirstMessage} onChange={e=>dispatch({ type: 'SET_FIELD', field: 'limitFirstMessage', value: parseInt(e.target.value)||0 })} min={500} max={300000} />
                  </div>
                  <div>
                    <label className="form-label">Example Dialogue</label>
                    <input type="number" className="form-input" value={state.limitExampleDialogue} onChange={e=>dispatch({ type: 'SET_FIELD', field: 'limitExampleDialogue', value: parseInt(e.target.value)||0 })} min={500} max={300000} />
                  </div>
                  <div>
                    <label className="form-label">Summary</label>
                    <input type="number" className="form-input" value={state.limitSummary} onChange={e=>dispatch({ type: 'SET_FIELD', field: 'limitSummary', value: parseInt(e.target.value)||0 })} min={1000} max={50000} />
                  </div>
                  <div>
                    <label className="form-label">Notes</label>
                    <input type="number" className="form-input" value={state.limitNotes} onChange={e=>dispatch({ type: 'SET_FIELD', field: 'limitNotes', value: parseInt(e.target.value)||0 })} min={1000} max={100000} />
                  </div>
                  <div>
                    <label className="form-label">Generate Description</label>
                    <input type="number" className="form-input" value={state.limitGenerateDescription} onChange={e=>dispatch({ type: 'SET_FIELD', field: 'limitGenerateDescription', value: parseInt(e.target.value)||0 })} min={200} max={6000} />
                  </div>
                  <div>
                    <label className="form-label">Message &amp; Variant Content</label>
                    <input type="number" className="form-input" value={state.limitMessageContent} onChange={e=>dispatch({ type: 'SET_FIELD', field: 'limitMessageContent', value: parseInt(e.target.value)||0 })} min={1000} max={20000} />
                  </div>
                </div>
                <p className="settings-hint">Keep limits reasonable to avoid very large payloads. Upstream token limits still apply.</p>
              </div>
            )}
          </div>

          <div className="form-group">
            <label className="form-label flex items-center gap-3">
              <input
                type="checkbox"
                checked={state.devMode}
                onChange={e => dispatch({ type: 'SET_FIELD', field: 'devMode', value: e.target.checked })}
                className="form-checkbox"
              />
              Developer Mode
            </label>
            <p className="settings-hint">Enables additional debugging features, such as the legacy JSON export.</p>
          </div>
        </div>

        {/* Authentication Section */}
        <div className="card settings-card">
          <div className="card-header">
            <h3 className="card-title">🔐 Authentication</h3>
            <p className="card-description">Manage site access password</p>
          </div>

          {!showPasswordSection ? (
            <button
              className="btn btn-secondary"
              onClick={() => setShowPasswordSection(true)}
            >
              Change Access Password
            </button>
          ) : (
            <div>
              <div className="form-group">
                <label className="form-label">New Password</label>
                <input
                  type="password"
                  className="form-input"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="Enter new password (min 6 characters)"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Confirm Password</label>
                <input
                  type="password"
                  className="form-input"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="Confirm new password"
                />
              </div>

              {passwordError && (
                <div className="settings-callout settings-callout--error mb-4">
                  <p className="settings-callout__body">{passwordError}</p>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  className="btn btn-primary"
                  onClick={handlePasswordChange}
                >
                  Update Password
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    setShowPasswordSection(false);
                    setNewPassword('');
                    setConfirmPassword('');
                    setPasswordError('');
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="card settings-card settings-span-all">
          <div className="card-header">
            <h2 className="card-title">🗃️ Database Management</h2>
            <p className="card-description">Import and export your entire database</p>
          </div>

          <div className="settings-grid">
            {/* Export Section */}
            <div>
              <h3 className="text-lg font-semibold mb-3">📤 Export Database</h3>
              <p className="text-sm text-secondary mb-4">
                Download a complete backup of your database as a compressed ZIP file including all characters, personas, chat sessions, messages, and settings.
              </p>
              <div className="settings-stack">
                <button
                  className={`btn btn-primary w-full ${exportLoading ? 'btn-disabled-muted' : ''}`}
                  onClick={handleExportDatabase}
                  disabled={exportLoading}
                >
                  {exportLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="status-dot status-loading"></div>
                      Exporting ZIP...
                    </span>
                  ) : (
                    'Export Database'
                  )}
                </button>
                {state.devMode && (
                  <button
                    className={`btn btn-secondary w-full text-sm ${exportLoading ? 'btn-disabled-muted' : ''}`}
                    onClick={handleExportLegacyJson}
                    disabled={exportLoading}
                    title="Export as uncompressed JSON file (legacy format)"
                  >
                    {exportLoading ? (
                      <span className="flex items-center justify-center gap-2">
                        <div className="status-dot status-loading"></div>
                        Exporting JSON...
                      </span>
                    ) : (
                      'Export as JSON (Legacy)'
                    )}
                  </button>
                )}
              </div>
            </div>

            {/* Import Section */}
            <div>
              <h3 className="text-lg font-semibold mb-3">📥 Import Database</h3>
              <p className="text-sm text-secondary mb-4">
                Import data from a database export file (.zip or .json). Existing data will be preserved - only new records will be added. Includes complete chat history. Supports files up to 500MB.
              </p>
              <label className="form-label flex items-center gap-3 mb-2">
                <input
                  type="checkbox"
                  checked={importSettingsEnabled}
                  onChange={e => setImportSettingsEnabled(e.target.checked)}
                  disabled={importStatus === 'importing'}
                  className="form-checkbox"
                />
                Import settings
              </label>
              <p className="settings-hint mb-4">
                When checked, settings in the file overwrite your current ones (passwords and secrets are never imported). Uncheck to keep your current settings.
              </p>
              <button
                className={`btn btn-secondary w-full ${importStatus === 'importing' ? 'btn-disabled-muted' : ''}`}
                onClick={triggerFileInput}
                disabled={importStatus === 'importing'}
              >
                {importStatus === 'importing' ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="status-dot status-loading"></div>
                    Importing...
                  </span>
                ) : (
                  'Select Import File'
                )}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip,.json"
                onChange={handleImportDatabase}
                style={{ display: 'none' }}
              />
              <p className="settings-hint">
                Supports .zip (recommended) and .json files. Large files may take several minutes to process.
              </p>
            </div>
          </div>

          {/* Status Messages */}
          {importStatus !== 'idle' && (
            <div className={`settings-callout ${
              importStatus === 'success' ? 'settings-callout--ok'
                : importStatus === 'error' ? 'settings-callout--error'
                : 'settings-callout--info'
            }`}>
              <div className="settings-callout__row">
                <div className="flex-1">
                  {importStatus === 'importing' && importProgress && (
                    <div className="import-progress flex items-center gap-3 mb-3">
                      <div className="status-dot status-loading"></div>
                      <div>
                        <div className="font-medium">{importProgress}</div>
                        <div className="settings-hint">Please wait while we process your database...</div>
                      </div>
                    </div>
                  )}
                  <pre className="settings-callout__body">{importMessage}</pre>
                </div>
                {importStatus === 'success' && (
                  <button
                    onClick={() => setImportStatus('idle')}
                    className="btn btn-secondary btn-small"
                    title="Dismiss"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          )}

          <details className="settings-details">
            <summary>⚠️ How import &amp; export handle your data</summary>
            <ul>
              <li><strong>Export:</strong> Creates a compressed ZIP backup of your entire OwnChatBot</li>
              <li><strong>Duplicates:</strong> Records with the same name/identifier will be skipped to prevent conflicts</li>
              <li><strong>Characters:</strong> A matching name only reuses the existing character if its content is identical; otherwise the imported copy is kept separately under an &quot;(import N)&quot; profile name</li>
              <li><strong>Settings:</strong> Only imported when &quot;Import settings&quot; is checked; new settings are added and existing ones are overwritten</li>
              <li><strong>Chat History:</strong> Each chat is imported whole or not at all - an existing chat is never merged with an imported one</li>
              <li><strong>Relationships:</strong> All connections between characters, personas, and chats are maintained</li>
            </ul>
          </details>
        </div>

        <div className="card settings-card settings-span-all">
          <div className="card-header flex items-start justify-between gap-4">
            <div>
              <h2 className="card-title">Global User Prompts</h2>
              <p className="card-description">Manage system-wide prompt templates</p>
            </div>
            {state.devMode && Array.isArray(userPrompts) && !userPrompts.some(p => p.title === DEFAULT_USER_PROMPT_TITLE) && (
              <button
                className="btn btn-secondary btn-small"
                onClick={async () => {
                  const res = await fetch('/api/user-prompts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'recreate_default' }) });
                  if (res.ok) {
                    mutateUserPrompts();
                    showToast('Default prompt created');
                  } else {
                    showToast('Failed to create default prompt', 'error');
                  }
                }}
                title="Recreate the built-in default prompt"
              >
                Create Default Prompt
              </button>
            )}
          </div>
          <UserPromptsManager />
        </div>
      </div>

      <div className="settings-spacer" />

      <div className={`settings-savebar ${isDirty ? 'settings-savebar--dirty' : ''}`}>
        <span className="settings-savebar__status">
          <span className="settings-savebar__dot" />
          {isDirty ? 'Unsaved changes' : 'All changes saved'}
        </span>
        {isDirty && (
          <button className="btn btn-secondary btn-small" onClick={handleDiscard} disabled={saving}>
            Discard
          </button>
        )}
        <button
          className={`btn btn-primary btn-small ${!isDirty || saving ? 'btn-disabled-muted' : ''}`}
          onClick={handleSave}
          disabled={!isDirty || saving}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </>
  );
}
