import prisma from '../../lib/prisma';
import { withApiHandler } from '../../lib/withApiHandler';

export default withApiHandler({ auth: false }, {
  GET: async (_req, res) => {
    try {
      // Check database connection
      await prisma.$queryRaw`SELECT 1`;
      
      res.status(200).json({ 
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: 'connected'
      });
    } catch (error) {
      res.status(503).json({ 
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        database: 'disconnected',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  },
});
