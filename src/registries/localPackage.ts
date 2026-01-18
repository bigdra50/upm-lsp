/**
 * Local Package - Pure functions
 *
 * This module contains pure functions for local package handling.
 * No I/O operations - all filesystem access is in localPackageIO.ts
 */

import * as path from "path";
import { Result, ok, err } from "../utils/result";
import {
  parseFileReference,
  resolveFileReference,
  isFileReference,
  FileReferenceInfo,
  ParseError,
} from "../utils/fileReference";
import { PackageInfo } from "../types";

/**
 * Context for resolving local packages
 */
export type ResolveContext = {
  readonly manifestDir: string;
};

/**
 * Resolved local package information
 */
export type LocalPackageInfo = {
  /** Original file: reference */
  readonly reference: string;
  /** Resolved absolute path */
  readonly absolutePath: string;
  /** Whether path exists */
  readonly exists: boolean;
  /** Package info if found */
  readonly packageInfo: PackageInfo | null;
};

/**
 * Resolution error types
 */
export type ResolveError =
  | { readonly type: "parse_error"; readonly error: ParseError }
  | { readonly type: "git_protocol" }
  | { readonly type: "resolve_failed" };

/**
 * Create an empty/invalid LocalPackageInfo
 */
export const emptyInfo = (reference: string): LocalPackageInfo => ({
  reference,
  absolutePath: "",
  exists: false,
  packageInfo: null,
});

/**
 * Create LocalPackageInfo from resolved data
 */
export const createInfo = (
  reference: string,
  absolutePath: string,
  exists: boolean,
  packageInfo: PackageInfo | null
): LocalPackageInfo => ({
  reference,
  absolutePath,
  exists,
  packageInfo,
});

/**
 * Parse and validate a file: reference (pure)
 */
export const parseReference = (
  reference: string
): Result<FileReferenceInfo, ResolveError> => {
  const parseResult = parseFileReference(reference);

  if (!parseResult.ok) {
    return err({ type: "parse_error", error: parseResult.error });
  }

  // Git-style file:// is not supported for local packages
  if (parseResult.value.isGitProtocol) {
    return err({ type: "git_protocol" });
  }

  return ok(parseResult.value);
};

/**
 * Resolve file reference to absolute path (pure)
 */
export const resolveToAbsolutePath = (
  ctx: ResolveContext
) => (
  reference: string
): Result<string, ResolveError> => {
  const parseResult = parseReference(reference);

  if (!parseResult.ok) {
    return parseResult;
  }

  const absolutePath = resolveFileReference(reference, ctx.manifestDir);

  if (!absolutePath) {
    return err({ type: "resolve_failed" });
  }

  return ok(absolutePath);
};

/**
 * Build PackageInfo from raw JSON (pure)
 */
export const buildPackageInfo = (json: unknown): PackageInfo | null => {
  if (!json || typeof json !== "object") {
    return null;
  }

  const j = json as Record<string, unknown>;

  // name and version are required
  if (typeof j.name !== "string" || typeof j.version !== "string") {
    return null;
  }

  return {
    name: j.name,
    version: j.version,
    displayName: typeof j.displayName === "string" ? j.displayName : undefined,
    description: typeof j.description === "string" ? j.description : undefined,
    unity: typeof j.unity === "string" ? j.unity : undefined,
    unityRelease: typeof j.unityRelease === "string" ? j.unityRelease : undefined,
    dependencies: j.dependencies as Record<string, string> | undefined,
    keywords: Array.isArray(j.keywords) ? j.keywords : undefined,
    author: j.author as PackageInfo["author"],
    documentationUrl: typeof j.documentationUrl === "string" ? j.documentationUrl : undefined,
    changelogUrl: typeof j.changelogUrl === "string" ? j.changelogUrl : undefined,
    licensesUrl: typeof j.licensesUrl === "string" ? j.licensesUrl : undefined,
  };
};

/**
 * Check if string is a file reference (re-export for convenience)
 */
export { isFileReference };

/**
 * Generate cache key for a reference
 */
export const getCacheKey = (manifestDir: string, reference: string): string =>
  `${manifestDir}:${reference}`;

/**
 * Filter directories (exclude hidden)
 */
export const filterDirectories = (
  entries: readonly { name: string; isDirectory: boolean }[]
): readonly string[] =>
  entries
    .filter((entry) => entry.isDirectory && !entry.name.startsWith("."))
    .map((entry) => entry.name);
