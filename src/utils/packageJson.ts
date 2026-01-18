/**
 * Package.json reading utilities
 */
import * as fs from "fs/promises";
import * as path from "path";
import { PackageInfo } from "../types";

/** Maximum package.json size (1MB) to prevent memory issues */
export const MAX_PACKAGE_JSON_SIZE = 1024 * 1024;

/**
 * Read and parse package.json from a directory
 * Single I/O operation (no separate access check)
 *
 * @param packageDir - Directory containing package.json
 * @returns PackageInfo or null if not found/invalid
 */
export async function readPackageJson(
  packageDir: string
): Promise<PackageInfo | null> {
  const packageJsonPath = path.join(packageDir, "package.json");

  try {
    // Check file size first to prevent memory issues
    const stat = await fs.stat(packageJsonPath);
    if (stat.size > MAX_PACKAGE_JSON_SIZE) {
      return null;
    }

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
 * Check if package.json exists in directory
 */
export async function hasPackageJson(packageDir: string): Promise<boolean> {
  const packageJsonPath = path.join(packageDir, "package.json");
  try {
    await fs.access(packageJsonPath);
    return true;
  } catch {
    return false;
  }
}
