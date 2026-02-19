/** Centralized model types shared across pages and components. */

export interface Persona {
  id: number;
  name: string;
  profileName?: string;
  profile?: string;
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
  scenario?: string;
  personality?: string;
  firstMessage?: string;
  exampleDialogue?: string;
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
}

export interface Message {
  id: number;
  sessionId?: number;
  role: string;
  content: string;
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
