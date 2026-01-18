/**
 * Registry Client - Base interface and cache for UPM registries
 */

import { PackageInfo } from "../types";

/**
 * Cache entry with TTL support
 */
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Generic cache with TTL support
 */
export class Cache<T> {
  private store = new Map<string, CacheEntry<T>>();

  constructor(private ttlMs: number) {}

  /**
   * Get cached value if not expired
   */
  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /**
   * Store value with TTL
   */
  set(key: string, value: T): void {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  /**
   * Check if key exists and is not expired
   */
  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  /**
   * Clear all cached entries
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Remove expired entries
   */
  prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
      }
    }
  }
}

/**
 * Registry error types
 */
export class RegistryError extends Error {
  constructor(
    message: string,
    public readonly code: RegistryErrorCode,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = "RegistryError";
  }
}

export enum RegistryErrorCode {
  NETWORK_ERROR = "NETWORK_ERROR",
  NOT_FOUND = "NOT_FOUND",
  PARSE_ERROR = "PARSE_ERROR",
  TIMEOUT = "TIMEOUT",
  RATE_LIMITED = "RATE_LIMITED",
  UNAUTHORIZED = "UNAUTHORIZED",
}

/**
 * Registry client interface
 */
export interface RegistryClient {
  /** Registry name for identification */
  readonly name: string;

  /**
   * Search packages by query
   * @param query - Search query string
   * @returns Matching packages
   */
  searchPackages(query: string): Promise<PackageInfo[]>;

  /**
   * Get detailed package information
   * @param packageName - Package identifier
   * @returns Package info or null if not found
   */
  getPackageInfo(packageName: string): Promise<PackageInfo | null>;

  /**
   * Get available versions for a package
   * @param packageName - Package identifier
   * @returns Array of version strings (semver)
   */
  getVersions(packageName: string): Promise<string[]>;

  /**
   * Clear internal cache
   */
  clearCache(): void;
}

/**
 * Base class for npm-compatible registries (Unity, OpenUPM)
 */
export abstract class NpmRegistryClient implements RegistryClient {
  abstract readonly name: string;
  protected abstract readonly baseUrl: string;

  protected packageListCache: Cache<PackageInfo[]>;
  protected packageInfoCache: Cache<PackageInfo>;
  protected versionsCache: Cache<string[]>;

  constructor(protected cacheTtlMs: number = 5 * 60 * 1000) {
    this.packageListCache = new Cache<PackageInfo[]>(cacheTtlMs);
    this.packageInfoCache = new Cache<PackageInfo>(cacheTtlMs);
    this.versionsCache = new Cache<string[]>(cacheTtlMs);
  }

  /**
   * Fetch with error handling
   */
  protected async fetchJson<T>(url: string): Promise<T> {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new RegistryError(
            `Package not found: ${url}`,
            RegistryErrorCode.NOT_FOUND
          );
        }
        if (response.status === 429) {
          throw new RegistryError(
            "Rate limited",
            RegistryErrorCode.RATE_LIMITED
          );
        }
        throw new RegistryError(
          `HTTP ${response.status}: ${response.statusText}`,
          RegistryErrorCode.NETWORK_ERROR
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof RegistryError) {
        throw error;
      }
      throw new RegistryError(
        `Network error: ${error instanceof Error ? error.message : String(error)}`,
        RegistryErrorCode.NETWORK_ERROR,
        error instanceof Error ? error : undefined
      );
    }
  }

  abstract searchPackages(query: string): Promise<PackageInfo[]>;
  abstract getPackageInfo(packageName: string): Promise<PackageInfo | null>;
  abstract getVersions(packageName: string): Promise<string[]>;

  clearCache(): void {
    this.packageListCache.clear();
    this.packageInfoCache.clear();
    this.versionsCache.clear();
  }
}
