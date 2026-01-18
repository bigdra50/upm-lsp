/**
 * GitHub Registry Client
 * Handles GitHub URL packages (https://github.com/owner/repo.git#tag?path=...)
 */

import { PackageInfo } from "../types";
import {
  RegistryClient,
  Cache,
  RegistryError,
  RegistryErrorCode,
} from "./registryClient";

/**
 * Parsed GitHub URL components
 */
export interface GitHubUrlInfo {
  owner: string;
  repo: string;
  ref?: string; // tag or branch
  path?: string; // subdirectory path
}

/**
 * GitHub API tag response
 */
interface GitHubTag {
  name: string;
  commit: {
    sha: string;
    url: string;
  };
}

/**
 * GitHub API branch response
 */
interface GitHubBranch {
  name: string;
  commit: {
    sha: string;
    url: string;
  };
}

/**
 * UPM package.json structure
 */
interface UpmPackageJson {
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
 * GitHub Registry Client
 * Fetches package info from GitHub repositories
 */
export class GitHubRegistryClient implements RegistryClient {
  readonly name = "GitHub";

  private tagsCache: Cache<string[]>;
  private branchesCache: Cache<string[]>;
  private packageInfoCache: Cache<PackageInfo>;

  private readonly githubApiUrl = "https://api.github.com";
  private readonly rawContentUrl = "https://raw.githubusercontent.com";

  constructor(
    private cacheTtlMs: number = 5 * 60 * 1000,
    private token?: string
  ) {
    this.tagsCache = new Cache<string[]>(cacheTtlMs);
    this.branchesCache = new Cache<string[]>(cacheTtlMs);
    this.packageInfoCache = new Cache<PackageInfo>(cacheTtlMs);

    // Check environment variable for token
    if (!this.token) {
      this.token = process.env.GITHUB_TOKEN;
    }
  }

