import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../../../lib/prisma';
import { requireAuth } from '../../../../../lib/apiAuth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireAuth(req, res))) return;
  const { id } = req.query;
  const messageId = Array.isArray(id) ? parseInt(id[0]!) : parseInt(id as string);

  if (isNaN(messageId)) {
    return res.status(400).json({ error: 'Invalid message ID' });
  }

  if (req.method === 'GET') {
    try {
      // Add retry logic to handle race condition where variant is being saved
      let latestVariant = null;
      let retryCount = 0;
      const maxRetries = 3;
      
      while (!latestVariant && retryCount < maxRetries) {
        latestVariant = await prisma.messageVersion.findFirst({
          where: { messageId },
          orderBy: { version: 'desc' }
        });
        
        if (!latestVariant && retryCount < maxRetries - 1) {
          // Wait a bit before retrying to allow database write to complete
          await new Promise(resolve => setTimeout(resolve, 50));
          retryCount++;
        } else {
          break;
        }
      }
      
      if (!latestVariant) {
        return res.status(404).json({ error: 'No variants found' });
      }
      
      return res.status(200).json(latestVariant);
    } catch (error) {
      console.error('Error fetching latest variant:', error);
      return res.status(500).json({ error: 'Failed to fetch latest variant' });
    }
  }

  if (req.method === 'DELETE') {
    // Disable DELETE for latest variant - stopped variants are not saved automatically
    console.log(`Rejecting DELETE request for latest variant of message ${messageId} - stopped variants are not saved to database`);
    return res.status(410).json({ 
      error: 'DELETE /latest is deprecated. Stopped variants are not saved to the database automatically.',
      solution: 'Listen for status messages from the streaming API instead of trying to delete variants.',
      statusMessages: ['variant_saved', 'variant_not_saved']
    });
  }

  res.setHeader('Allow', ['GET', 'DELETE']);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}
