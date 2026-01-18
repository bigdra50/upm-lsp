/**
 * Local Package Registry
 *
 * Reads package information from local file paths (file: protocol).
 * Supports "file:../relative/path" and "file:/absolute/path" formats.
 */

import * as fs from "fs/promises";
import * as path from "path";

import { PackageInfo } from "../types";
import { RegistryClient, Cache } from "./registryClient";
import {
  parseFileReference,
  resolveFileReference,
  isFileReference,
  validateFileReferenceFormat,
  getDisplayPath,
} from "../utils/fileReference";

/**
 * Local package reference info
 */
export interface LocalPackageInfo {
  /** Original file: reference */
  reference: string;
  /** Resolved absolute path */
  absolutePath: string;
  /** Whether path exists */
  exists: boolean;
  /** Package info if found */
  packageInfo: PackageInfo | null;
}

/**
 * Local Package Registry Client
 * Reads packages from local filesystem via file: protocol
 */
export class LocalPackageRegistryClient implements RegistryClient {
  readonly name = "local";

  private packageCache: Cache<LocalPackageInfo>;
  private manifestDir: string | null = null;

  constructor(cacheTtlMs: number = 5 * 60 * 1000) {
    // 5 min cache (local files may change during development)
    this.packageCache = new Cache<LocalPackageInfo>(cacheTtlMs);
  }

  /**
   * Set the manifest directory for resolving relative paths
   * Clears cache when directory changes to avoid stale data
   */
  setManifestDir(dir: string): void {
    if (this.manifestDir !== dir) {
      this.packageCache.clear();
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
   * Read package.json from a local directory
   * Single I/O operation - readFile throws if file doesn't exist
   */
  private async readPackageJson(packageDir: string): Promise<PackageInfo | null> {
    const packageJsonPath = path.join(packageDir, "package.json");

    try {
      const content = await fs.readFile(packageJsonPath, "utf-8");
      const json = JSON.parse(content);

      return {
        name: json.name,
        version: json.version,
        displayName: json.displayName,
        description: json.description,
        unity: json.unity,
        unityRelease: json.unityRelease,
        dependencies: json.dependencies,
        keywords: json.keywords,
        author: json.author,
        documentationUrl: json.documentationUrl,
        changelogUrl: json.changelogUrl,
        licensesUrl: json.licensesUrl,
      };
    } catch {
      return null;
    }
  }

  /**
   * Check if a path exists and is a directory
   */
  private async directoryExists(dirPath: string): Promise<boolean> {
    try {
      const stat = await fs.stat(dirPath);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Resolve and validate a file: reference
   * Uses common utilities for parsing and validation
   */
  async resolveReference(reference: string): Promise<LocalPackageInfo> {
    const cacheKey = `${this.manifestDir}:${reference}`;
    const cached = this.packageCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Use common validation utility
    const validation = validateFileReferenceFormat(reference);
    if (!validation.valid) {
      const result: LocalPackageInfo = {
        reference,
        absolutePath: "",
        exists: false,
        packageInfo: null,
      };
      return result;
    }

    const manifestDir = this.manifestDir || process.cwd();
    const absolutePath = resolveFileReference(reference, manifestDir);

    if (!absolutePath) {
      const result: LocalPackageInfo = {
        reference,
        absolutePath: "",
        exists: false,
        packageInfo: null,
      };
      return result;
    }

    // Parallelize directory check and package.json read
    const [exists, packageInfo] = await Promise.all([
      this.directoryExists(absolutePath),
      this.readPackageJson(absolutePath),
    ]);

    const result: LocalPackageInfo = {
      reference,
      absolutePath,
      exists,
      packageInfo,
    };

    this.packageCache.set(cacheKey, result);
    return result;
  }

  /**
   * Get package info from a file: reference
   * Note: packageName here is actually the full "file:..." reference
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
   * as long as package.json exists. The actual version in package.json
   * is used regardless of what's specified in manifest.json.
   *
   * @param reference - The file: reference
   * @param _version - Ignored for local packages (Unity behavior)
   */
  async versionExists(reference: string, _version: string): Promise<boolean> {
    if (!isFileReference(reference)) {
      return false;
    }

    const resolved = await this.resolveReference(reference);
    // Local packages are valid if package.json exists
    return resolved.packageInfo !== null;
  }

  /**
   * Get version from local package.json
   * Returns array with single version if found
   */
  async getVersions(reference: string): Promise<string[]> {
    if (!isFileReference(reference)) {
      return [];
    }

    const resolved = await this.resolveReference(reference);
    if (resolved.packageInfo?.version) {
      return [resolved.packageInfo.version];
    }
    return [];
  }

  /**
   * List subdirectories for path completion
   */
  async listDirectories(basePath: string): Promise<string[]> {
    // Use common validation for the path format
    const validation = validateFileReferenceFormat(`file:${basePath}`);
    if (!validation.valid) {
      return [];
    }

    const manifestDir = this.manifestDir || process.cwd();
    const absolutePath = resolveFileReference(`file:${basePath}`, manifestDir);

    if (!absolutePath) {
      return [];
    }

    try {
      const entries = await fs.readdir(absolutePath, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map((entry) => entry.name);
    } catch {
      return [];
    }
  }

  /**
   * Check if a directory contains package.json
   * Uses single I/O operation (stat instead of access)
   */
  async hasPackageJson(dirPath: string): Promise<boolean> {
    // Use common validation for the path format
    const validation = validateFileReferenceFormat(`file:${dirPath}`);
    if (!validation.valid) {
      return false;
    }

    const manifestDir = this.manifestDir || process.cwd();
    const absolutePath = resolveFileReference(`file:${dirPath}`, manifestDir);

    if (!absolutePath) {
      return false;
    }

    const packageJsonPath = path.join(absolutePath, "package.json");

    try {
      const stat = await fs.stat(packageJsonPath);
      return stat.isFile();
    } catch {
      return false;
    }
  }

  /**
   * Search is not applicable for local packages
   */
  async searchPackages(_query: string): Promise<PackageInfo[]> {
    return [];
  }

  clearCache(): void {
    this.packageCache.clear();
  }
}
