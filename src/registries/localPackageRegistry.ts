/**
 * Local Package Registry Client
 *
 * Adapter that implements RegistryClient interface using:
 * - Pure functions from localPackage.ts
 * - I/O operations from localPackageIO.ts
 * - Immutable cache from utils/cache.ts
 */

import { PackageInfo } from "../types";
import { RegistryClient } from "./registryClient";
import {
  LocalPackageInfo,
  ResolveContext,
  isFileReference,
  getCacheKey,
  emptyInfo,
} from "./localPackage";
import {
  resolveAndFetch,
  hasPackageJsonFile,
  listSubdirectories,
} from "./localPackageIO";
import * as Cache from "../utils/cache";

// Re-export for backward compatibility
export { LocalPackageInfo };

/**
 * Local Package Registry Client
 * Reads packages from local filesystem via file: protocol
 */
export class LocalPackageRegistryClient implements RegistryClient {
  readonly name = "local";

  private cache: Cache.ImmutableCache<LocalPackageInfo>;
  private readonly cacheTtlMs: number;
  private manifestDir: string | null = null;

  constructor(cacheTtlMs: number = 5 * 60 * 1000) {
    this.cacheTtlMs = cacheTtlMs;
    this.cache = Cache.empty();
  }

  /**
   * Set the manifest directory for resolving relative paths
   * Clears cache when directory changes to avoid stale data
   */
  setManifestDir(dir: string): void {
    if (this.manifestDir !== dir) {
      this.cache = Cache.empty();
    }
    this.manifestDir = dir;
  }

  /**
   * Get manifest directory
   */
  getManifestDir(): string | null {
    return this.manifestDir;
  }

  /**
   * Get current resolve context
   */
  private getContext(): ResolveContext {
    return {
      manifestDir: this.manifestDir || process.cwd(),
    };
  }

  /**
   * Resolve and validate a file: reference
   */
  async resolveReference(reference: string): Promise<LocalPackageInfo> {
    const ctx = this.getContext();
    const cacheKey = getCacheKey(ctx.manifestDir, reference);

    // Check cache first
    const cached = Cache.get(this.cache, cacheKey);
    if (cached) {
      return cached;
    }

    // Resolve using I/O layer
    const result = await resolveAndFetch(ctx)(reference);

    // Update cache immutably
    this.cache = Cache.set(this.cache, cacheKey, result, this.cacheTtlMs);

    return result;
  }

  /**
   * Get package info from a file: reference
   */
  async getPackageInfo(reference: string): Promise<PackageInfo | null> {
    if (!isFileReference(reference)) {
      return null;
    }

    const resolved = await this.resolveReference(reference);
    return resolved.packageInfo;
  }

  /**
   * Check if a file: reference path exists
   */
  async packageExists(reference: string): Promise<boolean> {
    if (!isFileReference(reference)) {
      return false;
    }

    const resolved = await this.resolveReference(reference);
    return resolved.exists;
  }

  /**
   * Check if the referenced package has a valid package.json
   *
   * Note: For local packages, version parameter is ignored.
   * Unity treats local packages as always having a valid version
   * as long as package.json exists.
   */
  async versionExists(reference: string, _version: string): Promise<boolean> {
    if (!isFileReference(reference)) {
      return false;
    }

    const resolved = await this.resolveReference(reference);
    return resolved.packageInfo !== null;
  }

  /**
   * Get version from local package.json
   */
  async getVersions(reference: string): Promise<string[]> {
    if (!isFileReference(reference)) {
      return [];
    }

    const resolved = await this.resolveReference(reference);
    return resolved.packageInfo?.version
      ? [resolved.packageInfo.version]
      : [];
  }

  /**
   * List subdirectories for path completion
   */
  async listDirectories(basePath: string): Promise<string[]> {
    const ctx = this.getContext();
    const dirs = await listSubdirectories(ctx, basePath);
    return [...dirs]; // Convert to mutable array for interface compatibility
  }

  /**
   * Check if a directory contains package.json
   */
  async hasPackageJson(dirPath: string): Promise<boolean> {
    const ctx = this.getContext();
    return hasPackageJsonFile(ctx, dirPath);
  }

  /**
   * Search is not applicable for local packages
   */
  async searchPackages(_query: string): Promise<PackageInfo[]> {
    return [];
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache = Cache.empty();
  }
}
