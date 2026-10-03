/**
 * 节点缓存服务
 * 解决订阅拉取超时问题：缓存节点数据，快速响应客户端请求
 * @author MiSub Team
 */

/**
 * 缓存配置
 * 策略：仅首次缓存 - 首次同步获取，后续返回缓存+后台刷新
 */
const CACHE_CONFIG = {
    KEY_PREFIX: 'node_cache_',           // 缓存键前缀
    FRESH_TTL: 3 * 60 * 1000,            // 新鲜期：3 分钟（命中时不触发后台刷新）
    STALE_TTL: 60 * 60 * 1000,           // 可用期：1 小时（超过后同步获取）
    MAX_AGE: 12 * 60 * 60 * 1000,        // 最大缓存时间：12 小时
    BACKGROUND_REFRESH_TIMEOUT: 25000,   // 后台刷新超时：25 秒
    MIN_TTL: 60 * 1000,                  // 允许的最小新鲜期：1 分钟
    MAX_TTL: 12 * 60 * 60 * 1000         // 允许的最大可用期：12 小时
};

/**
 * 把订阅上手填的缓存时长（秒）规范化为可供 getCache 使用的三个窗口。
 * 订阅未设置或数值非法时回退到全局默认值。
 *
 * 部分机场会轮换节点池，缓存过久会累积已下线的节点并表现为延迟超时，
 * 因此这类订阅可以把时长调短，让节点更快跟上机场的变更。
 *
 * 注意 resolveNodeListWithCache 对 stale 与 expired 的处理完全一致（都返回旧值
 * 并在后台刷新），只有 miss 才会同步重新拉取。所以这里刻意把可用期收得很紧：
 * 用户设定的时长是「节点最多可能有多旧」的上限，而不是仅仅多久才触发一次后台刷新。
 *
 * @param {number|undefined|null} ttlSeconds 订阅设置的缓存时长（秒）
 * @returns {{freshTtl:number, staleTtl:number, maxAge:number}}
 */
export function resolveCacheTtlWindows(ttlSeconds) {
    const defaults = {
        freshTtl: CACHE_CONFIG.FRESH_TTL,
        staleTtl: CACHE_CONFIG.STALE_TTL,
        maxAge: CACHE_CONFIG.MAX_AGE
    };

    const parsed = Number(ttlSeconds);
    if (!Number.isFinite(parsed) || parsed <= 0) return defaults;

    const freshTtl = Math.min(Math.max(parsed * 1000, CACHE_CONFIG.MIN_TTL), CACHE_CONFIG.MAX_TTL);
    // fresh 内直接命中；再宽一倍的窗口内返回旧值并后台刷新；
    // 超过 maxAge 则丢弃缓存、同步拉取，保证不会长期供应陈旧节点。
    const staleTtl = Math.min(freshTtl * 2, CACHE_CONFIG.MAX_AGE);
    const maxAge = Math.min(freshTtl * 3, CACHE_CONFIG.MAX_AGE);

    return { freshTtl, staleTtl, maxAge };
}

/**
 * 取一组订阅中最短的新鲜期。订阅组里只要有一个机场会轮换节点池，
 * 整个订阅组的缓存就不该比它更久，否则被拖慢的那个机场会积累死节点。
 *
 * @param {Array<Object|null|undefined>} subs
 * @returns {number|undefined} 秒；没有任何订阅设置时返回 undefined
 */
export function resolveEffectiveCacheTtlSeconds(subs) {
    if (!Array.isArray(subs)) return undefined;

    const values = subs
        .map(sub => Number(sub?.nodeCacheTtlSeconds))
        .filter(value => Number.isFinite(value) && value > 0);

    return values.length > 0 ? Math.min(...values) : undefined;
}

/**
 * 生成缓存键
 * @param {string} type - 缓存类型 ('profile' | 'token')
 * @param {string} identifier - 标识符
 * @returns {string} 缓存键
 */
export function generateCacheKey(type, identifier) {
    return `${CACHE_CONFIG.KEY_PREFIX}${type}_${identifier}`;
}

function isSubscriptionNodeCacheKey(key) {
    return typeof key === 'string'
        && (
            key.startsWith(`${CACHE_CONFIG.KEY_PREFIX}subscription_`)
            || key.startsWith(`${CACHE_CONFIG.KEY_PREFIX}subscription_url_`)
        );
}

