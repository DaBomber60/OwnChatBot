/** Centralized model types shared across pages and components. */

export type AIProvider = 'deepseek' | 'openai' | 'openrouter' | 'custom';

export interface Persona {
  id: number;
  name: string;
  profileName?: string;
  profile: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CharacterGroup {
  id: number;
  name: string;
  color: string;
  isCollapsed: boolean;
  sortOrder: number;
  characters?: Character[];
  createdAt?: string;
  updatedAt?: string;
}

export interface Character {
  id: number;
  name: string;
  profileName?: string;
  bio?: string;
  scenario: string;
  personality: string;
  firstMessage: string;
  exampleDialogue: string;
  groupId?: number | null;
  sortOrder?: number;
  group?: CharacterGroup | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface Session {
  id: number;
  persona: Persona;
  character: Character;
  updatedAt: string;
  summary?: string;
  description?: string;
  messageCount: number;
  createdAt?: string;
}

export interface SessionData {
  id: number;
  personaId: number;
  characterId: number;
  summary?: string;
  lastSummary?: number;
  persona: Persona;
  character: Character;
  messages: Message[];
  hasMore?: boolean;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  messageId?: number;
  metadata?: string | null;
}

export interface Message {
  id: number;
  sessionId?: number;
  role: string;
  content: string;
  metadata?: string | null;
  versions?: MessageVersion[];
  createdAt?: string;
}

export interface MessageVersion {
  id: number;
  messageId?: number;
  content: string;
  version: number;
  isActive: boolean;
  createdAt?: string;
}

export interface UserPrompt {
  id: number;
  title: string;
  body: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Setting {
  key: string;
  value: string;
  createdAt?: string;
  updatedAt?: string;
}

/** Lightweight lorebook row from GET /api/lorebooks?view=summary. */
export interface LorebookSummary {
  id: number;
  name: string;
  description: string | null;
  entryCount: number;
  /** Characters that add this lorebook to their new chats by default. */
  characterCount: number;
  /** Chats this lorebook is attached to. */
  chatCount: number;
}

export interface LoreEntry {
  id: number;
  lorebookId: number;
  title: string;
  content: string;
  keys: string[];
  /** Always included in the system prompt instead of waiting for keywords. */
  constant: boolean;
  enabled: boolean;
  priority: number;
  createdAt?: string;
  updatedAt?: string;
}

/** GET /api/lorebooks/:id */
export interface LorebookDetail {
  id: number;
  name: string;
  description: string | null;
  isGlobal: boolean;
  entries: LoreEntry[];
  /** Characters whose new chats get this lorebook by default. */
  characters: Array<{ id: number; name: string; profileName: string | null }>;
  chatCount: number;
  createdAt?: string;
  updatedAt?: string;
}

/** GET /api/sessions/:id/lorebooks */
export interface SessionLorebooksResponse {
  lorebookIds: number[];
  globalLoreEnabled: boolean;
  characterDefaultIds: number[];
}

/** GET /api/characters/:id/lorebooks */
export interface CharacterLorebooksResponse {
  lorebookIds: number[];
  existingChatCount: number;
}
