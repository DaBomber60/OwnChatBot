import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../lib/prisma';
import { IncomingForm, Fields, Files } from 'formidable';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import JSZip from 'jszip';
import { requireAuth } from '../../../lib/apiAuth';
import { limiters, clientIp } from '../../../lib/rateLimit';
import { tooManyRequests, methodNotAllowed } from '../../../lib/apiErrors';

// Disable Next.js body parser for file uploads and increase size limits
export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
    // Increase the default body size limit for large imports (Next.js 13+)
    externalResolver: true,
  },
};

interface ImportData {
  version: string;
  exportedAt: string;
  data: {
    personas: any[];
    characterGroups: any[];
    characters: any[];
    chatSessions: any[];
    chatMessages: any[];
    messageVersions: any[];
    userPrompts: any[];
    settings: any[];
  };
  metadata?: any;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireAuth(req, res))) return;
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return methodNotAllowed(res, req.method);
  }

  const ip = clientIp(req as any);
  const rl = limiters.dbImport(ip);
  if (!rl.allowed) {
    return tooManyRequests(res, 'Database import rate limit exceeded', 'RATE_LIMITED', rl.retryAfterSeconds);
  }

  try {
    // Use a dedicated temp directory to avoid cross-device rename issues
    const uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hcb-import-'));
    
    const form = new IncomingForm({
      maxFileSize: 500 * 1024 * 1024, // 500MB limit for zip files
      maxFieldsSize: 500 * 1024 * 1024, // 500MB for form fields
      maxTotalFileSize: 500 * 1024 * 1024, // total file size limit (formidable v3)
      maxFields: 1000,
      keepExtensions: true,
      multiples: false,
      uploadDir, // explicit temp dir
      allowEmptyFiles: false,
      hashAlgorithm: false, // skip hashing for faster uploads
    });
    
    const { files } = await new Promise<{ files: Files }>((resolve, reject) => {
      form.parse(req, (err: any, fields: Fields, files: Files) => {
        if (err) {
          console.error('[database/import] Formidable parse error:', err.code, err.httpCode, err.message);
          reject(err);
        } else {
          resolve({ files });
        }
      });
    });

    const uploadedFile = Array.isArray(files.file) ? files.file[0] : files.file;
    
    if (!uploadedFile) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Determine file type and process accordingly
    const fileName = uploadedFile.originalFilename || uploadedFile.newFilename || '';
    const isZipFile = fileName.toLowerCase().endsWith('.zip');
    const isJsonFile = fileName.toLowerCase().endsWith('.json');

    if (!isZipFile && !isJsonFile) {
      return res.status(400).json({ 
        error: 'Invalid file type',
        details: 'Please upload a .zip or .json export file'
      });
    }

    let fileContent: string;

    if (isZipFile) {
      // Handle ZIP file
      try {
        const zipBuffer = await fs.readFile(uploadedFile.filepath);
        const zip = new JSZip();
        const loadedZip = await zip.loadAsync(zipBuffer);
        
        // Look for database.json in the zip
        const databaseFile = loadedZip.file('database.json');
        if (!databaseFile) {
          return res.status(400).json({ 
            error: 'Invalid zip file format',
            details: 'Zip file must contain database.json'
          });
        }
        
        fileContent = await databaseFile.async('text');
      } catch (zipError) {
        return res.status(400).json({ 
          error: 'Failed to read zip file',
          details: zipError instanceof Error ? zipError.message : 'Could not extract zip contents'
        });
      }
    } else {
      // Handle JSON file (legacy)
      fileContent = await fs.readFile(uploadedFile.filepath, 'utf-8');
    }
    let importData: ImportData;

    try {
      importData = JSON.parse(fileContent);
    } catch (parseError) {
      return res.status(400).json({ 
        error: 'Invalid JSON file format',
        details: parseError instanceof Error ? parseError.message : 'Could not parse JSON'
      });
    }

    // Validate file size and provide feedback
    const fileSizeBytes = Buffer.byteLength(fileContent, 'utf-8');
    const fileSizeMB = (fileSizeBytes / (1024 * 1024)).toFixed(1);
    
    console.log(`Processing import file: ${fileSizeMB}MB`);

    // Validate the import data structure
    if (!importData.data || !importData.version) {
      return res.status(400).json({ 
        error: 'Invalid export file format',
        details: 'File must contain data and version fields'
      });
    }

    const results = {
      imported: {
        personas: 0,
        characterGroups: 0,
        characters: 0,
        chatSessions: 0,
        chatMessages: 0,
        messageVersions: 0,
        userPrompts: 0,
        settings: 0
      },
      skipped: {
        personas: 0,
        characterGroups: 0,
        characters: 0,
        chatSessions: 0,
        chatMessages: 0,
        messageVersions: 0,
        userPrompts: 0,
        settings: 0
      },
      errors: [] as string[]
    };

    // Import data in dependency order to maintain referential integrity
    
    // 1. Import CharacterGroups first (no dependencies)
    if (importData.data.characterGroups?.length) {
      for (const group of importData.data.characterGroups) {
        try {
          const existing = await prisma.characterGroup.findUnique({
            where: { name: group.name }
          });
          
          if (!existing) {
            await prisma.characterGroup.create({
              data: {
                name: group.name,
                color: group.color,
                isCollapsed: group.isCollapsed,
                sortOrder: group.sortOrder,
                createdAt: new Date(group.createdAt),
                updatedAt: new Date(group.updatedAt)
              }
            });
            results.imported.characterGroups++;
          } else {
            results.skipped.characterGroups++;
          }
        } catch (error) {
          results.errors.push(`CharacterGroup '${group.name}': ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
    }

    // 2. Import Personas (no dependencies)
    if (importData.data.personas?.length) {
      for (const persona of importData.data.personas) {
        try {
          const existing = await prisma.persona.findFirst({
            where: {
              name: persona.name,
              profileName: persona.profileName
            }
          });
          
          if (!existing) {
            await prisma.persona.create({
              data: {
                name: persona.name,
                profileName: persona.profileName,
                profile: persona.profile,
                createdAt: new Date(persona.createdAt),
                updatedAt: new Date(persona.updatedAt)
              }
            });
            results.imported.personas++;
          } else {
            results.skipped.personas++;
          }
        } catch (error) {
          results.errors.push(`Persona '${persona.name}': ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
    }

    // 3. Import Characters (depends on CharacterGroups)
    if (importData.data.characters?.length) {
      for (const character of importData.data.characters) {
        try {
          const existing = await prisma.character.findFirst({
            where: {
              name: character.name,
              profileName: character.profileName
            }
          });
          
          if (!existing) {
            // Find the group by name if groupId exists
            let groupId = null;
            if (character.groupId) {
              const group = await prisma.characterGroup.findFirst({
                where: { name: importData.data.characterGroups?.find(g => g.id === character.groupId)?.name }
              });
              groupId = group?.id || null;
            }

            await prisma.character.create({
              data: {
                name: character.name,
                profileName: character.profileName,
                bio: character.bio,
                scenario: character.scenario,
                personality: character.personality,
                firstMessage: character.firstMessage,
                exampleDialogue: character.exampleDialogue,
                groupId: groupId,
                sortOrder: character.sortOrder,
                createdAt: new Date(character.createdAt),
                updatedAt: new Date(character.updatedAt)
              }
            });
            results.imported.characters++;
          } else {
            results.skipped.characters++;
          }
        } catch (error) {
          results.errors.push(`Character '${character.name}': ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
    }

    // 4. Import UserPrompts (no dependencies)
    if (importData.data.userPrompts?.length) {
      for (const prompt of importData.data.userPrompts) {
        try {
          const existing = await prisma.userPrompt.findUnique({
            where: { title: prompt.title }
          });
          
          if (!existing) {
            await prisma.userPrompt.create({
              data: {
                title: prompt.title,
                body: prompt.body,
                createdAt: new Date(prompt.createdAt),
                updatedAt: new Date(prompt.updatedAt)
              }
            });
            results.imported.userPrompts++;
          } else {
            results.skipped.userPrompts++;
          }
        } catch (error) {
          results.errors.push(`UserPrompt '${prompt.title}': ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
    }

    // 5. Import Settings (skip sensitive auth-related keys)
    if (importData.data.settings?.length) {
      const SENSITIVE_SETTING_KEYS = new Set([
        'authPassword',
        'authPasswordVersion',
        'authJwtSecret'
      ]);
      for (const setting of importData.data.settings) {
        if (SENSITIVE_SETTING_KEYS.has(setting.key)) {
          // Skip importing sensitive credential / secret values to avoid overwriting local auth config
          results.skipped.settings++;
          continue;
        }
        try {
          const existing = await prisma.setting.findUnique({
            where: { key: setting.key }
          });

          if (existing) {
            // Update existing setting
            await prisma.setting.update({
              where: { key: setting.key },
              data: { 
                value: setting.value,
                updatedAt: new Date()
              }
            });
            results.skipped.settings++;
          } else {
            // Create new setting
            await prisma.setting.create({
              data: {
                key: setting.key,
                value: setting.value,
                createdAt: new Date(setting.createdAt),
                updatedAt: new Date(setting.updatedAt)
              }
            });
            results.imported.settings++;
          }
        } catch (error) {
          results.errors.push(`Setting '${setting.key}': ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
    }

    // Process imports in batches to handle large datasets more efficiently
    const BATCH_SIZE = 100; // Process records in batches of 100

    // Helper function to process arrays in batches
    const processBatch = async <T>(
      items: T[], 
      processor: (item: T) => Promise<void>
    ) => {
      for (let i = 0; i < items.length; i += BATCH_SIZE) {
        const batch = items.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(processor));
        
        // Small delay to prevent overwhelming the database
        if (i + BATCH_SIZE < items.length) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }
    };

    // Create lookup maps for better performance
    const personaLookup = new Map();
    const characterLookup = new Map();
    const sessionLookup = new Map();
    const messageLookup = new Map();

    // 6. Import ChatSessions (depends on Personas and Characters)
    if (importData.data.chatSessions?.length) {
      // First, get all existing personas and characters for lookup
      const existingPersonas = await prisma.persona.findMany();
      const existingCharacters = await prisma.character.findMany();

      existingPersonas.forEach(p => {
        const key = `${p.name}|${p.profileName || ''}`;
        personaLookup.set(key, p);
      });

      existingCharacters.forEach(c => {
        const key = `${c.name}|${c.profileName || ''}`;
        characterLookup.set(key, c);
      });

      for (const session of importData.data.chatSessions) {
        try {
          // Find persona and character using lookup maps
          const originalPersona = importData.data.personas?.find(p => p.id === session.personaId);
          const originalCharacter = importData.data.characters?.find(c => c.id === session.characterId);

          if (!originalPersona || !originalCharacter) {
            results.errors.push(`ChatSession: Missing original persona or character data`);
            continue;
          }

          const personaKey = `${originalPersona.name}|${originalPersona.profileName || ''}`;
          const characterKey = `${originalCharacter.name}|${originalCharacter.profileName || ''}`;

          const persona = personaLookup.get(personaKey);
          const character = characterLookup.get(characterKey);

          if (persona && character) {
            const existing = await prisma.chatSession.findFirst({
              where: {
                personaId: persona.id,
                characterId: character.id,
                createdAt: new Date(session.createdAt)
              }
            });

            if (!existing) {
              const newSession = await prisma.chatSession.create({
                data: {
                  personaId: persona.id,
                  characterId: character.id,
                  lastApiRequest: session.lastApiRequest,
                  summary: session.summary,
                  description: session.description,
                  lastSummary: session.lastSummary,
                  notes: session.notes,
                  createdAt: new Date(session.createdAt),
                  updatedAt: new Date(session.updatedAt)
                }
              });
              
              // Store session mapping for messages import
              sessionLookup.set(session.id, newSession);
              results.imported.chatSessions++;
            } else {
              sessionLookup.set(session.id, existing);
              results.skipped.chatSessions++;
            }
          } else {
            results.errors.push(`ChatSession: Missing persona (${originalPersona.name}) or character (${originalCharacter.name}) reference`);
          }
        } catch (error) {
          results.errors.push(`ChatSession: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
    }

    // 7. Import ChatMessages (depends on ChatSessions)
    if (importData.data.chatMessages?.length) {
      for (const message of importData.data.chatMessages) {
        try {
          const importedSession = sessionLookup.get(message.sessionId);
          if (!importedSession) {
            results.errors.push(`ChatMessage: Could not find imported session for message ${message.id}`);
            continue;
          }

          // Check if message already exists (by content, role, and timestamp)
          const existing = await prisma.chatMessage.findFirst({
            where: {
              sessionId: importedSession.id,
              role: message.role,
              content: message.content,
              createdAt: new Date(message.createdAt)
            }
          });

          if (!existing) {
            const newMessage = await prisma.chatMessage.create({
              data: {
                sessionId: importedSession.id,
                role: message.role,
                content: message.content,
                createdAt: new Date(message.createdAt)
              }
            });

            // Store message mapping for versions import
            messageLookup.set(message.id, newMessage);
            results.imported.chatMessages++;
          } else {
            messageLookup.set(message.id, existing);
            results.skipped.chatMessages++;
          }
        } catch (error) {
          results.errors.push(`ChatMessage ${message.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
    }

    // 8. Import MessageVersions (depends on ChatMessages)
    if (importData.data.messageVersions?.length) {
      for (const version of importData.data.messageVersions) {
        try {
          const importedMessage = messageLookup.get(version.messageId);
          if (!importedMessage) {
            results.errors.push(`MessageVersion: Could not find imported message for version ${version.id}`);
            continue;
          }

          // Check if version already exists
          const existing = await prisma.messageVersion.findFirst({
            where: {
              messageId: importedMessage.id,
              version: version.version,
              content: version.content
            }
          });

          if (!existing) {
            await prisma.messageVersion.create({
              data: {
                messageId: importedMessage.id,
                content: version.content,
                version: version.version,
                isActive: version.isActive,
                createdAt: new Date(version.createdAt)
              }
            });
            results.imported.messageVersions++;
          } else {
            results.skipped.messageVersions++;
          }
        } catch (error) {
          results.errors.push(`MessageVersion ${version.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Database import completed',
      results,
      summary: {
        totalImported: Object.values(results.imported).reduce((a, b) => a + b, 0),
        totalSkipped: Object.values(results.skipped).reduce((a, b) => a + b, 0),
        totalErrors: results.errors.length
      }
    });

  } catch (error) {
    console.error('Database import error:', error);
    return res.status(500).json({
      error: 'Failed to import database',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
