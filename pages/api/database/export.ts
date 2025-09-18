import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../lib/prisma';
import JSZip from 'jszip';
import { requireAuth } from '../../../lib/apiAuth';
import { limiters, clientIp } from '../../../lib/rateLimit';
import { tooManyRequests } from '../../../lib/apiErrors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireAuth(req, res))) return;
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const ip = clientIp(req as any);
  const rl = limiters.dbExport(ip);
  if (!rl.allowed) {
    return tooManyRequests(res, 'Database export rate limit exceeded', 'RATE_LIMITED', rl.retryAfterSeconds);
  }

  // Check if legacy JSON format is requested
  const format = req.query.format as string;
  const isJsonFormat = format === 'json';

  try {
    // Export all data from all tables
    const [
      personas,
      characterGroups,
      characters,
      chatSessions,
      chatMessages,
      messageVersions,
      userPrompts,
      settings
    ] = await Promise.all([
      prisma.persona.findMany({
        orderBy: { id: 'asc' }
      }),
      prisma.characterGroup.findMany({
        orderBy: { id: 'asc' }
      }),
      prisma.character.findMany({
        orderBy: { id: 'asc' }
      }),
      prisma.chatSession.findMany({
        orderBy: { id: 'asc' },
        include: {
          messages: {
            orderBy: { id: 'asc' },
            include: {
              versions: {
                orderBy: { version: 'asc' }
              }
            }
          }
        }
      }),
      prisma.chatMessage.findMany({
        orderBy: { id: 'asc' },
        include: {
          versions: {
            orderBy: { version: 'asc' }
          }
        }
      }),
      prisma.messageVersion.findMany({
        orderBy: { id: 'asc' }
      }),
      prisma.userPrompt.findMany({
        orderBy: { id: 'asc' }
      }),
      prisma.setting.findMany({
        orderBy: { key: 'asc' }
      })
    ]);

    const exportData = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      data: {
        personas,
        characterGroups,
        characters,
        chatSessions,
        chatMessages,
        messageVersions,
        userPrompts,
        settings
      },
      metadata: {
        totalRecords: {
          personas: personas.length,
          characterGroups: characterGroups.length,
          characters: characters.length,
          chatSessions: chatSessions.length,
          chatMessages: chatMessages.length,
          messageVersions: messageVersions.length,
          userPrompts: userPrompts.length,
          settings: settings.length
        }
      }
    };

    // Set headers for file download
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    
    if (isJsonFormat) {
      // Legacy JSON format
      const filename = `ownchatbot-export-${timestamp}.json`;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.status(200).json(exportData);
    } else {
      // Default ZIP format
      const zip = new JSZip();
      
      // Add the main data file
      zip.file('database.json', JSON.stringify(exportData, null, 2));
      
      // Add a readme file explaining the export
      const readmeContent = `OwnChatBot Database Export
Generated: ${new Date().toISOString()}
Format Version: ${exportData.version}

Contents:
- database.json: Complete database export in JSON format
- This file can be imported back into OwnChatBot

Total Records:
${Object.entries(exportData.metadata.totalRecords)
  .map(([key, count]) => `- ${key}: ${count}`)
  .join('\n')}

For support or questions, visit: https://github.com/DaBomber60/OwnChatBot
`;
      
      zip.file('README.txt', readmeContent);
      
      // Generate zip file
      const zipBuffer = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 9 } // Maximum compression
      });
      
      const filename = `ownchatbot-export-${timestamp}.zip`;
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', zipBuffer.length.toString());
      
      return res.status(200).send(zipBuffer);
    }

  } catch (error) {
    console.error('Database export error:', error);
    return res.status(500).json({ 
      error: 'Failed to export database',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
