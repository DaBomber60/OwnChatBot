import { PrismaClient } from '@prisma/client';

// Prisma Client singleton pattern to avoid exhausting DB connections during
// Next.js API route & dev hot-reload module re-evaluation.
// In production (single load) we just instantiate once. In development we
// cache on globalThis to reuse the same instance after hot reloads.

declare global {
	// eslint-disable-next-line no-var
	var __prisma__: PrismaClient | undefined;
	// Optional metrics cache (not persisted across full reloads, only hot).
	// eslint-disable-next-line no-var
	var __prismaMetrics__: { queryCount: number } | undefined;
}

const enableQueryMetrics = process.env.PRISMA_METRICS === '1';
const logLevels: any = process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'];

const prisma = globalThis.__prisma__ ?? new PrismaClient({ log: logLevels });

// Lightweight metrics (increment on each query) when enabled.
if (enableQueryMetrics) {
	const metrics = (globalThis.__prismaMetrics__ ||= { queryCount: 0 });
	// Only attach listener once.
		if (!(prisma as any).__metricsListenerAttached) {
			// Cast to any to subscribe to query events without importing Prisma.LogEvent types.
			(prisma as any).$on('query', () => {
				metrics.queryCount++;
			});
			(prisma as any).__metricsListenerAttached = true;
		}
}

if (process.env.NODE_ENV !== 'production') {
	globalThis.__prisma__ = prisma;
}

export const prismaMetrics = globalThis.__prismaMetrics__;
export default prisma;
