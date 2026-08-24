import prisma from '../../../lib/prisma';
import { IncomingForm, Fields, Files } from 'formidable';
import { promises as fs } from 'fs';
import { createHash } from 'crypto';
import path from 'path';
import os from 'os';
import JSZip from 'jszip';
import { limiters, clientIp } from '../../../lib/rateLimit';
import { badRequest, serverError, tooManyRequests } from '../../../lib/apiErrors';
import { withApiHandler } from '../../../lib/withApiHandler';

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

const CHARACTER_FINGERPRINT_FIELDS = [
  'name',
  'profileName',
  'bio',
  'scenario',
  'personality',
  'firstMessage',
  'exampleDialogue'
] as const;

// Identity is (name, profileName); the fingerprint decides whether the bodies also agree.
function characterFingerprint(character: any): string {
  const canonical = CHARACTER_FINGERPRINT_FIELDS.map(field => String(character?.[field] ?? ''));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

async function nextImportProfileName(name: string, base: string | null): Promise<string | null> {
  for (let n = 1; n <= 100; n++) {
    const candidate = base ? `${base} (import ${n})` : `import ${n}`;
    const clash = await prisma.character.findFirst({ where: { name, profileName: candidate } });
    if (!clash) return candidate;
  }
  return null;
}

export default withApiHandler({}, {
  POST: async (req, res) => {
    const ip = clientIp(req as any);
    const rl = limiters.dbImport(ip);
    if (!rl.allowed) {
      return tooManyRequests(res, 'Database import rate limit exceeded', 'RATE_LIMITED', rl.retryAfterSeconds);
    }

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
    
    const { fields, files } = await new Promise<{ fields: Fields; files: Files }>((resolve, reject) => {
      form.parse(req, (err: any, fields: Fields, files: Files) => {
        if (err) {
          console.error('[database/import] Formidable parse error:', err.code, err.httpCode, err.message);
          reject(err);
        } else {
          resolve({ fields, files });
        }
      });
    });

    const rawImportSettings = Array.isArray(fields.importSettings) ? fields.importSettings[0] : fields.importSettings;
    // Absent field means an older client: keep the previous behaviour and import settings.
    const importSettingsEnabled = rawImportSettings !== 'false';

    const uploadedFile = Array.isArray(files.file) ? files.file[0] : files.file;
    
    if (!uploadedFile) {
      return badRequest(res, 'No file uploaded', 'NO_FILE');
    }

    // Determine file type and process accordingly
    const fileName = uploadedFile.originalFilename || uploadedFile.newFilename || '';
    const isZipFile = fileName.toLowerCase().endsWith('.zip');
    const isJsonFile = fileName.toLowerCase().endsWith('.json');

    if (!isZipFile && !isJsonFile) {
      return badRequest(res, 'Invalid file type', 'INVALID_FILE_TYPE', {
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
          return badRequest(res, 'Invalid zip file format', 'INVALID_ZIP', {
            details: 'Zip file must contain database.json'
          });
        }
        
        fileContent = await databaseFile.async('text');
      } catch (zipError) {
        return badRequest(res, 'Failed to read zip file', 'ZIP_READ_FAILED', {
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
      return badRequest(res, 'Invalid JSON file format', 'INVALID_JSON', {
        details: parseError instanceof Error ? parseError.message : 'Could not parse JSON'
      });
    }

    // Validate file size and provide feedback
    const fileSizeBytes = Buffer.byteLength(fileContent, 'utf-8');
    const fileSizeMB = (fileSizeBytes / (1024 * 1024)).toFixed(1);
    
    console.log(`Processing import file: ${fileSizeMB}MB`);

    // Validate the import data structure
    if (!importData.data || !importData.version) {
      return badRequest(res, 'Invalid export file format', 'INVALID_FORMAT', {
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
      renamedCharacters: [] as string[],
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
    const personaIdMap = new Map<number, number>();
    if (importData.data.personas?.length) {
      for (const persona of importData.data.personas) {
        try {
          const existing = await prisma.persona.findFirst({
            where: {
              name: persona.name,
              profileName: persona.profileName ?? null
            }
          });
          
          if (!existing) {
            const created = await prisma.persona.create({
              data: {
                name: persona.name,
                profileName: persona.profileName,
                profile: persona.profile,
                createdAt: new Date(persona.createdAt),
                updatedAt: new Date(persona.updatedAt)
              }
            });
            personaIdMap.set(persona.id, created.id);
            results.imported.personas++;
          } else {
            personaIdMap.set(persona.id, existing.id);
            results.skipped.personas++;
          }
        } catch (error) {
          results.errors.push(`Persona '${persona.name}': ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
    }

    // 3. Import Characters (depends on CharacterGroups)
    const characterIdMap = new Map<number, number>();
    if (importData.data.characters?.length) {
      for (const character of importData.data.characters) {
        try {
          const existing = await prisma.character.findFirst({
            where: {
              name: character.name,
              profileName: character.profileName ?? null
            }
          });

          if (existing && characterFingerprint(existing) === characterFingerprint(character)) {
            characterIdMap.set(character.id, existing.id);
            results.skipped.characters++;
            continue;
          }

          let profileName: string | null = character.profileName ?? null;
          if (existing) {
            const renamed = await nextImportProfileName(character.name, profileName);
            if (!renamed) {
              results.errors.push(`Character '${character.name}': could not allocate a free profile name for the differing imported copy`);
              continue;
            }
            profileName = renamed;
            results.renamedCharacters.push(`${character.name}: imported as profile "${renamed}" (content differs from the existing character)`);
          }

          // Find the group by name if groupId exists
          let groupId = null;
          if (character.groupId) {
            const group = await prisma.characterGroup.findFirst({
              where: { name: importData.data.characterGroups?.find(g => g.id === character.groupId)?.name }
            });
            groupId = group?.id || null;
          }

          const created = await prisma.character.create({
            data: {
              name: character.name,
              profileName: profileName,
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
          characterIdMap.set(character.id, created.id);
          results.imported.characters++;
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
    if (importSettingsEnabled && importData.data.settings?.length) {
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

    // 6. Import ChatSessions with their whole history. A chat is all-or-nothing: if the
    // session already exists we import none of it, so two histories can never be merged.
    if (importData.data.chatSessions?.length) {
      const messagesBySession = new Map<number, any[]>();
      for (const message of importData.data.chatMessages ?? []) {
        const bucket = messagesBySession.get(message.sessionId);
        if (bucket) bucket.push(message);
        else messagesBySession.set(message.sessionId, [message]);
      }

      const versionsByMessage = new Map<number, any[]>();
      for (const version of importData.data.messageVersions ?? []) {
        const bucket = versionsByMessage.get(version.messageId);
        if (bucket) bucket.push(version);
        else versionsByMessage.set(version.messageId, [version]);
      }

      for (const session of importData.data.chatSessions) {
        const messages = messagesBySession.get(session.id) ?? [];
        const versionCount = messages.reduce((total, m) => total + (versionsByMessage.get(m.id)?.length ?? 0), 0);

        try {
          const personaId = personaIdMap.get(session.personaId);
          const characterId = characterIdMap.get(session.characterId);

          if (!personaId || !characterId) {
            results.errors.push(`ChatSession ${session.id}: missing persona or character reference`);
            continue;
          }

          const createdAt = new Date(session.createdAt);
          const existing = await prisma.chatSession.findUnique({
            where: { personaId_characterId_createdAt: { personaId, characterId, createdAt } }
          });

          if (existing) {
            results.skipped.chatSessions++;
            results.skipped.chatMessages += messages.length;
            results.skipped.messageVersions += versionCount;
            continue;
          }

          // One nested write so the session and its full history land together or not at all.
          await prisma.chatSession.create({
            data: {
              personaId,
              characterId,
              lastApiRequest: session.lastApiRequest,
              summary: session.summary,
              description: session.description,
              lastSummary: session.lastSummary,
              notes: session.notes,
              createdAt,
              updatedAt: new Date(session.updatedAt),
              messages: {
                create: messages.map(message => ({
                  role: message.role,
                  content: message.content,
                  createdAt: new Date(message.createdAt),
                  versions: {
                    create: (versionsByMessage.get(message.id) ?? []).map(version => ({
                      content: version.content,
                      version: version.version,
                      isActive: version.isActive,
                      createdAt: new Date(version.createdAt)
                    }))
                  }
                }))
              }
            }
          });

          results.imported.chatSessions++;
          results.imported.chatMessages += messages.length;
          results.imported.messageVersions += versionCount;
        } catch (error) {
          results.errors.push(`ChatSession ${session.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
  },
});
