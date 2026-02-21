import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../../../lib/prisma';
import { requireAuth } from '../../../../../lib/apiAuth';
import { badRequest, notFound, serverError, gone, methodNotAllowed } from '../../../../../lib/apiErrors';
import { parseId } from '../../../../../lib/validate';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireAuth(req, res))) return;
  const messageId = parseId(req.query.id);

  if (messageId === null) {
    return badRequest(res, 'Invalid message ID', 'INVALID_MESSAGE_ID');
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
        return notFound(res, 'No variants found', 'NO_VARIANTS');
      }
      
      return res.status(200).json(latestVariant);
    } catch (error) {
      console.error('Error fetching latest variant:', error);
      return serverError(res, 'Failed to fetch latest variant', 'VARIANT_FETCH_FAILED');
    }
  }

  if (req.method === 'DELETE') {
    // Disable DELETE for latest variant - stopped variants are not saved automatically
    console.log(`Rejecting DELETE request for latest variant of message ${messageId} - stopped variants are not saved to database`);
    return gone(res, 'DELETE /latest is deprecated. Stopped variants are not saved to the database automatically.', 'VARIANT_DELETE_DEPRECATED', {
      solution: 'Listen for status messages from the streaming API instead of trying to delete variants.',
      statusMessages: ['variant_saved', 'variant_not_saved']
    });
  }

  res.setHeader('Allow', ['GET', 'DELETE']);
  return methodNotAllowed(res, req.method);
}