  /**
   * Parse GitHub URL into components
   *
   * Supported formats:
   * - https://github.com/owner/repo.git
   * - https://github.com/owner/repo.git#tag
   * - https://github.com/owner/repo.git#tag?path=/subfolder
   * - https://github.com/owner/repo.git?path=/subfolder#tag
   */
  parseGitHubUrl(url: string): GitHubUrlInfo | null {
    // Remove trailing .git if present
    const cleanUrl = url.replace(/\.git$/, "");

    // Parse URL with potential fragment and query
    let urlPart = cleanUrl;
    let ref: string | undefined;
    let path: string | undefined;

    // Handle fragment (#tag)
    const hashIndex = cleanUrl.indexOf("#");
    if (hashIndex !== -1) {
      ref = cleanUrl.slice(hashIndex + 1);
      urlPart = cleanUrl.slice(0, hashIndex);

      // Check if ref contains query params
      const refQueryIndex = ref.indexOf("?");
      if (refQueryIndex !== -1) {
        const queryPart = ref.slice(refQueryIndex + 1);
        ref = ref.slice(0, refQueryIndex);
        path = this.parsePathFromQuery(queryPart);
      }
    }

    // Handle query params before fragment (?path=...#tag)
    const queryIndex = urlPart.indexOf("?");
    if (queryIndex !== -1) {
      const queryPart = urlPart.slice(queryIndex + 1);
      urlPart = urlPart.slice(0, queryIndex);
      path = this.parsePathFromQuery(queryPart);
    }

    // Parse owner/repo from URL
    const match = urlPart.match(
      /(?:https?:\/\/)?github\.com\/([^/]+)\/([^/?#]+)/
    );
    if (!match) {
      return null;
    }

    return {
      owner: match[1],
      repo: match[2],
      ref,
      path: path?.replace(/^\//, ""), // Remove leading slash
    };
  }

  private parsePathFromQuery(query: string): string | undefined {
    const params = new URLSearchParams(query);
    return params.get("path") || undefined;
  }

  /**
   * Build GitHub URL from components
   */
  buildGitHubUrl(info: GitHubUrlInfo): string {
    let url = `https://github.com/${info.owner}/${info.repo}.git`;
    if (info.path) {
      url += `?path=/${info.path}`;
    }
    if (info.ref) {
      url += `#${info.ref}`;
    }
    return url;
  }

  /**
   * Create request headers with optional auth
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "upm-lsp",
    };
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }
    return headers;
  }

  /**
   * Fetch JSON from GitHub API with error handling
   */
  private async fetchGitHub<T>(url: string): Promise<T> {
    try {
      const response = await fetch(url, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new RegistryError(
            `Not found: ${url}`,
            RegistryErrorCode.NOT_FOUND
          );
        }
        if (response.status === 401 || response.status === 403) {
          throw new RegistryError(
            "GitHub authentication required or rate limited",
            RegistryErrorCode.UNAUTHORIZED
          );
        }
        if (response.status === 429) {
          throw new RegistryError(
            "GitHub rate limit exceeded",
            RegistryErrorCode.RATE_LIMITED
          );
        }
        throw new RegistryError(
          `GitHub API error: ${response.status} ${response.statusText}`,
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
   * Fetch raw content from GitHub
   */
  private async fetchRawContent(url: string): Promise<string> {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "text/plain",
          "User-Agent": "upm-lsp",
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new RegistryError(
            `File not found: ${url}`,
            RegistryErrorCode.NOT_FOUND
          );
        }
        throw new RegistryError(
          `Failed to fetch: ${response.status}`,
          RegistryErrorCode.NETWORK_ERROR
        );
      }

      return await response.text();
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
   * Get tags for a repository
   */
  async getTags(owner: string, repo: string): Promise<string[]> {
    const cacheKey = `${owner}/${repo}`;
    const cached = this.tagsCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const url = `${this.githubApiUrl}/repos/${owner}/${repo}/tags?per_page=100`;
      const tags = await this.fetchGitHub<GitHubTag[]>(url);
      const tagNames = tags.map((t) => t.name);

      this.tagsCache.set(cacheKey, tagNames);
      return tagNames;
    } catch {
      return [];
    }
  }

  /**
   * Get branches for a repository
   */
  async getBranches(owner: string, repo: string): Promise<string[]> {
    const cacheKey = `${owner}/${repo}`;
    const cached = this.branchesCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const url = `${this.githubApiUrl}/repos/${owner}/${repo}/branches?per_page=100`;
      const branches = await this.fetchGitHub<GitHubBranch[]>(url);
      const branchNames = branches.map((b) => b.name);

      this.branchesCache.set(cacheKey, branchNames);
      return branchNames;
    } catch {
      return [];
    }
  }

  /**
   * Fetch package.json from a GitHub repository
   */
  async fetchPackageJson(info: GitHubUrlInfo): Promise<UpmPackageJson | null> {
    const ref = info.ref || "main";
    const basePath = info.path ? `${info.path}/` : "";
    const url = `${this.rawContentUrl}/${info.owner}/${info.repo}/${ref}/${basePath}package.json`;

    try {
      const content = await this.fetchRawContent(url);
      return JSON.parse(content) as UpmPackageJson;
    } catch (error) {
      // Try 'master' branch if 'main' failed
      if (!info.ref) {
        try {
          const masterUrl = `${this.rawContentUrl}/${info.owner}/${info.repo}/master/${basePath}package.json`;
          const content = await this.fetchRawContent(masterUrl);
          return JSON.parse(content) as UpmPackageJson;
        } catch {
          return null;
        }
      }
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
   * Search packages - Not supported for GitHub
   * GitHub URLs are specified directly, not searched
   */
  async searchPackages(_query: string): Promise<PackageInfo[]> {
    // GitHub packages are referenced by URL, not searched
    return [];
  }

  /**
   * Get package info from GitHub URL
   *
   * @param packageUrl - GitHub URL (e.g., https://github.com/owner/repo.git#v1.0.0)
   */
  async getPackageInfo(packageUrl: string): Promise<PackageInfo | null> {
    const cached = this.packageInfoCache.get(packageUrl);
    if (cached) {
      return cached;
    }

    const info = this.parseGitHubUrl(packageUrl);
    if (!info) {
      return null;
    }

    const packageJson = await this.fetchPackageJson(info);
    if (!packageJson) {
      return null;
    }

    const packageInfo: PackageInfo = {
      name: packageJson.name,
      version: packageJson.version,
      displayName: packageJson.displayName,
      description: packageJson.description,
      unity: packageJson.unity,
      unityRelease: packageJson.unityRelease,
      dependencies: packageJson.dependencies,
      keywords: packageJson.keywords,
      author: packageJson.author,
      documentationUrl: packageJson.documentationUrl,
      changelogUrl: packageJson.changelogUrl,
      licensesUrl: packageJson.licensesUrl,
    };

    this.packageInfoCache.set(packageUrl, packageInfo);
    return packageInfo;
  }

  /**
   * Get available versions (tags) for a GitHub package
   *
   * @param packageUrl - GitHub URL
   */
  async getVersions(packageUrl: string): Promise<string[]> {
    const info = this.parseGitHubUrl(packageUrl);
    if (!info) {
      return [];
    }

    const tags = await this.getTags(info.owner, info.repo);

    // Filter to semver-like tags (v1.0.0, 1.0.0, etc.)
    const versionTags = tags.filter((tag) => /^v?\d+\.\d+\.\d+/.test(tag));

    // Sort by version (newest first)
    return versionTags.sort((a, b) => {
      const va = a.replace(/^v/, "");
      const vb = b.replace(/^v/, "");
      return compareVersions(vb, va);
    });
  }

  /**
   * Get all refs (tags and branches) for completion
   */
  async getAllRefs(owner: string, repo: string): Promise<string[]> {
    const [tags, branches] = await Promise.all([
      this.getTags(owner, repo),
      this.getBranches(owner, repo),
    ]);

    return [...tags, ...branches];
  }

  clearCache(): void {
    this.tagsCache.clear();
    this.branchesCache.clear();
    this.packageInfoCache.clear();
  }
}

/**
 * Compare semver versions
 */
function compareVersions(a: string, b: string): number {
  const partsA = a.split(/[.-]/).map((p) => (isNaN(Number(p)) ? p : Number(p)));
  const partsB = b.split(/[.-]/).map((p) => (isNaN(Number(p)) ? p : Number(p)));

  const maxLen = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < maxLen; i++) {
    const partA = partsA[i] ?? 0;
    const partB = partsB[i] ?? 0;

    if (typeof partA === "number" && typeof partB === "number") {
      if (partA !== partB) {
        return partA - partB;
      }
      continue;
    }

    const strA = String(partA);
    const strB = String(partB);
    if (strA !== strB) {
      if (typeof partA === "string" && typeof partB === "number") return -1;
      if (typeof partA === "number" && typeof partB === "string") return 1;
      return strA.localeCompare(strB);
    }
  }

  return 0;
}
