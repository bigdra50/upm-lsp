/**
 * Local Package I/O Layer
 *
 * Contains all filesystem operations for local packages.
 * Separated from pure functions to enable testing and maintain FP principles.
 */

import * as fs from "fs/promises";
import * as path from "path";

import {
  ResolveContext,
  LocalPackageInfo,
  resolveToAbsolutePath,
  buildPackageInfo,
  emptyInfo,
  createInfo,
} from "./localPackage";
import { PackageInfo } from "../types";

/**
 * Read and parse package.json from a directory
 * Returns null if file doesn't exist or is invalid
 */
export const readPackageJson = async (packageDir: string): Promise<PackageInfo | null> => {
  const packageJsonPath = path.join(packageDir, "package.json");

  try {
    const content = await fs.readFile(packageJsonPath, "utf-8");
    const json = JSON.parse(content);
    return buildPackageInfo(json);
  } catch {
    return null;
  }
};

/**
 * Check if a path exists and is a directory
 */
export const directoryExists = async (dirPath: string): Promise<boolean> => {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
};

/**
 * Check if a file exists
 */
export const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
};

/**
 * List directory entries with their types
 */
export const listDirEntries = async (
  dirPath: string
): Promise<readonly { name: string; isDirectory: boolean }[]> => {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
    }));
  } catch {
    return [];
  }
};

/**
 * Resolve a file reference and fetch its info from disk
 * Combines pure resolution with I/O operations
 */
export const resolveAndFetch = (ctx: ResolveContext) => async (
  reference: string
): Promise<LocalPackageInfo> => {
  const pathResult = resolveToAbsolutePath(ctx)(reference);

  if (!pathResult.ok) {
    return emptyInfo(reference);
  }

  const absolutePath = pathResult.value;

  // Parallelize I/O operations
  const [exists, packageInfo] = await Promise.all([
    directoryExists(absolutePath),
    readPackageJson(absolutePath),
  ]);

  return createInfo(reference, absolutePath, exists, packageInfo);
};

/**
 * Check if a directory contains package.json
 */
export const hasPackageJsonFile = async (
  ctx: ResolveContext,
  dirPath: string
): Promise<boolean> => {
  const pathResult = resolveToAbsolutePath(ctx)(`file:${dirPath}`);

  if (!pathResult.ok) {
    return false;
  }

  const packageJsonPath = path.join(pathResult.value, "package.json");
  return fileExists(packageJsonPath);
};

/**
 * List subdirectories at a given path
 */
export const listSubdirectories = async (
  ctx: ResolveContext,
  basePath: string
): Promise<readonly string[]> => {
  const pathResult = resolveToAbsolutePath(ctx)(`file:${basePath}`);

  if (!pathResult.ok) {
    return [];
  }

  const entries = await listDirEntries(pathResult.value);

  // Filter: directories only, exclude hidden
  return entries
    .filter((entry) => entry.isDirectory && !entry.name.startsWith("."))
    .map((entry) => entry.name);
};
