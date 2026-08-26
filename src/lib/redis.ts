import Redis from 'ioredis';
import { createHash } from 'crypto';

/** 对 token 取 SHA256 前 16 位，用于按用户分 key */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 16);
}

const REDIS_HOST = process.env.FLORA_REDIS_HOST;
const REDIS_PORT = parseInt(process.env.FLORA_REDIS_PORT || '6379', 10);

// 单例 Redis 客户端，无 FLORA_REDIS_HOST 时不初始化（优雅降级）
let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (!REDIS_HOST) return null;
  if (!redis) {
    redis = new Redis({
      host: REDIS_HOST,
      port: REDIS_PORT,
      lazyConnect: true,
      enableOfflineQueue: false, // 无连接时立即失败，避免命令无限排队导致 API pending
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 3) return null; // 重试 3 次后放弃
        return Math.min(times * 200, 2000);
      },
    });
    // 异步连接，不阻塞模块加载
    redis.connect().catch((err) => {
      console.warn('[redis] 连接失败，缓存功能降级:', err.message);
    });
  }
  return redis;
}

// ---- SWR 存储格式 ----
interface CacheEntry<T> {
  _d: T;          // 实际数据
  _t: number;     // 写入时间戳 (ms)
}

function serializeCache<T>(data: T, cachedAt: number): string {
  const entry: CacheEntry<T> = { _d: data, _t: cachedAt };
  return JSON.stringify(entry);
}

function deserializeCache<T>(str: string | null): { data: T; cachedAt: number } | null {
  if (!str) return null;
  try {
    const parsed = JSON.parse(str);
    if (parsed && typeof parsed._t === 'number') {
      return { data: parsed._d as T, cachedAt: parsed._t };
    }
    // 兼容旧格式：无时间戳的纯数据视为刚刚写入
    return { data: parsed as T, cachedAt: Date.now() };
  } catch {
    return null;
  }
}

