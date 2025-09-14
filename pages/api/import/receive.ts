import type { NextApiRequest, NextApiResponse } from 'next';
import { limiters, clientIp } from '../../../lib/rateLimit';
import { tooManyRequests } from '../../../lib/apiErrors';
import prisma from '../../../lib/prisma';
import { getCachedImportToken } from '../../../lib/importToken';

// In-memory storage for the latest import (simple single-session approach)
// Using global to share state between API endpoints
if (!(global as any).latestImport) {
  (global as any).latestImport = null;
}

function parseChatData(requestData: any) {
  const logs: string[] = [];
  
  try {
    logs.push('Starting data parsing...');
    console.log('Parsing import data:', JSON.stringify(requestData, null, 2));
    
    if (!requestData.messages || !Array.isArray(requestData.messages)) {
      throw new Error('Invalid request format: missing messages array');
    }
    logs.push(`Found ${requestData.messages.length} messages in request`);
    
    // Find the system message
    const systemMessage = requestData.messages.find((msg: any) => msg.role === 'system');
    if (!systemMessage) {
      throw new Error('No system message found');
    }
    logs.push('Found system message');
    
    const systemContent = systemMessage.content;
    logs.push(`System content length: ${systemContent.length} characters`);
    
    // Look for the import marker
    const importMarkerIndex = systemContent.indexOf('<ownchatbot_importer>');
    if (importMarkerIndex === -1) {
      throw new Error('No <ownchatbot_importer> marker found. Please set your custom prompt to "<ownchatbot_importer>" for import to work.');
    }
    logs.push('Found <ownchatbot_importer> marker');
    
    // Extract character data from system content
    const contentAfterMarker = systemContent.substring(importMarkerIndex + 22); // 22 = length of '<ownchatbot_importer>'
    console.log('Content after marker:', contentAfterMarker);
    logs.push(`Content after marker: "${contentAfterMarker.substring(0, 100)}..."`);
    
    // Extract personality (everything until <scenario>, <example_dialogs>, or <UserPersona> tag, whichever comes first)
    const scenarioIndex = contentAfterMarker.indexOf('<scenario>');
    const exampleDialogsIndex = contentAfterMarker.indexOf('<example_dialogs>');
    const userPersonaIndex = contentAfterMarker.indexOf('<UserPersona>');
    
    // Find which tag comes first (or if only one exists)
    let personalityEndIndex = -1;
    const tagPositions = [
      { name: 'scenario', index: scenarioIndex },
      { name: 'example_dialogs', index: exampleDialogsIndex },
      { name: 'UserPersona', index: userPersonaIndex }
    ].filter(tag => tag.index !== -1).sort((a, b) => a.index - b.index);
    
    if (tagPositions.length === 0) {
      throw new Error('No <scenario>, <example_dialogs>, or <UserPersona> tag found');
    }
    
    const firstTag = tagPositions[0]!;
    personalityEndIndex = firstTag.index;
    logs.push(`Found ${firstTag.name} tag first at index ${personalityEndIndex}`);
    
    const personality = contentAfterMarker.substring(0, personalityEndIndex).trim();
    logs.push(`Extracted personality: "${personality.substring(0, 50)}..."`);
    
    // Extract scenario
    const scenarioMatch = contentAfterMarker.match(/<scenario>(.*?)<\/scenario>/s);
    const scenario = scenarioMatch ? scenarioMatch[1].trim() : '';
    logs.push(`Extracted scenario: "${scenario.substring(0, 50)}..."`);
    
    // Extract user persona
    const userPersonaMatch = contentAfterMarker.match(/<UserPersona>(.*?)<\/UserPersona>/s);
    const userPersona = userPersonaMatch ? userPersonaMatch[1].trim() : '';
    logs.push(`Extracted user persona: "${userPersona.substring(0, 50)}..."`);
    
    // Extract example dialogue
    const exampleDialogueMatch = contentAfterMarker.match(/<example_dialogs>(.*?)<\/example_dialogs>/s);
    const exampleDialogue = exampleDialogueMatch ? exampleDialogueMatch[1].trim() : '';
    logs.push(`Extracted example dialogue: "${exampleDialogue.substring(0, 50)}..."`);
    
    // Extract summary if present
    const summaryMatch = contentAfterMarker.match(/<summary>(.*?)<\/summary>/s);
    const summary = summaryMatch ? summaryMatch[1].trim() : '';
    if (summary) {
      logs.push(`Found summary: "${summary.substring(0, 50)}..."`);
    } else {
      logs.push('No summary tag found');
    }
    
    let characterName = '';
    
    // For imports, preserve {{char}} and {{user}} placeholders
    // Skip name detection if these placeholders are present
    if (personality.includes('{{char}}') || personality.includes('{{user}}') || 
        scenario.includes('{{char}}') || scenario.includes('{{user}}') ||
        exampleDialogue.includes('{{char}}') || exampleDialogue.includes('{{user}}')) {
      logs.push('Found {{char}} or {{user}} placeholders - preserving for multi-persona use');
      characterName = ''; // Leave empty, user will provide name
    } else {
      // Only try to detect names if no placeholders are present
      const namePatterns = [
        /(?:I am|I'm|My name is|Call me)\s+([A-Z][a-zA-Z\s]+?)(?:\.|,|\n|$)/i,
        /^([A-Z][a-zA-Z\s]+?)(?:\s+is|,)/,
      ];
      
      for (const pattern of namePatterns) {
        const match = personality.match(pattern);
        if (match && match[1]) {
          characterName = match[1].trim();
          logs.push(`Detected character name from personality: ${characterName}`);
          break;
        }
      }
      
      if (!characterName) {
        logs.push('No character name detected - user will need to provide one');
      }
    }
    
    // Extract chat messages (skip system message and initial "." user message)
    const chatMessages = requestData.messages.slice(2); // Skip system and "." messages
    logs.push(`Found ${chatMessages.length} chat messages to import`);
    
    // Find the assistant's first message
    const firstAssistantMessage = chatMessages.find((msg: any) => msg.role === 'assistant');
    const assistantFirstMessage = firstAssistantMessage ? firstAssistantMessage.content : '';
    logs.push(`Assistant first message: "${assistantFirstMessage.substring(0, 50)}..."`);
    
    // Extract persona name from ALL user messages in the request (not just chat messages)
    // Look for the most recent user message to get the current persona name
    let detectedPersonaName = '';
    const allUserMessages = requestData.messages.filter((msg: any) => msg.role === 'user');
    if (allUserMessages.length > 0) {
      // Get the most recent (last) user message to extract persona name
      const lastUserMessage = allUserMessages[allUserMessages.length - 1];
      const userContent = lastUserMessage.content;
      const colonIndex = userContent.indexOf(': ');
      if (colonIndex > 0) {
        detectedPersonaName = userContent.substring(0, colonIndex).trim();
        logs.push(`Detected persona name from most recent user message: "${detectedPersonaName}"`);
      }
    }
    
    if (!detectedPersonaName) {
      logs.push('No persona name detected from user messages');
    }

    // Always replace detected persona name with {{user}} in character data
    // This makes the character data reusable across different personas
    let finalPersonality = personality;
    let finalScenario = scenario;
    let finalExampleDialogue = exampleDialogue;
    let finalFirstMessage = assistantFirstMessage.trim();
    
    if (detectedPersonaName && detectedPersonaName.trim()) {
      // Create a regex that matches the exact persona name (escape special regex characters)
      const personaNameRegex = new RegExp(detectedPersonaName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      
      finalPersonality = personality.replace(personaNameRegex, '{{user}}');
      finalScenario = scenario.replace(personaNameRegex, '{{user}}');
      finalExampleDialogue = exampleDialogue.replace(personaNameRegex, '{{user}}');
      finalFirstMessage = assistantFirstMessage.trim().replace(personaNameRegex, '{{user}}');
      
      logs.push(`Converted persona name "${detectedPersonaName}" to {{user}} in character data`);
      logs.push(`Replacement applied to: personality(${personality.length}→${finalPersonality.length}), scenario(${scenario.length}→${finalScenario.length}), exampleDialogue(${exampleDialogue.length}→${finalExampleDialogue.length}), firstMessage(${assistantFirstMessage.length}→${finalFirstMessage.length})`);
    } else {
      logs.push('No persona name replacement applied - no persona name detected');
    }

    // Determine if this import has substantial chat history beyond the initial setup
    // This is just for informational purposes and doesn't affect processing
    const hasSubstantialChat = chatMessages.length > 2 || 
      (chatMessages.length === 2 && 
       !chatMessages.some((msg: any) => {
         if (msg.role === 'user') {
           const content = msg.content.trim();
           // Check if it's just "." or similar
           if (content.length <= 2) return true;
           // Check if it's in format "PersonaName: ." where the actual message is minimal
           const colonIndex = content.indexOf(': ');
           if (colonIndex > 0) {
             const actualMessage = content.substring(colonIndex + 2).trim();
             return actualMessage.length <= 2; // Message after colon is just "." or similar
           }
         }
         return false;
       }));
    
    logs.push(`Chat analysis: ${hasSubstantialChat ? 'Substantial chat history detected' : 'Minimal/setup chat detected'} (${chatMessages.length} chat messages)`);
    
    const parsedData = {
      characterData: {
        name: characterName,
        personality: finalPersonality,
        scenario: finalScenario,
        exampleDialogue: finalExampleDialogue,
        firstMessage: finalFirstMessage
      },
      userPersona,
      detectedPersonaName,
      chatMessages,
      summary,
      hasSubstantialChat
    };
    
    logs.push('Data parsing completed successfully!');
    console.log('Parsed import data:', parsedData);
    return { data: parsedData, logs };
    
  } catch (error) {
    console.error('Error parsing import data:', error);
    logs.push(`ERROR: ${error instanceof Error ? error.message : 'Unknown error'}`);
    throw { error, logs };
  }
}

async function getPasswordVersion(): Promise<number> {
  try {
    const setting = await prisma.setting.findUnique({ where: { key: 'authPasswordVersion' } });
    return setting ? parseInt(setting.value, 10) || 1 : 1;
  } catch {
    return 1;
  }
}

const FALLBACK_JWT_SECRET = process.env.JWT_SECRET || 'dev-fallback-insecure-secret-change-me';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Security Hardening (Item 9): Remove blanket wildcard CORS. This endpoint is intended for same-origin use.
  // If future external tool posting is required, implement explicit origin allowlist & possibly auth token.
  // We still answer preflight gracefully but do not emit Access-Control-Allow-Origin unless policy added.
  res.setHeader('Vary', 'Origin');
  const origin = req.headers.origin as string | undefined;
  // Allowlist: environment variable IMPORT_ALLOWED_ORIGINS (comma-separated) OR default to janitorai.com only
  const allowedOrigins = (process.env.IMPORT_ALLOWED_ORIGINS || 'https://janitorai.com')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);
  const isAllowedOrigin = !!origin && allowedOrigins.includes(origin);
  if (isAllowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  
  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(204).end();
  }
  
  if (req.method === 'POST') {
    // Validate Bearer token (middleware exempted cookie here)
    try {
      const authz = req.headers['authorization'] || req.headers['Authorization'] as string | undefined;
      if (!authz || typeof authz !== 'string') {
  return res.status(401).json({ error: 'Missing Authorization header' });
      }
      const m = authz.match(/^Bearer\s+([A-Za-z0-9_-]{20,})$/i);
      if (!m) {
  return res.status(401).json({ error: 'Invalid Authorization header format' });
      }
      const supplied = m[1]!;
      const version = await getPasswordVersion();
      const expected = await getCachedImportToken(version, FALLBACK_JWT_SECRET);
      if (supplied !== expected) {
  return res.status(401).json({ error: 'Invalid bearer token' });
      }
    } catch (e) {
      return res.status(500).json({ error: 'Auth validation failed' });
    }
    const ip = clientIp(req as any);
    const rl = limiters.importReceive(ip);
    if (!rl.allowed) {
      return tooManyRequests(res, 'Import receive rate limit exceeded', 'RATE_LIMITED', rl.retryAfterSeconds);
    }
    try {
      console.log('[Import] Received POST data at /import/receive:', JSON.stringify(req.body, null, 2));
      
      // Parse the import data from the request
      const parseResult = parseChatData(req.body);
      
      // Store in memory for the client to pick up
      (global as any).latestImport = {
        data: parseResult.data,
        imported: true,
        timestamp: Date.now(),
        logs: parseResult.logs
      };
      
      console.log('[Import] Successfully parsed and stored import data');
      
      // Return a simple success response
      return res.status(200).json({
        success: true,
        message: 'Import data received and parsed successfully'
      });
      
    } catch (errorObj: any) {
      console.error('[Import] Error processing import data:', errorObj);
      
      // Store error logs for the client to see
      const logs = errorObj.logs || [`Error: ${errorObj.error?.message || errorObj.message || 'Unknown error'}`];
      (global as any).latestImport = {
        imported: false,
        timestamp: Date.now(),
        logs: logs
      };
      
      return res.status(400).json({
        success: false,
        error: 'Failed to parse import data',
        details: errorObj.error?.message || errorObj.message || 'Unknown error',
        logs: logs
      });
    }
  }
  
  res.setHeader('Allow', ['POST', 'OPTIONS']);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}
