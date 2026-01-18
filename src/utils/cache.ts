/**
 * Immutable cache utilities
 *
 * Functional approach to caching - each operation returns a new cache.
 */

/**
 * Cache entry with expiration
 */
export type CacheEntry<T> = {
  readonly value: T;
  readonly expires: number;
};

/**
 * Immutable cache type
 */
export type ImmutableCache<T> = ReadonlyMap<string, CacheEntry<T>>;

/**
 * Create an empty cache
 */
export const empty = <T>(): ImmutableCache<T> => new Map();

/**
 * Get a value from cache (returns null if expired or not found)
 */
export const get = <T>(cache: ImmutableCache<T>, key: string): T | null => {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expires < Date.now()) return null;
  return entry.value;
};

/**
 * Check if key exists and is not expired
 */
export const has = <T>(cache: ImmutableCache<T>, key: string): boolean =>
  get(cache, key) !== null;

/**
 * Set a value in cache - returns a new cache
 */
export const set = <T>(
  cache: ImmutableCache<T>,
  key: string,
  value: T,
  ttlMs: number
): ImmutableCache<T> =>
  new Map([
    ...cache,
    [key, { value, expires: Date.now() + ttlMs }],
  ]);

/**
 * Remove a key from cache - returns a new cache
 */
export const remove = <T>(
  cache: ImmutableCache<T>,
  key: string
): ImmutableCache<T> => {
  const next = new Map(cache);
  next.delete(key);
  return next;
};

/**
 * Remove all expired entries - returns a new cache
 */
export const prune = <T>(cache: ImmutableCache<T>): ImmutableCache<T> => {
  const now = Date.now();
  return new Map(
    [...cache].filter(([_, entry]) => entry.expires > now)
  );
};

/**
 * Get cache size (including expired entries)
 */
export const size = <T>(cache: ImmutableCache<T>): number => cache.size;

/**
 * Get count of non-expired entries
 */
export const activeSize = <T>(cache: ImmutableCache<T>): number => {
  const now = Date.now();
  return [...cache].filter(([_, entry]) => entry.expires > now).length;
};

/**
 * Map over all non-expired values
 */
export const mapValues = <T, U>(
  cache: ImmutableCache<T>,
  f: (value: T, key: string) => U
): ImmutableCache<U> => {
  const now = Date.now();
  return new Map(
    [...cache]
      .filter(([_, entry]) => entry.expires > now)
      .map(([key, entry]) => [
        key,
        { value: f(entry.value, key), expires: entry.expires },
      ])
  );
};

/**
 * Get or set - returns value and new cache
 */
export const getOrSet = <T>(
  cache: ImmutableCache<T>,
  key: string,
  getValue: () => T,
  ttlMs: number
): { value: T; cache: ImmutableCache<T> } => {
  const existing = get(cache, key);
  if (existing !== null) {
    return { value: existing, cache };
  }
  const value = getValue();
  return { value, cache: set(cache, key, value, ttlMs) };
};

/**
 * Async version of getOrSet
 */
export const getOrSetAsync = async <T>(
  cache: ImmutableCache<T>,
  key: string,
  getValue: () => Promise<T>,
  ttlMs: number
): Promise<{ value: T; cache: ImmutableCache<T> }> => {
  const existing = get(cache, key);
  if (existing !== null) {
    return { value: existing, cache };
  }
  const value = await getValue();
  return { value, cache: set(cache, key, value, ttlMs) };
};
