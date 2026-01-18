/**
 * Unity Official Registry Client
 * Endpoint: https://packages.unity.com
 */

import { PackageInfo } from "../types";
import {
  NpmRegistryClient,
  RegistryError,
  RegistryErrorCode,
} from "./registryClient";

/**
 * npm registry /-/all response format
 */
interface NpmAllPackagesResponse {
  [packageName: string]: NpmPackageEntry | number;
  _updated: number;
}

interface NpmPackageEntry {
  name: string;
  description?: string;
  "dist-tags"?: {
    latest?: string;
  };
  versions?: Record<string, NpmVersionInfo>;
}

interface NpmVersionInfo {
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
}

/**
 * npm registry /{packageName} response format
 */
interface NpmPackageDetailResponse {
  name: string;
  description?: string;
  "dist-tags": {
    latest: string;
  };
  versions: Record<string, NpmVersionInfo>;
}

/**
 * Unity Official Registry (packages.unity.com)
 */
export class UnityRegistryClient extends NpmRegistryClient {
  readonly name = "Unity Registry";
  protected readonly baseUrl = "https://packages.unity.com";

  /**
   * Get all packages from the registry
   */
  private async getAllPackages(): Promise<PackageInfo[]> {
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

      const pkg = entry as NpmPackageEntry;
      const latestVersion = pkg["dist-tags"]?.latest;
      const versionInfo = latestVersion
        ? pkg.versions?.[latestVersion]
        : undefined;

      packages.push({
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
      });
    }

    this.packageListCache.set(cacheKey, packages);
    return packages;
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

      const latestVersion = data["dist-tags"].latest;
      const versionInfo = data.versions[latestVersion];

      if (!versionInfo) {
        return null;
      }

      const packageInfo: PackageInfo = {
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

      // Sort versions in descending order (newest first)
      const versions = Object.keys(data.versions).sort((a, b) => {
        return compareVersions(b, a);
      });

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
}

/**
 * Compare semver versions
 * Returns negative if a < b, positive if a > b, 0 if equal
 */
function compareVersions(a: string, b: string): number {
  const partsA = a.split(/[.-]/).map((p) => (isNaN(Number(p)) ? p : Number(p)));
  const partsB = b.split(/[.-]/).map((p) => (isNaN(Number(p)) ? p : Number(p)));

  const maxLen = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < maxLen; i++) {
    const partA = partsA[i] ?? 0;
    const partB = partsB[i] ?? 0;

    // Numeric comparison
    if (typeof partA === "number" && typeof partB === "number") {
      if (partA !== partB) {
        return partA - partB;
      }
      continue;
    }

    // String comparison (pre-release tags)
    const strA = String(partA);
    const strB = String(partB);
    if (strA !== strB) {
      // Pre-release versions are less than release versions
      if (typeof partA === "string" && typeof partB === "number") return -1;
      if (typeof partA === "number" && typeof partB === "string") return 1;
      return strA.localeCompare(strB);
    }
  }

  return 0;
}
