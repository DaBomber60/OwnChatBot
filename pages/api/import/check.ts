import type { NextApiRequest, NextApiResponse } from 'next';
import { methodNotAllowed } from '../../../lib/apiErrors';

// Import latestImport from receive.ts (we'll need to share this state)
// In a production environment, you'd use a proper database or Redis
let latestImport: {
  data?: any;
  imported: boolean;
  timestamp: number;
  logs: string[];
} | null = null;

// We need to share the latestImport state between receive.ts and this file
// For now, we'll use a simple approach with a getter function
const getLatestImport = () => {
  // In a real implementation, this would be shared state or database lookup
  // For now, we'll use the same pattern as the original files
  try {
    // Try to get the import data from the receive endpoint's memory
    // This is a simplified approach for the demo
    return (global as any).latestImport || null;
  } catch {
    return null;
  }
};

const setLatestImport = (value: any) => {
  (global as any).latestImport = value;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return methodNotAllowed(res, req.method);
  }

  try {
    // Get the latest import data
    const latestImport = getLatestImport();
    
    if (!latestImport) {
      return res.status(200).json({ imported: false, logs: [] });
    }
    
    if (latestImport.imported && latestImport.data) {
      // Return the import data and clean up
      const importData = latestImport.data;
      const logs = latestImport.logs || [];
      setLatestImport(null); // Clear after retrieval
      return res.status(200).json({ imported: true, data: importData, logs: logs });
    }
    
    // Return any logs even if not yet imported (for error cases)
    return res.status(200).json({ imported: false, logs: latestImport.logs || [] });
    
  } catch (error) {
    console.error('Error checking import status:', error);
    return res.status(500).json({ error: 'Failed to check import status' });
  }
}
