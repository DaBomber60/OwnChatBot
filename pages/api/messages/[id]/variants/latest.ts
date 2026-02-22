import prisma from '../../../../../lib/prisma';
import { notFound, gone } from '../../../../../lib/apiErrors';
import { withApiHandler } from '../../../../../lib/withApiHandler';

export default withApiHandler({ parseId: true }, {
  GET: async (_req, res, { id: messageId }) => {
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
  },

  DELETE: async (_req, res, { id: messageId }) => {
    // Disable DELETE for latest variant - stopped variants are not saved automatically
    console.log(`Rejecting DELETE request for latest variant of message ${messageId} - stopped variants are not saved to database`);
    return gone(res, 'DELETE /latest is deprecated. Stopped variants are not saved to the database automatically.', 'VARIANT_DELETE_DEPRECATED', {
      solution: 'Listen for status messages from the streaming API instead of trying to delete variants.',
      statusMessages: ['variant_saved', 'variant_not_saved']
    });
  },
});