/**
 * 缓存数据结构
 * @typedef {Object} CacheEntry
 * @property {string} nodes - Base64 编码的节点列表
 * @property {number} timestamp - 缓存时间戳
 * @property {number} nodeCount - 节点数量
 * @property {string[]} sources - 来源订阅名称列表
 */

/**
 * 获取缓存
 * @param {Object} storageAdapter - 存储适配器
 * @param {string} cacheKey - 缓存键
 * @param {number} [ttlSeconds] - 订阅自定义的新鲜期（秒），缺省用全局配置
 * @returns {Promise<{data: CacheEntry|null, status: 'fresh'|'stale'|'expired'|'miss'}>}
 */
export async function getCache(storageAdapter, cacheKey, ttlSeconds) {
    try {
        const cached = await storageAdapter.get(cacheKey);
        if (!cached) {
            return { data: null, status: 'miss' };
        }

        const { freshTtl, staleTtl, maxAge } = resolveCacheTtlWindows(ttlSeconds);
        const now = Date.now();
        const age = now - cached.timestamp;

        if (age < freshTtl) {
            return { data: cached, status: 'fresh' };
        } else if (age < staleTtl) {
            return { data: cached, status: 'stale' };
        } else if (age < maxAge) {
            return { data: cached, status: 'expired' };
        } else {
            return { data: null, status: 'miss' };
        }
    } catch (error) {
        console.error('[Cache] Failed to get cache:', error);
        return { data: null, status: 'miss' };
    }
}

/**
 * 设置缓存
 * @param {Object} storageAdapter - 存储适配器
 * @param {string} cacheKey - 缓存键
 * @param {string} nodes - 节点列表字符串
 * @param {string[]} sources - 来源订阅名称列表
 * @returns {Promise<boolean>}
 */
export async function setCache(storageAdapter, cacheKey, nodes, sources = []) {
    try {
        const nodeCount = nodes.split('\n').filter(line => line.trim()).length;
        if (nodeCount === 0) {
            const existing = await storageAdapter.get(cacheKey);
            const existingNodeCount = existing?.nodeCount || String(existing?.nodes || '').split('\n').filter(line => line.trim()).length;
            if (existingNodeCount > 0) {
                console.warn(`[Cache] Refusing to overwrite non-empty cache ${cacheKey} with empty node list`);
                return false;
            }
        }

        const cacheEntry = {
            nodes,
            timestamp: Date.now(),
            nodeCount,
            sources
        };

        // 计算 TTL（秒），使用 MAX_AGE 作为过期时间
        const ttlSeconds = Math.ceil(CACHE_CONFIG.MAX_AGE / 1000);

        // 尝试使用 KV 原生 TTL
        if (storageAdapter.kv && typeof storageAdapter.kv.put === 'function') {
            await storageAdapter.kv.put(cacheKey, JSON.stringify(cacheEntry), {
                expirationTtl: ttlSeconds
            });
        } else {
            // 降级：使用普通 put（无 TTL）
            await storageAdapter.put(cacheKey, cacheEntry);
        }


        return true;
    } catch (error) {
        console.error('[Cache] Failed to set cache:', error);
        return false;
    }
}

/**
 * 触发后台刷新（使用 waitUntil）
 * @param {Object} context - Cloudflare 上下文
 * @param {Function} refreshFn - 刷新函数
 */
export function triggerBackgroundRefresh(context, refreshFn) {
    if (context && typeof context.waitUntil === 'function') {
        // 使用 waitUntil 在响应后继续执行
        const refreshPromise = Promise.race([
            refreshFn(),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Background refresh timeout')), CACHE_CONFIG.BACKGROUND_REFRESH_TIMEOUT)
            )
        ]).catch(error => {
            console.warn('[Cache] Background refresh failed:', error.message);
        });

        context.waitUntil(refreshPromise);

    } else {
        // 降级：不等待刷新完成
        console.warn('[Cache] waitUntil not available, skipping background refresh');
    }
}

/**
 * 创建缓存响应头
 * @param {string} status - 缓存状态
 * @param {number} nodeCount - 节点数量
 * @returns {Object} 响应头对象
 */
