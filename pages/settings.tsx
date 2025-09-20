import { useState, useEffect, useRef } from 'react';
import UserPromptsManager from '../components/UserPromptsManager';
import useSWR from 'swr';
import { useRouter } from 'next/router';
import { logout } from '../lib/auth';
import Head from 'next/head';

export default function SettingsPage() {
  // Provider-specific API keys (stored independently)
  const [apiKey, setApiKey] = useState(''); // Currently selected provider key (UI convenience)
  const [keysByProvider, setKeysByProvider] = useState<Record<string, string>>({});
  const [aiProvider, setAiProvider] = useState<'deepseek' | 'openai' | 'openrouter' | 'custom'>('deepseek');
  const [apiBaseUrl, setApiBaseUrl] = useState(''); // only for custom
  const [modelName, setModelName] = useState('');
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false);
  const [enableTemperatureOverride, setEnableTemperatureOverride] = useState(true);
  const [maxTokenFieldName, setMaxTokenFieldName] = useState('');
  const isFixedTemp = (prov: string, model: string) => prov === 'openai' && /^gpt-5/i.test(model || '');
  const [stream, setStream] = useState(true);
  // Added state for API key edit mode
  const [apiKeyEditing, setApiKeyEditing] = useState(false);
  const [originalApiKey, setOriginalApiKey] = useState('');
  const { data: userPrompts, error: userPromptsError } = useSWR<{id: number; title: string; body: string;} | { error?: string } | null>(
    '/api/user-prompts',
    (url: string) => fetch(url).then(async res => {
      const json = await res.json();
      return json;
    })
  );
  const [defaultPromptId, setDefaultPromptId] = useState<number | null>(null);
  const [temperature, setTemperature] = useState(0.7);
  const [maxCharacters, setMaxCharacters] = useState(150000);
  const [maxTokens, setMaxTokens] = useState(4096);
  const [devMode, setDevMode] = useState(false);
  const [summaryPrompt, setSummaryPrompt] = useState('Create a brief, focused summary (~100 words) of the roleplay between {{char}} and {{user}}. Include:\\n\\n- Key events and decisions\\n- Important emotional moments\\n- Location/time changes\\n\\nRules: Only summarize provided transcript. No speculation. Single paragraph format.');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswordSection, setShowPasswordSection] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [importStatus, setImportStatus] = useState<'idle' | 'importing' | 'success' | 'error'>('idle');
  const [importMessage, setImportMessage] = useState('');
  const [exportLoading, setExportLoading] = useState(false);
  const [importProgress, setImportProgress] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { data: dbSettings, mutate: mutateSettings } = useSWR<Record<string, string>>(
    '/api/settings',
    (url: string) => fetch(url).then(res => res.json())
  );
  // Toast notification state
  const [toast, setToast] = useState<null | { message: string; type?: 'success' | 'error' }>(null);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };
  const router = useRouter();

  useEffect(() => {
    // Initialize all settings from database (avoid clobbering unsaved key edits)
    if (dbSettings) {
      if (!apiKeyEditing) {
        // Load provider-specific keys (fallback to legacy apiKey)
        const loaded: Record<string,string> = {
          deepseek: dbSettings.apiKey_deepseek || '',
          openai: dbSettings.apiKey_openai || '',
          openrouter: dbSettings.apiKey_openrouter || '',
          anthropic: dbSettings.apiKey_anthropic || '',
          custom: dbSettings.apiKey_custom || ''
        };
        // Migrate legacy apiKey into selected provider slot if empty
        if ((dbSettings.apiKey || '') && !loaded[(dbSettings.aiProvider as string) || 'deepseek']) {
          const legacyProviderKey = (dbSettings.aiProvider as string) || 'deepseek';
          loaded[legacyProviderKey] = dbSettings.apiKey as string;
        }
        setKeysByProvider(loaded);
        const currentKey = loaded[(dbSettings.aiProvider as any) || 'deepseek'] || '';
        setOriginalApiKey(currentKey);
        setApiKey(currentKey);
      }
  const incomingProvider = (dbSettings.aiProvider as any) || 'deepseek';
  // Temporarily hide anthropic; coerce to deepseek if encountered
  setAiProvider(incomingProvider === 'anthropic' ? 'deepseek' : incomingProvider);
      setApiBaseUrl(dbSettings.apiBaseUrl || '');
      setModelName(dbSettings.modelName || '');
  setEnableTemperatureOverride(dbSettings.modelEnableTemperature === undefined ? true : dbSettings.modelEnableTemperature === 'true');
  setMaxTokenFieldName(dbSettings.maxTokenFieldName || '');
      setStream(dbSettings.stream === 'true');
      setDefaultPromptId(dbSettings.defaultPromptId ? Number(dbSettings.defaultPromptId) : null);
      setTemperature(dbSettings.temperature ? parseFloat(dbSettings.temperature) : 0.7);
      setMaxCharacters(dbSettings.maxCharacters ? Math.max(30000, Math.min(320000, parseInt(dbSettings.maxCharacters))) : 150000);
      setMaxTokens(dbSettings.maxTokens ? Math.max(256, Math.min(8192, parseInt(dbSettings.maxTokens))) : 4096);
      setDevMode(dbSettings.devMode === 'true');
      setSummaryPrompt(dbSettings.summaryPrompt || 'Create a brief, focused summary (~50 words) of the roleplay between {{char}} and {{user}}. Include:\\n\\n- Key events and decisions\\n- Important emotional moments\\n- Location/time changes\\n\\nRules: Only summarize provided transcript. No speculation. Single paragraph format.');
    }
  }, [dbSettings, apiKeyEditing]);

  const handleSave = async () => {
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Persist only the selected provider key + keep others intact
          // We send all provider-specific keys so backend upserts them independently.
          apiKey: '', // keep legacy slot empty going forward
          apiKey_deepseek: keysByProvider.deepseek || '',
          apiKey_openai: keysByProvider.openai || '',
          apiKey_openrouter: keysByProvider.openrouter || '',
          apiKey_anthropic: keysByProvider.anthropic || '',
          apiKey_custom: keysByProvider.custom || '',
          aiProvider: aiProvider,
          apiBaseUrl: aiProvider === 'custom' ? apiBaseUrl : '',
          modelName: modelName,
          modelEnableTemperature: String(enableTemperatureOverride),
          maxTokenFieldName: maxTokenFieldName,
          stream: String(stream),
          defaultPromptId: defaultPromptId ?? '',
          temperature: temperature.toString(),
          maxCharacters: String(maxCharacters),
          maxTokens: String(maxTokens),
          devMode: String(devMode),
          summaryPrompt: summaryPrompt
        })
      });
      if (res.ok) {
        mutateSettings();
        if (apiKeyEditing) {
          setOriginalApiKey(apiKey);
          setApiKeyEditing(false);
        }
        showToast('Settings saved');
      } else {
        showToast('Error saving settings', 'error');
      }
    } catch {
      showToast('Error saving settings', 'error');
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
    <div className="container">
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

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-semibold mb-0">Settings</h1>
        <button className="btn btn-secondary" onClick={() => router.push('/')}>
          🏠 Home
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">API Configuration</h3>
            <p className="card-description">Configure your AI provider settings</p>
          </div>
          <div className="form-group">
            <label className="form-label">AI Provider</label>
            <select
              className="form-select"
              value={aiProvider}
              onChange={e => {
                const next = e.target.value as any;
                setAiProvider(next);
                // Swap displayed key based on selection
                const newKey = keysByProvider[next] || '';
                setOriginalApiKey(newKey);
                setApiKey(newKey);
                setApiKeyEditing(false);
              }}
            >
              <option value="deepseek">DeepSeek</option>
              <option value="openai">OpenAI</option>
              <option value="openrouter">OpenRouter</option>
              <option value="custom">Custom (OpenAI-compatible)</option>
            </select>
            <p className="text-xs text-secondary mt-1">Select a preset or choose Custom to supply your own base URL and model.</p>
          </div>
          
          <div className="form-group">
            <label className="form-label flex items-center justify-between">
              <span>API Key</span>
              {originalApiKey && !apiKeyEditing && (
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  onClick={() => {
                    setApiKeyEditing(true);
                    setApiKey(originalApiKey);
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
                    setApiKey(originalApiKey); // revert
                  }}
                  title="Cancel editing and revert"
                >
                  Cancel
                </button>
              )}
            </label>
            {(!originalApiKey || apiKeyEditing) ? (
              <input
                type="password"
                className="form-input"
                value={apiKey}
                onChange={e => {
                  const val = e.target.value;
                  setApiKey(val);
                  setKeysByProvider(prev => ({ ...prev, [aiProvider]: val }));
                }}
                placeholder="sk-..."
                style={{ fontFamily: 'monospace' }}
                disabled={!apiKeyEditing && !!originalApiKey}
              />
            ) : (
              <div className="flex items-center gap-2">
                <input
                  type="password"
                  className="form-input flex-1"
                  value={"********"}
                  disabled
                  style={{ fontFamily: 'monospace' }}
                />
              </div>
            )}
            {originalApiKey && !apiKeyEditing && (
              <p className="text-xs text-secondary mt-1">Click Edit to modify stored key.</p>
            )}
            {apiKeyEditing && (
              <p className="text-xs text-secondary mt-1">Editing API key. Save settings to apply or Cancel to revert.</p>
            )}
          </div>

          {aiProvider === 'custom' && (
            <>
              <div className="form-group">
                <label className="form-label">Custom API Base URL</label>
                <input
                  type="text"
                  className="form-input"
                  value={apiBaseUrl}
                  onChange={e => setApiBaseUrl(e.target.value)}
                  placeholder="https://your-endpoint.example.com/v1/chat/completions"
                  style={{ fontFamily: 'monospace' }}
                />
                <p className="text-xs text-secondary mt-1">Full endpoint URL (OpenAI-compatible chat completions).</p>
              </div>
            </>
          )}

          <div className="form-group">
            <label className="form-label">Model Override (optional)</label>
            <input
              type="text"
              className="form-input"
              value={modelName}
              onChange={e => setModelName(e.target.value)}
              placeholder={aiProvider === 'deepseek' ? 'deepseek-chat' 
                : aiProvider === 'openai' ? 'gpt-5-mini' 
                : aiProvider === 'openrouter' ? 'openrouter/auto' 
                : 'your-model-name'}
              style={{ fontFamily: 'monospace' }}
            />
            <p className="text-xs text-secondary mt-1">Leave blank to use the preset default for selected provider.</p>
          </div>

          <div className="form-group">
            <button
              type="button"
              className="btn btn-secondary w-full flex items-center justify-between"
              onClick={() => setModelSettingsOpen(o => !o)}
            >
              <span>Model Settings</span>
              <span>{modelSettingsOpen ? '▲' : '▼'}</span>
            </button>
            {modelSettingsOpen && (
              <div className="mt-3 p-3 border rounded-lg space-y-4 bg-black/5">
                <div>
                  <label className="form-label flex items-center gap-3">
                    <input
                      type="checkbox"
                      className="form-checkbox"
                      checked={enableTemperatureOverride}
                      onChange={e => setEnableTemperatureOverride(e.target.checked)}
                    />
                    Enable Temperature Parameter
                  </label>
                  <p className="text-xs text-secondary mt-1">Uncheck to omit temperature entirely (provider default).</p>
                </div>
                <div>
                  <label className="form-label">Max Token Field Name Override</label>
                  <input
                    type="text"
                    className="form-input"
                    value={maxTokenFieldName}
                    onChange={e => setMaxTokenFieldName(e.target.value)}
                    placeholder={aiProvider === 'openai' ? 'max_completion_tokens' : 'max_tokens'}
                    style={{ fontFamily: 'monospace' }}
                  />
                  <p className="text-xs text-secondary mt-1">Override the upstream JSON field name for token limit. Leave blank for auto-detect ({aiProvider === 'openai' ? 'max_completion_tokens' : 'max_tokens'}).</p>
                </div>
              </div>
            )}
          </div>

          <div className="form-group">
            <label className="form-label flex items-center gap-3">
              <input
                type="checkbox"
                checked={stream}
                onChange={e => setStream(e.target.checked)}
                className="form-checkbox"
              />
              Enable Streamed Chat
            </label>
            <p className="text-sm text-secondary mt-1">
              Stream responses for real-time conversation experience
            </p>
          </div>

          <div className="card-header">
            <h3 className="card-title">Model Parameters</h3>
            <p className="card-description">Fine-tune model behavior</p>
          </div>
          
          <div className="form-group">
            <label className="form-label">
              Temperature: {isFixedTemp(aiProvider, modelName || '') ? '1 (fixed)' : temperature.toFixed(1)}
            </label>
            <input
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={isFixedTemp(aiProvider, modelName || '') ? 1 : temperature}
              onChange={e => setTemperature(parseFloat(e.target.value))}
              className="form-range w-full"
              disabled={isFixedTemp(aiProvider, modelName || '') || !enableTemperatureOverride}
            />
            <div className="flex justify-between text-xs text-muted mt-1">
              <span>Focused</span>
              <span>Balanced</span>
              <span>Creative</span>
            </div>
            {isFixedTemp(aiProvider, modelName || '') && (
              <p className="text-xs text-secondary mt-1">Selected model enforces a fixed temperature of 1.</p>
            )}
            {!enableTemperatureOverride && !isFixedTemp(aiProvider, modelName || '') && (
              <p className="text-xs text-secondary mt-1">Temperature disabled in Model Settings.</p>
            )}
          </div>

          <div className="form-group">
            <label className="form-label">
              Max characters in context: {maxCharacters.toLocaleString()}
            </label>
            <input
              type="range"
              min="30000"
              max="320000"
              step="1000"
              value={maxCharacters}
              onChange={e => setMaxCharacters(parseInt(e.target.value))}
              className="form-range w-full"
            />
            <div className="flex justify-between text-xs text-muted mt-1">
              <span>30,000</span>
              <span>150,000 (default)</span>
              <span>320,000</span>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">
              Max tokens per response: {maxTokens}
            </label>
            <input
              type="range"
              min="256"
              max="8192"
              step="128"
              value={maxTokens}
              onChange={e => setMaxTokens(parseInt(e.target.value))}
              className="form-range w-full"
            />
            <div className="flex justify-between text-xs text-muted mt-1">
              <span>256</span>
              <span>4096 (default)</span>
              <span>8192</span>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Active Global Prompt</label>
            {Array.isArray(userPrompts) ? (
              <select 
                className="form-select"
                value={defaultPromptId || ''} 
                onChange={e => setDefaultPromptId(e.target.value ? Number(e.target.value) : null)}
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
              value={summaryPrompt}
              onChange={e => setSummaryPrompt(e.target.value)}
              placeholder="Prompt template for AI summary generation..."
              rows={3}
            />
            <p className="text-xs text-secondary mt-1">
              Use {'{{char}}'} and {'{{user}}'} placeholders. Supports \n for line breaks.
            </p>
          </div>

          <div className="form-group">
            <label className="form-label flex items-center gap-3">
              <input
                type="checkbox"
                checked={devMode}
                onChange={e => setDevMode(e.target.checked)}
                className="form-checkbox"
              />
              Developer Mode
            </label>
            <p className="text-sm text-secondary mt-1">
              Enable additional debugging features
            </p>
          </div>

          <button
            className="btn btn-primary w-full"
            onClick={handleSave}
          >
            Save Settings
          </button>
        </div>

        {/* Authentication Section */}
        <div className="card">
          <div className="card-header">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="card-title">🔐 Authentication</h3>
                <p className="card-description">Manage site access password</p>
              </div>
              <button 
                className="btn btn-secondary btn-small"
                onClick={logout}
                title="Sign Out"
              >
                🚪 Logout
              </button>
            </div>
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
                <div className="mb-4 p-3 bg-error/10 border border-error/20 rounded-lg">
                  <p className="text-error text-sm">{passwordError}</p>
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
      </div>

      <div className="mt-8">
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">🗃️ Database Management</h2>
            <p className="card-description">Import and export your entire database</p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Export Section */}
            <div>
              <h3 className="text-lg font-semibold mb-3">📤 Export Database</h3>
              <p className="text-sm text-secondary mb-4">
                Download a complete backup of your database as a compressed ZIP file including all characters, personas, chat sessions, messages, and settings.
              </p>
              <div className="space-y-3">
                <button
                  className={`btn btn-primary w-full ${exportLoading ? 'opacity-50' : ''}`}
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
                {devMode && (
                  <button
                    className={`btn btn-secondary w-full text-sm ${exportLoading ? 'opacity-50' : ''}`}
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
            <div className={`transition-opacity duration-300 ${importStatus === 'importing' ? 'opacity-75' : ''}`}>
              <h3 className="text-lg font-semibold mb-3">📥 Import Database</h3>
              <p className="text-sm text-secondary mb-4">
                Import data from a database export file (.zip or .json). Existing data will be preserved - only new records will be added. Includes complete chat history. Supports files up to 500MB.
              </p>
              <button
                className={`btn btn-secondary w-full ${importStatus === 'importing' ? 'opacity-50' : ''}`}
                onClick={triggerFileInput}
                disabled={importStatus === 'importing'}
              >
                {importStatus === 'importing' ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="status-dot status-loading"></div>
                    <div className="flex flex-col items-center">
                      <span>Importing...</span>
                    </div>
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
              <p className="text-xs text-muted mt-2">
                Supports .zip (recommended) and .json files. Large files may take several minutes to process.
              </p>
            </div>
          </div>

          {/* Status Messages */}
          {importStatus !== 'idle' && (
            <div className={`mt-6 p-4 rounded-lg border ${
              importStatus === 'success' 
                ? 'bg-success/10 border-success/20' 
                : importStatus === 'error'
                ? 'bg-error/10 border-error/20'
                : 'bg-primary/10 border-primary/20'
            }`}>
              <div className="flex items-start justify-between gap-3">
                <div className={`text-sm flex-1 ${
                  importStatus === 'success' 
                    ? 'text-success' 
                    : importStatus === 'error'
                    ? 'text-error'
                    : 'text-primary'
                }`}>
                  {importStatus === 'importing' && importProgress && (
                    <div className="import-progress flex items-center gap-3 mb-3 p-3 bg-black/5 rounded-lg">
                      <div className="status-dot status-loading"></div>
                      <div>
                        <div className="font-medium">{importProgress}</div>
                        <div className="text-xs opacity-75 mt-1">Please wait while we process your database...</div>
                      </div>
                    </div>
                  )}
                  <pre className="whitespace-pre-wrap font-sans">{importMessage}</pre>
                </div>
                {importStatus === 'success' && (
                  <button
                    onClick={() => setImportStatus('idle')}
                    className="btn btn-small text-success hover:bg-success/20 px-2 py-1 text-xs"
                    title="Dismiss"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="mt-6 p-4 bg-warning/10 border border-warning/20 rounded-lg">
            <h4 className="text-warning font-semibold mb-2">⚠️ Important Notes:</h4>
            <ul className="text-sm text-secondary space-y-1 list-disc list-inside">
              <li><strong>Export:</strong> Creates a compressed ZIP backup of your entire OwnChatBot</li>
              <li><strong>Duplicates:</strong> Records with the same name/identifier will be skipped to prevent conflicts</li>
              <li><strong>Settings:</strong> New settings are imported, existing ones are updated with new values</li>
              <li><strong>Chat History:</strong> Messages and their versions are fully preserved during import</li>
              <li><strong>Relationships:</strong> All connections between characters, personas, and chats are maintained</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="mt-8">
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Global User Prompts</h2>
            <p className="card-description">Manage system-wide prompt templates</p>
          </div>
          <UserPromptsManager />
        </div>
      </div>
    </div>
  );
}
