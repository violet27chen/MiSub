import { describe, it, expect, vi } from 'vitest';
import {
    getCache,
    resolveCacheTtlWindows,
    resolveEffectiveCacheTtlSeconds
} from '../../functions/services/node-cache-service.js';
import { resolveNodeListWithCache } from '../../functions/modules/subscription/cache-manager.js';

describe('per-subscription cache lifetime', () => {
    describe('resolveEffectiveCacheTtlSeconds', () => {
        it('takes the shortest lifetime across the group', () => {
            expect(resolveEffectiveCacheTtlSeconds([
                { nodeCacheTtlSeconds: 900 },
                { nodeCacheTtlSeconds: 60 },
                { nodeCacheTtlSeconds: 1800 }
            ])).toBe(60);
        });

        it('ignores unset and invalid values', () => {
            expect(resolveEffectiveCacheTtlSeconds([
                {},
                { nodeCacheTtlSeconds: undefined },
                { nodeCacheTtlSeconds: null },
                { nodeCacheTtlSeconds: 0 },
                { nodeCacheTtlSeconds: -5 },
                { nodeCacheTtlSeconds: 'abc' }
            ])).toBeUndefined();
        });

        it('tolerates non-array input', () => {
            expect(resolveEffectiveCacheTtlSeconds(undefined)).toBeUndefined();
            expect(resolveEffectiveCacheTtlSeconds(null)).toBeUndefined();
        });
    });

    describe('resolveCacheTtlWindows', () => {
        it('falls back to defaults when unset', () => {
            expect(resolveCacheTtlWindows(undefined))
                .toEqual({ freshTtl: 180000, staleTtl: 3600000, maxAge: 43200000 });
        });

        it('keeps the three windows ordered for a custom lifetime', () => {
            const w = resolveCacheTtlWindows(300);
            expect(w.freshTtl).toBe(300000);
            expect(w.staleTtl).toBeGreaterThan(w.freshTtl);
            expect(w.maxAge).toBeGreaterThan(w.staleTtl);
        });

        it('clamps to the supported range', () => {
            expect(resolveCacheTtlWindows(1).freshTtl).toBe(60000);
            expect(resolveCacheTtlWindows(999999).freshTtl).toBe(43200000);
        });
    });

    describe('getCache honours the override', () => {
        const entry = (ageMs) => ({
            nodes: 'trojan://password@1.2.3.4:443#HK',
            timestamp: Date.now() - ageMs,
            nodeCount: 1
        });

        it('expires a short-lived entry sooner when the subscription asks for less', async () => {
            const storage = { get: vi.fn().mockResolvedValue(entry(90 * 1000)) };
            // 90 seconds old: comfortably fresh under the 3-minute default...
            expect((await getCache(storage, 'k')).status).toBe('fresh');
            // ...but already stale once the airport asked for a 1-minute lifetime.
            expect((await getCache(storage, 'k', 60)).status).toBe('stale');
        });

        it('misses entirely once the short lifetime has elapsed', async () => {
            const storage = { get: vi.fn().mockResolvedValue(entry(30 * 60 * 1000)) };
            // 30 minutes old: comfortably inside the default windows...
            expect((await getCache(storage, 'k')).status).toBe('stale');
            // ...but long past expiry once the airport asked for 1 minute.
            expect((await getCache(storage, 'k', 60)).status).toBe('miss');
        });

        it('still hits inside a short lifetime', async () => {
            const storage = { get: vi.fn().mockResolvedValue(entry(30 * 1000)) };
            expect((await getCache(storage, 'k', 60)).status).toBe('fresh');
        });
    });

    describe('resolveNodeListWithCache passes the lifetime through', () => {
        it('refreshes when the subscription lifetime has lapsed', async () => {
            const refreshNodes = vi.fn().mockResolvedValue('trojan://password@1.2.3.4:443#HK');
            const storage = {
                get: vi.fn().mockResolvedValue({
                    nodes: 'trojan://password@9.9.9.9:443#STALE',
                    timestamp: Date.now() - 30 * 60 * 1000,
                    nodeCount: 1
                })
            };

            const result = await resolveNodeListWithCache({
                storageAdapter: storage,
                cacheKey: 'node_cache_profile_x',
                forceRefresh: false,
                refreshNodes,
                context: {},
                targetMisubsCount: 1,
                cacheTtlSeconds: 60
            });

            // Expired under the short lifetime, so the stale node is dropped.
            expect(refreshNodes).toHaveBeenCalledTimes(1);
            expect(result.combinedNodeList).toContain('1.2.3.4');
            expect(result.combinedNodeList).not.toContain('9.9.9.9');
        });

        it('serves the cache when no lifetime is configured', async () => {
            const refreshNodes = vi.fn();
            const storage = {
                get: vi.fn().mockResolvedValue({
                    nodes: 'trojan://password@1.2.3.4:443#HK',
                    timestamp: Date.now() - 30 * 60 * 1000,
                    nodeCount: 1
                })
            };

            const result = await resolveNodeListWithCache({
                storageAdapter: storage,
                cacheKey: 'node_cache_profile_x',
                forceRefresh: false,
                refreshNodes,
                context: {},
                targetMisubsCount: 1
            });

            expect(refreshNodes).not.toHaveBeenCalled();
            expect(result.cacheHeaders['X-Cache-Status']).toBe('REFRESHING');
        });
    });
});