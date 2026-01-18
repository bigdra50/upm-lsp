/**
 * Registry Client - Base interface and cache for UPM registries
 */

import { PackageInfo } from "../types";
import { sortVersionsDescending } from "./versionUtils";

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

  /**
   * Get all packages from the registry
   */
  protected async getAllPackages(): Promise<PackageInfo[]> {
    const cacheKey = "all";
    const cached = this.packageListCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const url = `${this.baseUrl}/-/all`;
    const data = await this.fetchJson<NpmAllPackagesResponse>(url);

    const packages: PackageInfo[] = [];
    for (const [key, entry] of Object.entries(data)) {
      if (key === "_updated" || typeof entry === "number") {
        continue;
      }

      const packageInfo = this.parsePackageEntry(entry as NpmPackageEntry);
      packages.push(packageInfo);
    }

    this.packageListCache.set(cacheKey, packages);
    return packages;
  }

  /**
   * Parse package entry from /-/all response
   * Override this method to customize parsing for specific registries
   */
  protected parsePackageEntry(pkg: NpmPackageEntry): PackageInfo {
    const latestVersion = pkg["dist-tags"]?.latest;
    const versionInfo = latestVersion
      ? pkg.versions?.[latestVersion]
      : undefined;

    return {
      name: pkg.name,
      version: latestVersion || "0.0.0",
      displayName: versionInfo?.displayName,
      description: pkg.description || versionInfo?.description,
      unity: versionInfo?.unity,
      unityRelease: versionInfo?.unityRelease,
      dependencies: versionInfo?.dependencies,
      keywords: versionInfo?.keywords,
      author: versionInfo?.author,
      documentationUrl: versionInfo?.documentationUrl,
      changelogUrl: versionInfo?.changelogUrl,
      licensesUrl: versionInfo?.licensesUrl,
    };
  }

  /**
   * Search packages by query
   */
  async searchPackages(query: string): Promise<PackageInfo[]> {
    const allPackages = await this.getAllPackages();

    if (!query.trim()) {
      return allPackages;
    }

    const lowerQuery = query.toLowerCase();
    return allPackages.filter(
      (pkg) =>
        pkg.name.toLowerCase().includes(lowerQuery) ||
        pkg.displayName?.toLowerCase().includes(lowerQuery) ||
        pkg.description?.toLowerCase().includes(lowerQuery) ||
        pkg.keywords?.some((kw) => kw.toLowerCase().includes(lowerQuery))
    );
  }

  /**
   * Get detailed package information
   */
  async getPackageInfo(packageName: string): Promise<PackageInfo | null> {
    const cached = this.packageInfoCache.get(packageName);
    if (cached) {
      return cached;
    }

    try {
      const url = `${this.baseUrl}/${encodeURIComponent(packageName)}`;
      const data = await this.fetchJson<NpmPackageDetailResponse>(url);

      const packageInfo = this.parsePackageDetail(data);
      if (!packageInfo) {
        return null;
      }

      this.packageInfoCache.set(packageName, packageInfo);
      return packageInfo;
    } catch (error) {
      if (
        error instanceof RegistryError &&
        error.code === RegistryErrorCode.NOT_FOUND
      ) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Parse package detail from /{packageName} response
   * Override this method to customize parsing for specific registries
   */
  protected parsePackageDetail(data: NpmPackageDetailResponse): PackageInfo | null {
    const latestVersion = data["dist-tags"].latest;
    const versionInfo = data.versions[latestVersion];

    if (!versionInfo) {
      return null;
    }

    return {
      name: data.name,
      version: latestVersion,
      displayName: versionInfo.displayName,
      description: data.description || versionInfo.description,
      unity: versionInfo.unity,
      unityRelease: versionInfo.unityRelease,
      dependencies: versionInfo.dependencies,
      keywords: versionInfo.keywords,
      author: versionInfo.author,
      documentationUrl: versionInfo.documentationUrl,
      changelogUrl: versionInfo.changelogUrl,
      licensesUrl: versionInfo.licensesUrl,
    };
  }

  /**
   * Get available versions for a package
   */
  async getVersions(packageName: string): Promise<string[]> {
    const cached = this.versionsCache.get(packageName);
    if (cached) {
      return cached;
    }

    try {
      const url = `${this.baseUrl}/${encodeURIComponent(packageName)}`;
      const data = await this.fetchJson<NpmPackageDetailResponse>(url);

      const versions = sortVersionsDescending(Object.keys(data.versions));

      this.versionsCache.set(packageName, versions);
      return versions;
    } catch (error) {
      if (
        error instanceof RegistryError &&
        error.code === RegistryErrorCode.NOT_FOUND
      ) {
        return [];
      }
      throw error;
    }
  }

  clearCache(): void {
    this.packageListCache.clear();
    this.packageInfoCache.clear();
    this.versionsCache.clear();
  }
}

/**
 * npm registry /-/all response format
 */
export interface NpmAllPackagesResponse {
  [packageName: string]: NpmPackageEntry | number;
  _updated: number;
}

export interface NpmPackageEntry {
  name: string;
  description?: string;
  "dist-tags"?: {
    latest?: string;
  };
  versions?: Record<string, NpmVersionInfo>;
}

export interface NpmVersionInfo {
  name: string;
  version: string;
  displayName?: string;
  description?: string;
  unity?: string;
  unityRelease?: string;
  dependencies?: Record<string, string>;
  keywords?: string[];
  author?: string | { name: string; email?: string; url?: string };
  documentationUrl?: string;
  changelogUrl?: string;
  licensesUrl?: string;
  repository?: { type: string; url: string } | string;
  homepage?: string;
}

/**
 * npm registry /{packageName} response format
 */
export interface NpmPackageDetailResponse {
  name: string;
  description?: string;
  "dist-tags": {
    latest: string;
  };
  versions: Record<string, NpmVersionInfo>;
  repository?: { type: string; url: string } | string;
  homepage?: string;
}
