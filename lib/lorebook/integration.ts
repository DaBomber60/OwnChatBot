/**
 * Integration point: lorebook with conversation prompt building.
 * Handles triggering, tracking, and injection of lore into prompts.
 */
import { collectActiveEntries, collectConstantEntries, type TriggerContext } from './trigger';
import { injectConstantLoreIntoSystemPrompt, injectTriggeredLoreIntoUserMessage } from './injection';
import type { PromptMessage } from '../aiRequest';

export interface LoreIntegrationContext {
  sessionId: number;
  characterId: number;
  personaName: string;
  keepActiveTurns: number;
  /** Messages before new user message is added (for keep-active tracking) */
  history: Array<{ role: string; content: string; triggeredLoreIds?: number[] }>;
  /** The new user message to inject lore into */
  userMessage: string;
}

export interface LoreInjectionResult {
  /** System prompt with constant lore injected */
  systemPromptWithLore: string;
  /** User message with triggered lore appended */
  userMessageWithLore: string;
  /** IDs of entries that were triggered this turn (for tracking) */
  triggeredEntryIds: number[];
}

/**
 * Main integration function: collect applicable lore, trigger entries,
 * and return modified prompt components ready to be assembled.
 */
export async function integrateLorebookIntoPrompt(
  ctx: LoreIntegrationContext,
  systemPromptBeforeLore: string
): Promise<LoreInjectionResult> {
  // Collect constant entries (always in system prompt)
  const constantEntries = await collectConstantEntries(ctx.characterId);

  // Collect triggered entries (based on keyword matches and keep-active)
  const triggerContext: TriggerContext = {
    sessionId: ctx.sessionId,
    characterId: ctx.characterId,
    currentMessageText: ctx.userMessage,
    history: ctx.history,
    keepActiveTurns: ctx.keepActiveTurns,
  };
  const triggeredEntries = await collectActiveEntries(triggerContext);

  // Inject constant lore into system prompt
  const systemPromptWithLore = injectConstantLoreIntoSystemPrompt(
    systemPromptBeforeLore,
    constantEntries
  );

  // Inject triggered lore into user message
  const { injectedMessage, triggeredIds } = injectTriggeredLoreIntoUserMessage(
    ctx.userMessage,
    triggeredEntries
  );

  return {
    systemPromptWithLore,
    userMessageWithLore: injectedMessage,
    triggeredEntryIds: triggeredIds,
  };
}
