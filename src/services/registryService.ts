/**
 * Registry Service - Orchestrates registry clients and cache management
 *
 * Responsibilities:
 * - Compose multiple registry clients (Unity, OpenUPM, GitHub, Editor)
 * - Manage package list and version caching
 * - Provide unified ProviderRegistryClient interface
 * - Provide PackageSearchProvider interface for completions
 */

import { PackageInfo, ProviderRegistryClient, GitHubRepoInfo } from "../types";
import { PackageSearchProvider } from "../providers";
import {
  UnityRegistryClient,
  OpenUpmRegistryClient,
  GitHubRegistryClient,
  UnityEditorRegistryClient,
  LocalPackageRegistryClient,
  RegistryClient,
  Cache,
} from "../registries";

/**
 * Configuration for RegistryService
 */
export interface RegistryServiceConfig {
  /** Version cache TTL in milliseconds (default: 5 minutes) */
  versionCacheTtlMs?: number;
  /** Version cache max entries (default: 500) */
  versionCacheMaxEntries?: number;
  /** Package list cache TTL in milliseconds (default: 10 minutes) */
  packageListCacheTtlMs?: number;
}

const DEFAULT_CONFIG: Required<RegistryServiceConfig> = {
  versionCacheTtlMs: 5 * 60 * 1000,
  versionCacheMaxEntries: 500,
  packageListCacheTtlMs: 10 * 60 * 1000,
};

/**
 * Registry clients dependencies (for DI/testing)
 */
export interface RegistryClients {
  unity: RegistryClient;
  openUpm: RegistryClient;
  github: GitHubRegistryClient;
  editor: UnityEditorRegistryClient;
  local: LocalPackageRegistryClient;
}

/**
 * Logger interface for dependency injection
 */
export interface Logger {
  log(message: string): void;
}

/**
 * Create default registry clients
 */
export function createDefaultRegistryClients(): RegistryClients {
  return {
    unity: new UnityRegistryClient(),
    openUpm: new OpenUpmRegistryClient(),
    github: new GitHubRegistryClient(),
    editor: new UnityEditorRegistryClient(),
    local: new LocalPackageRegistryClient(),
  };
}

/**
 * RegistryService orchestrates multiple registry clients
 * and provides unified interfaces for providers
 */
export class RegistryService {
  private readonly clients: RegistryClients;
  private readonly config: Required<RegistryServiceConfig>;
  private readonly logger: Logger | null;

  // Cache for versions (to avoid repeated lookups)
  private readonly versionsCache: Cache<string[]>;

  // Cache for package list (expensive to fetch)
  private packageListCache: PackageInfo[] | null = null;
  private packageListCacheTime = 0;

  constructor(
    clients?: RegistryClients,
    config?: RegistryServiceConfig,
    logger?: Logger
  ) {
    this.clients = clients ?? createDefaultRegistryClients();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = logger ?? null;

    this.versionsCache = new Cache<string[]>({
      ttlMs: this.config.versionCacheTtlMs,
      maxEntries: this.config.versionCacheMaxEntries,
    });
  }

  /**
   * Get Unity Editor registry client (for initialization logging)
   */
  get editorRegistry(): UnityEditorRegistryClient {
    return this.clients.editor;
  }

  /**
   * Get Local Package registry client
   */
  get localRegistry(): LocalPackageRegistryClient {
    return this.clients.local;
  }

  /**
   * Set manifest directory for resolving relative file: paths
   */
  setManifestDir(dir: string): void {
    this.clients.local.setManifestDir(dir);
  }

  /**
   * Get all packages from registries (with caching)
   */
  async getAllPackages(): Promise<PackageInfo[]> {
    const now = Date.now();
    if (
      this.packageListCache &&
      now - this.packageListCacheTime < this.config.packageListCacheTtlMs
    ) {
      return this.packageListCache;
    }

    this.logger?.log("Fetching package list from registries...");

    const [unityPackages, openUpmPackages] = await Promise.all([
      this.clients.unity.searchPackages("").catch(() => []),
      this.clients.openUpm.searchPackages("").catch(() => []),
    ]);

    // Merge and dedupe (Unity takes precedence)
    const packageMap = new Map<string, PackageInfo>();
    for (const pkg of [...openUpmPackages, ...unityPackages]) {
      packageMap.set(pkg.name, pkg);
    }

    this.packageListCache = Array.from(packageMap.values());
    this.packageListCacheTime = now;

    this.logger?.log(`Cached ${this.packageListCache.length} packages`);
    return this.packageListCache;
  }

  /**
   * Get versions for a package (with caching and registry fallback)
   */
  async getVersions(packageName: string): Promise<string[]> {
    // Check cache first
    let versions = this.versionsCache.get(packageName);
    if (versions) {
      return versions;
    }

    // For com.unity.* packages, try local Unity Editor first (has accurate versions)
    if (packageName.startsWith("com.unity.")) {
      versions = await this.clients.editor.getVersions(packageName).catch(() => []);
      if (versions.length > 0) {
        this.versionsCache.set(packageName, versions);
        return versions;
      }
    }

    // Try Unity registry, then OpenUPM
    versions = await this.clients.unity.getVersions(packageName).catch(() => []);
    if (versions.length === 0) {
      versions = await this.clients.openUpm.getVersions(packageName).catch(() => []);
    }

    this.versionsCache.set(packageName, versions);
    return versions;
  }

