/**
 * Unity Package Manager manifest.json type definitions
 */

/**
 * Scoped Registry configuration
 * @see https://docs.unity3d.com/Manual/upm-scoped.html
 */
export interface ScopedRegistry {
  /** Display name of the registry */
  name: string;
  /** URL of the npm-compatible registry */
  url: string;
  /** Package name prefixes to fetch from this registry */
  scopes: string[];
}

/**
 * Package metadata from Unity Registry or package.json
 */
export interface PackageInfo {
  /** Package identifier (e.g., "com.unity.inputsystem") */
  name: string;
  /** Semantic version (e.g., "1.7.0") */
  version: string;
  /** Human-readable name */
  displayName?: string;
  /** Package description */
  description?: string;
  /** Minimum Unity version required (e.g., "2021.3") */
  unity?: string;
  /** Minimum Unity release for the version (e.g., "0f1") */
  unityRelease?: string;
  /** Package dependencies */
  dependencies?: Record<string, string>;
  /** Keywords for search */
  keywords?: string[];
  /** Package author */
  author?: string | { name: string; email?: string; url?: string };
  /** Documentation URL */
  documentationUrl?: string;
  /** Changelog URL */
  changelogUrl?: string;
  /** License URL */
  licensesUrl?: string;
}

/**
 * Unity Package Manager manifest.json structure
 * @see https://docs.unity3d.com/Manual/upm-manifestPrj.html
 */
export interface ManifestJson {
  /** Direct package dependencies: package name -> version/url */
  dependencies: Record<string, string>;
  /** Custom scoped registries */
  scopedRegistries?: ScopedRegistry[];
  /** Packages to include in test assemblies */
  testables?: string[];
  /** Enable/disable built-in modules */
  enableLockFile?: boolean;
  /** Resolution overrides */
  resolutions?: Record<string, string>;
}

/**
 * LSP document state
 */
export interface DocumentState {
  /** Parsed manifest content */
  manifest: ManifestJson | null;
  /** Parse error if any */
  parseError: string | null;
}

/**
 * Package version info for completion/hover
 */
export interface PackageVersionInfo {
  /** Available versions */
  versions: string[];
  /** Latest stable version */
  latest: string;
  /** Package metadata */
  info: PackageInfo;
}

/**
 * GitHub repository information
 */
export interface GitHubRepoInfo {
  /** Repository full name (owner/repo) */
  fullName: string;
  /** Repository description */
  description: string | null;
  /** Star count */
  stargazersCount: number;
  /** Latest tag/release */
  latestTag: string | null;
  /** Repository URL */
  htmlUrl: string;
}

/**
 * LSP initialization settings
 */
export interface LspSettings {
  /** Enable network validation for package/version existence (default: true) */
  networkValidation?: boolean;
}

/**
 * Registry client interface for providers (hover, diagnostics)
 * This is a higher-level interface that wraps the base RegistryClient
 */
export interface ProviderRegistryClient {
  /**
   * Fetch package information from registry
   * @param packageName - Package identifier (e.g., "com.unity.inputsystem")
   * @returns Package info or null if not found
   */
  getPackageInfo(packageName: string): Promise<PackageInfo | null>;

  /**
   * Check if a package exists in the registry
   * @param packageName - Package identifier
   * @returns true if package exists
   */
  packageExists(packageName: string): Promise<boolean>;

  /**
   * Check if a specific version exists for a package
   * @param packageName - Package identifier
   * @param version - Semantic version string
   * @returns true if version is valid
   */
  versionExists(packageName: string, version: string): Promise<boolean>;

  /**
   * Check if a package is deprecated
   * @param packageName - Package identifier
   * @returns Deprecation message or null if not deprecated
   */
  getDeprecationInfo(packageName: string): Promise<string | null>;

  /**
   * Fetch GitHub repository information
   * @param url - GitHub repository URL
   * @returns Repository info or null if not accessible
   */
  getGitHubRepoInfo(url: string): Promise<GitHubRepoInfo | null>;

  /**
   * Get available versions for a package
   * @param packageName - Package identifier
   * @returns Array of version strings (sorted newest first)
   */
  getVersions(packageName: string): Promise<string[]>;
}
