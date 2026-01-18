/**
 * Unity Editor Built-in Packages Registry
 *
 * Reads package information from locally installed Unity Editor.
 * Core packages are bundled with the Editor and not available on packages.unity.com
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import { PackageInfo } from "../types";
import { RegistryClient, Cache } from "./registryClient";

/**
 * Unity Editor installation info
 */
interface UnityEditorInstallation {
  version: string;
  path: string;
}

/**
 * Unity Editor Registry Client
 * Reads built-in packages from Unity Editor installation
 */
export class UnityEditorRegistryClient implements RegistryClient {
  readonly name = "unity-editor";

  private packageCache: Cache<PackageInfo>;
  private packageListCache: Cache<PackageInfo[]>;
  private editorInstallations: UnityEditorInstallation[] | null = null;

  constructor(cacheTtlMs: number = 30 * 60 * 1000) {
    // 30 min cache (built-in packages rarely change)
    this.packageCache = new Cache<PackageInfo>(cacheTtlMs);
    this.packageListCache = new Cache<PackageInfo[]>(cacheTtlMs);
  }

  /**
   * Get Unity Hub Editor installation paths based on OS
   */
  private getEditorBasePaths(): string[] {
    const platform = os.platform();

    switch (platform) {
      case "darwin":
        return [
          "/Applications/Unity/Hub/Editor",
          path.join(os.homedir(), "Applications/Unity/Hub/Editor"),
        ];
      case "win32":
        return [
          "C:\\Program Files\\Unity\\Hub\\Editor",
          path.join(os.homedir(), "AppData\\Local\\Unity\\Hub\\Editor"),
        ];
      case "linux":
        return [
          path.join(os.homedir(), "Unity/Hub/Editor"),
          "/opt/Unity/Hub/Editor",
        ];
      default:
        return [];
    }
  }

  /**
   * Get built-in packages directory for a Unity Editor installation
   */
  private getBuiltInPackagesPath(editorPath: string): string {
    const platform = os.platform();

    if (platform === "darwin") {
      return path.join(
        editorPath,
        "Unity.app/Contents/Resources/PackageManager/BuiltInPackages"
      );
    } else {
      // Windows/Linux
      return path.join(
        editorPath,
        "Editor/Data/Resources/PackageManager/BuiltInPackages"
      );
    }
  }

  /**
   * Find all installed Unity Editor versions
   */
  private findEditorInstallations(): UnityEditorInstallation[] {
    if (this.editorInstallations !== null) {
      return this.editorInstallations;
    }

    const installations: UnityEditorInstallation[] = [];
    const basePaths = this.getEditorBasePaths();

    for (const basePath of basePaths) {
      if (!fs.existsSync(basePath)) {
        continue;
      }

      try {
        const entries = fs.readdirSync(basePath, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          if (entry.name.startsWith(".")) continue;

          const editorPath = path.join(basePath, entry.name);
          const builtInPath = this.getBuiltInPackagesPath(editorPath);

          if (fs.existsSync(builtInPath)) {
            installations.push({
              version: entry.name,
              path: editorPath,
            });
          }
        }
      } catch {
        // Ignore permission errors
      }
    }

    // Sort by version descending (newest first)
    installations.sort((a, b) => b.version.localeCompare(a.version));

    this.editorInstallations = installations;
    return installations;
  }

  /**
   * Read package.json from a built-in package directory
   */
  private readPackageJson(packageDir: string): PackageInfo | null {
    const packageJsonPath = path.join(packageDir, "package.json");

    if (!fs.existsSync(packageJsonPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(packageJsonPath, "utf-8");
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
   * Get all built-in packages from a specific Unity Editor version
   */
  private getPackagesFromEditor(
    editorPath: string
  ): Map<string, PackageInfo> {
    const packages = new Map<string, PackageInfo>();
    const builtInPath = this.getBuiltInPackagesPath(editorPath);

    if (!fs.existsSync(builtInPath)) {
      return packages;
    }

    try {
      const entries = fs.readdirSync(builtInPath, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (!entry.name.startsWith("com.unity.")) continue;

        const packageDir = path.join(builtInPath, entry.name);
        const packageInfo = this.readPackageJson(packageDir);

        if (packageInfo) {
          packages.set(packageInfo.name, packageInfo);
        }
      }
    } catch {
      // Ignore errors
    }

    return packages;
  }

  /**
   * Get all built-in packages from all installed Unity Editors
   * Merges packages from all versions, keeping the newest version
   */
  async searchPackages(_query: string): Promise<PackageInfo[]> {
    const cacheKey = "all-builtin";
    const cached = this.packageListCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const installations = this.findEditorInstallations();
    const allPackages = new Map<string, PackageInfo>();

    for (const installation of installations) {
      const packages = this.getPackagesFromEditor(installation.path);

      for (const [name, info] of packages) {
        // Keep the newest version found
        if (!allPackages.has(name)) {
          allPackages.set(name, info);
        }
      }
    }

    const result = Array.from(allPackages.values());
    this.packageListCache.set(cacheKey, result);
    return result;
  }

  /**
   * Get package info from any installed Unity Editor
   */
  async getPackageInfo(packageName: string): Promise<PackageInfo | null> {
    const cached = this.packageCache.get(packageName);
    if (cached) {
      return cached;
    }

    const installations = this.findEditorInstallations();

    for (const installation of installations) {
      const builtInPath = this.getBuiltInPackagesPath(installation.path);
      const packageDir = path.join(builtInPath, packageName);

      const info = this.readPackageJson(packageDir);
      if (info) {
        this.packageCache.set(packageName, info);
        return info;
      }
    }

    return null;
  }

  /**
   * Get all versions of a package from installed Unity Editors
   * Each Unity version may have a different version of the same package
   */
  async getVersions(packageName: string): Promise<string[]> {
    const installations = this.findEditorInstallations();
    const versions = new Set<string>();

    for (const installation of installations) {
      const builtInPath = this.getBuiltInPackagesPath(installation.path);
      const packageDir = path.join(builtInPath, packageName);

      const info = this.readPackageJson(packageDir);
      if (info && info.version) {
        versions.add(info.version);
      }
    }

    // Sort versions descending
    return Array.from(versions).sort((a, b) => {
      // Simple semver comparison
      const aParts = a.split(".").map((n) => parseInt(n, 10) || 0);
      const bParts = b.split(".").map((n) => parseInt(n, 10) || 0);

      for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
        const aVal = aParts[i] || 0;
        const bVal = bParts[i] || 0;
        if (aVal !== bVal) return bVal - aVal;
      }
      return 0;
    });
  }

  /**
   * Check if a specific version exists in any installed Unity Editor
   */
  async versionExists(packageName: string, version: string): Promise<boolean> {
    const versions = await this.getVersions(packageName);
    return versions.includes(version);
  }

  /**
   * Check if package exists as a built-in package
   */
  async packageExists(packageName: string): Promise<boolean> {
    const info = await this.getPackageInfo(packageName);
    return info !== null;
  }

  /**
   * Get list of installed Unity Editor versions
   */
  getInstalledEditors(): UnityEditorInstallation[] {
    return this.findEditorInstallations();
  }

  clearCache(): void {
    this.packageCache.clear();
    this.packageListCache.clear();
    this.editorInstallations = null;
  }
}