  /**
   * Create a PackageSearchProvider for completion
   */
  createPackageSearchProvider(): PackageSearchProvider {
    return {
      searchPackages: async (query: string): Promise<PackageInfo[]> => {
        const allPackages = await this.getAllPackages();

        if (!query) {
          // Return popular Unity packages as default
          return allPackages
            .filter((pkg) => pkg.name.startsWith("com.unity."))
            .slice(0, 50);
        }

        // Filter by query
        const lowerQuery = query.toLowerCase();
        return allPackages
          .filter(
            (pkg) =>
              pkg.name.toLowerCase().includes(lowerQuery) ||
              (pkg.displayName &&
                pkg.displayName.toLowerCase().includes(lowerQuery))
          )
          .slice(0, 50);
      },

      getVersions: (packageName: string): Promise<string[]> => {
        return this.getVersions(packageName);
      },
    };
  }

  /**
   * Create a ProviderRegistryClient adapter that wraps the base registry clients
   */
  createProviderRegistryClient(): ProviderRegistryClient {
    const packageSearchProvider = this.createPackageSearchProvider();

    // Internal getPackageInfo to avoid recursive createProviderRegistryClient calls
    const getPackageInfoInternal = async (
      packageName: string
    ): Promise<PackageInfo | null> => {
      // For file: references, use local registry
      if (packageName.startsWith("file:")) {
        return this.clients.local.getPackageInfo(packageName).catch(() => null);
      }

      // For com.unity.* packages, try local Unity Editor first (more accurate)
      if (packageName.startsWith("com.unity.")) {
        const editorInfo = await this.clients.editor
          .getPackageInfo(packageName)
          .catch(() => null);
        if (editorInfo) return editorInfo;
      }

      // Try Unity registry, then OpenUPM
      const unityInfo = await this.clients.unity
        .getPackageInfo(packageName)
        .catch(() => null);
      if (unityInfo) return unityInfo;
      return this.clients.openUpm.getPackageInfo(packageName).catch(() => null);
    };

    return {
      getPackageInfo: getPackageInfoInternal,

      packageExists: async (packageName: string): Promise<boolean> => {
        // For file: references, use local registry
        if (packageName.startsWith("file:")) {
          return this.clients.local.packageExists(packageName).catch(() => false);
        }

        // For com.unity.* packages, check local Unity Editor first
        if (packageName.startsWith("com.unity.")) {
          const editorExists = await this.clients.editor
            .packageExists(packageName)
            .catch(() => false);
          if (editorExists) return true;
        }

        const info = await getPackageInfoInternal(packageName);
        return info !== null;
      },

      versionExists: async (
        packageName: string,
        version: string
      ): Promise<boolean> => {
        // For file: references, use local registry
        if (packageName.startsWith("file:")) {
          return this.clients.local.versionExists(packageName, version).catch(() => false);
        }

        // For com.unity.* packages, check local Unity Editor first
        if (packageName.startsWith("com.unity.")) {
          const editorVersionExists = await this.clients.editor
            .versionExists(packageName, version)
            .catch(() => false);
          if (editorVersionExists) return true;
        }

        const versions = await packageSearchProvider.getVersions(packageName);
        return versions.includes(version);
      },

      getDeprecationInfo: async (_packageName: string): Promise<string | null> => {
        return null;
      },

      getGitHubRepoInfo: async (url: string): Promise<GitHubRepoInfo | null> => {
        try {
          const match = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
          if (!match) return null;

          const [, owner, repo] = match;

          // Fetch repo info from GitHub API directly (not package.json)
          const apiUrl = `https://api.github.com/repos/${owner}/${repo}`;
          const response = await fetch(apiUrl, {
            headers: {
              Accept: "application/vnd.github.v3+json",
              "User-Agent": "upm-lsp",
            },
          });

          if (!response.ok) return null;

          const repoData = await response.json() as {
            full_name: string;
            description: string | null;
            stargazers_count: number;
            html_url: string;
          };

          const tags = await this.clients.github.getTags(owner, repo).catch(() => []);

          return {
            fullName: repoData.full_name,
            description: repoData.description,
            stargazersCount: repoData.stargazers_count,
            latestTag: tags[0] || null,
            htmlUrl: repoData.html_url,
          };
        } catch {
          return null;
        }
      },

      getVersions: async (packageName: string): Promise<string[]> => {
        return packageSearchProvider.getVersions(packageName);
      },
    };
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.versionsCache.clear();
    this.packageListCache = null;
    this.packageListCacheTime = 0;
    this.clients.unity.clearCache();
    this.clients.openUpm.clearCache();
    this.clients.github.clearCache();
    this.clients.editor.clearCache();
    this.clients.local.clearCache();
  }

  /**
   * Pre-fetch package list in background
   */
  prefetchPackages(): void {
    this.getAllPackages().catch(() => {});
  }
}