/** 格式化毫秒时长为人可读格式 */
function formatAge(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}min`;
}

// 请求合并：同一 key 的并发 miss 只回源一次
const inflight = new Map<string, Promise<unknown>>();

// 后台刷新防重：同一 key 只有一个刷新任务在跑
const refreshing = new Set<string>();

// 内存缓存（作为 Redis 的备选方案）
const memoryCache = new Map<string, { data: unknown; expiresAt: number }>();

// 清理过期的内存缓存（每分钟）
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of memoryCache.entries()) {
    if (value.expiresAt < now) {
      memoryCache.delete(key);
    }
  }
}, 60_000);

// ---- 后台预刷新：定时扫描全局缓存，在软过期前主动更新 ----
interface PrefetchRegistration {
  key: string;
  fetcher: () => Promise<unknown>;
  ttlSeconds: number;
  softTtlSeconds: number;
}

const prefetchKeys = new Map<string, PrefetchRegistration>();
let prefetchTimer: ReturnType<typeof setInterval> | null = null;

/** 注册需要后台预刷新的全局缓存 key（不区分用户的数据） */
export function registerPrefetch(
  key: string,
  fetcher: () => Promise<unknown>,
  ttlSeconds: number,
  softTtlSeconds?: number,
): void {
  const softTtl = softTtlSeconds ?? Math.floor(ttlSeconds * 0.5);

  if (prefetchKeys.has(key)) {
    console.warn(`[redis] prefetch key "${key}" 重复注册，将被覆盖`);
  }

  prefetchKeys.set(key, { key, fetcher, ttlSeconds, softTtlSeconds: softTtl });
  // console.log(`[redis] 注册预刷新 key=${key} | TTL=${ttlSeconds}s | 软过期=${softTtl}s`);

  // 首次注册时自动启动定时器
  if (!prefetchTimer) {
    startPrefetchLoop();
  }
}

function startPrefetchLoop(): void {
  if (prefetchTimer) return;

  const INTERVAL_MS = 15_000; // 每 15 秒扫描一次

  prefetchTimer = setInterval(async () => {
    const client = getRedis();
    if (!client || prefetchKeys.size === 0) return;

    for (const entry of prefetchKeys.values()) {
      try {
        const cached = await client.get(entry.key);
        const parsed = cached ? deserializeCache(cached) : null;
        const age = parsed ? Date.now() - parsed.cachedAt : Infinity;
        const softTtlMs = entry.softTtlSeconds * 1000;

        if (age >= softTtlMs) {
          // console.log(`[redis] 预刷新 key=${entry.key} | 已缓存${formatAge(Math.max(0, age))}`);
          const data = await entry.fetcher();
          await client.setex(entry.key, entry.ttlSeconds, serializeCache(data, Date.now()));
          // console.log(`[redis] 预刷新完成 key=${entry.key} | 新TTL=${entry.ttlSeconds}s`);
        }
      } catch (err) {
        console.warn(`[redis] 预刷新失败 key=${entry.key}:`, (err as Error).message);
      }
    }
  }, INTERVAL_MS);

  // 不阻止进程退出
  if (typeof prefetchTimer === 'object' && 'unref' in prefetchTimer) {
    prefetchTimer.unref();
  }
}

/** 从缓存读取，miss 时执行 fetcher 回源并写入缓存 */
export async function cacheGetOrSet<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlSeconds: number = 300,
  softTtlSeconds?: number,
): Promise<T> {
  const softTtlMs = (softTtlSeconds ?? Math.floor(ttlSeconds * 0.5)) * 1000;
  const hardTtlMs = ttlSeconds * 1000;

  // 检查内存缓存（优先于 Redis，确保本地环境也能工作）
  const memEntry = memoryCache.get(key);
  if (memEntry && memEntry.expiresAt > Date.now()) {
    return memEntry.data as T;
  }

  const client = getRedis();
  if (!client) {
    // Redis 不可用时，直接回源并设置内存缓存
    const data = await fetcher();
    memoryCache.set(key, { data, expiresAt: Date.now() + hardTtlMs });
    return data;
  }

  try {
    const cached = await client.get(key);
    if (cached !== null) {
      const entry = deserializeCache<T>(cached);
      if (entry) {
        const age = Date.now() - entry.cachedAt;

        // 同步到内存缓存
        memoryCache.set(key, { data: entry.data, expiresAt: Date.now() + hardTtlMs });

        // 新鲜 → 直接返回
        if (age < softTtlMs) {
          // console.log(
          //   `[redis] 缓存命中 key=${key} | 已缓存${formatAge(age)} | 剩余新鲜${formatAge(softTtlMs - age)}`,
          // );
          return entry.data;
        }

        // 软过期但未硬过期 → 返回旧数据 + 后台异步刷新
        if (age < hardTtlMs) {
          // console.log(
          //   `[redis] 缓存过期但可用 key=${key} | 已缓存${formatAge(age)} | 后台刷新中`,
          // );
          if (!refreshing.has(key)) {
            refreshing.add(key);
            fetcher()
              .then((data) => {
                client.setex(key, ttlSeconds, serializeCache(data, Date.now()));
                memoryCache.set(key, { data, expiresAt: Date.now() + hardTtlMs });
              })
              .catch((err) =>
                console.warn('[redis] 后台刷新失败:', (err as Error).message),
              )
              .finally(() => refreshing.delete(key));
          }
          return entry.data;
        }
      }
      // 硬过期或旧格式解析失败 → 走回源
    }

    // ---- 缓存完全 miss → 请求合并回源 ----
    const existing = inflight.get(key);
    if (existing) {
      return existing as Promise<T>;
    }

    const promise = fetcher()
      .then((data) => {
        memoryCache.set(key, { data, expiresAt: Date.now() + hardTtlMs });
        client
          .setex(key, ttlSeconds, serializeCache(data, Date.now()))
          .catch((err) => {
            console.warn('[redis] 写入缓存失败:', (err as Error).message);
          });
        return data;
      })
      .finally(() => {
        inflight.delete(key);
      });

    inflight.set(key, promise);
    return promise as Promise<T>;
  } catch (err) {
    console.warn('[redis] 缓存操作失败，回退到直连:', (err as Error).message);
    const data = await fetcher();
    memoryCache.set(key, { data, expiresAt: Date.now() + hardTtlMs });
    return data;
  }
}

/** 清除指定 key 的缓存 */
export async function cacheDel(key: string): Promise<void> {
  // 始终清除内存缓存（无论 Redis 是否可用）
  memoryCache.delete(key);
  
  const client = getRedis();
  if (!client) return;
  try {
    await client.del(key);
  } catch (err) {
    console.warn('[redis] 删除缓存失败:', (err as Error).message);
  }
}

export async function cacheSet<T>(key: string, data: T, ttlSeconds: number): Promise<void> {
  // 始终设置内存缓存（无论 Redis 是否可用）
  memoryCache.set(key, { data, expiresAt: Date.now() + ttlSeconds * 1000 });
  
  const client = getRedis();
  if (!client) return;
  try {
    await client.setex(key, ttlSeconds, serializeCache(data, Date.now()));
  } catch (err) {
    console.warn('[redis] 写入缓存失败:', (err as Error).message);
  }
}

export { getRedis };