export function createCacheHeaders(status, nodeCount) {
    return {
        'X-Cache-Status': status,
        'X-Node-Count': String(nodeCount),
        'X-Cache-Time': new Date().toISOString()
    };
}

/**
 * 获取缓存配置（供外部使用）
 */
export function getCacheConfig() {
    return { ...CACHE_CONFIG };
}

/**
 * 清除指定缓存
 * @param {Object} storageAdapter - 存储适配器
 * @param {string} cacheKey - 缓存键
 * @returns {Promise<boolean>}
 */
export async function clearCache(storageAdapter, cacheKey) {
    try {
        await storageAdapter.delete(cacheKey);

        return true;
    } catch (error) {
        console.error('[Cache] Failed to clear cache:', error);
        return false;
    }
}

/**
 * 清除所有节点缓存
 * @param {Object} storageAdapter - 存储适配器
 * @returns {Promise<{cleared: number, failed: number}>}
 */
export async function clearAllNodeCaches(storageAdapter, options = {}) {
    try {
        let cleared = 0;
        let failed = 0;
        let skipped = 0;
        let cursor = null;
        const preserveKeys = new Set(
            Array.isArray(options?.preserveKeys)
                ? options.preserveKeys.filter(isSubscriptionNodeCacheKey)
                : []
        );

        // 循环处理分页，KV list 默认最多返回 1000 个 key
        do {
            let keys = [];
            let listComplete = true;

            // 判断存储适配器类型并正确调用
            if (storageAdapter.kv && typeof storageAdapter.kv.list === 'function') {
                // 直接使用 KV namespace
                const listOptions = { prefix: CACHE_CONFIG.KEY_PREFIX };
                if (cursor) {
                    listOptions.cursor = cursor;
                }
                const result = await storageAdapter.kv.list(listOptions);
                keys = result.keys || [];
                cursor = result.list_complete ? null : result.cursor;
                listComplete = result.list_complete !== false;
            } else if (typeof storageAdapter.list === 'function') {
                // 使用适配器的 list 方法（KVStorageAdapter 或 D1StorageAdapter）
                // 注意：适配器的 list 方法接受 prefix 字符串参数
                const result = await storageAdapter.list(CACHE_CONFIG.KEY_PREFIX);
                keys = Array.isArray(result) ? result : (result.keys || []);
                cursor = null; // 适配器可能不支持分页，一次性返回所有
                listComplete = true;
            } else {
                console.warn('[Cache] Storage adapter does not support list operation');
                break;
            }

            // 删除缓存
            for (const keyInfo of keys) {
                const key = typeof keyInfo === 'string' ? keyInfo : (keyInfo.name || keyInfo);
                if (preserveKeys.has(key)) {
                    skipped++;
                    continue;
                }
                try {
                    if (storageAdapter.kv && typeof storageAdapter.kv.delete === 'function') {
                        await storageAdapter.kv.delete(key);
                    } else {
                        await storageAdapter.delete(key);
                    }
                    cleared++;
                } catch {
                    failed++;
                }
            }

            // 如果列表完成或没有更多数据，退出循环
            if (listComplete || keys.length === 0) {
                cursor = null;
            }
        } while (cursor);


        return { cleared, failed, skipped };
    } catch (error) {
        console.error('[Cache] Failed to clear all caches:', error);
        return { cleared: 0, failed: 0, skipped: 0 };
    }
}

/**
 * 使指定 Profile 或 Token 的缓存失效
 * @param {Object} storageAdapter - 存储适配器
 * @param {string[]} profileIds - Profile ID 列表
 * @param {string} token - Token（可选）
 * @returns {Promise<number>} 清除的缓存数量
 */
export async function invalidateCaches(storageAdapter, profileIds = [], token = null) {
    let clearedCount = 0;

    // 清除 Profile 缓存
    for (const profileId of profileIds) {
        const cacheKey = generateCacheKey('profile', profileId);
        if (await clearCache(storageAdapter, cacheKey)) {
            clearedCount++;
        }
    }

    // 清除 Token 缓存（主订阅）
    if (token) {
        const cacheKey = generateCacheKey('token', token);
        if (await clearCache(storageAdapter, cacheKey)) {
            clearedCount++;
        }
    }

    return clearedCount;
}
