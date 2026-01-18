/**
 * file: protocol reference utilities
 *
 * Unity Package Manager supports local packages via file: protocol.
 * @see https://docs.unity3d.com/Manual/upm-localpath.html
 *
 * Supported formats:
 * - Relative: "file:../path", "file:./path"
 * - Absolute: "file:/absolute/path", "file:C:/path" (Windows)
 * - Tarball: "file:../package.tgz"
 *
 * NOT supported (Git protocol):
 * - "file://localhost/path/repo.git"
 */

import * as path from "path";
import { Result, ok, err } from "./result";

/**
 * File reference protocol prefix
 */
export const FILE_PROTOCOL_PREFIX = "file:";

/**
 * Git-style file protocol prefix (different from local package)
 */
export const FILE_GIT_PROTOCOL_PREFIX = "file://";

/**
 * Parsed file reference information
 */
export interface FileReferenceInfo {
  /** Original reference string */
  readonly original: string;
  /** Path after removing file: prefix */
  readonly path: string;
  /** Whether it's an absolute path */
  readonly isAbsolute: boolean;
  /** Whether it's a tarball (.tgz) */
  readonly isTarball: boolean;
  /** Whether it's a Git-style file:// reference */
  readonly isGitProtocol: boolean;
}

/**
 * Parse error types
 */
export type ParseError =
  | "not_file_ref"
  | "empty_path"
  | "invalid_chars"
  | "too_long";

/**
 * Check if a version string is a file: reference
 */
export const isFileReference = (version: string): boolean =>
  version.startsWith(FILE_PROTOCOL_PREFIX);

/**
 * Check if a version string is a Git-style file:// reference
 */
export const isGitFileReference = (version: string): boolean =>
  version.startsWith(FILE_GIT_PROTOCOL_PREFIX);

/**
 * Parse a file: reference string (Result-based)
 */
export const parseFileReference = (
  reference: string
): Result<FileReferenceInfo, ParseError> => {
  if (!isFileReference(reference)) {
    return err("not_file_ref");
  }

  // Check for Git-style file:// first
  if (isGitFileReference(reference)) {
    return ok({
      original: reference,
      path: reference.slice(FILE_GIT_PROTOCOL_PREFIX.length),
      isAbsolute: true,
      isTarball: false,
      isGitProtocol: true,
    });
  }

  const filePath = reference.slice(FILE_PROTOCOL_PREFIX.length);

  // Validate path
  if (!filePath || filePath.trim() === "") {
    return err("empty_path");
  }
  if (/[\x00-\x1f]/.test(filePath)) {
    return err("invalid_chars");
  }
  if (filePath.length > 1024) {
    return err("too_long");
  }

  return ok({
    original: reference,
    path: filePath,
    isAbsolute: path.isAbsolute(filePath),
    isTarball: filePath.endsWith(".tgz"),
    isGitProtocol: false,
  });
};

/**
 * Parse file reference - returns null on error (legacy compatibility)
 * @deprecated Use parseFileReference with Result type
 */
export const parseFileReferenceOrNull = (
  reference: string
): FileReferenceInfo | null => {
  const result = parseFileReference(reference);
  return result.ok ? result.value : null;
};

/**
 * Resolve file reference path to absolute path
 *
 * @param reference - The file: reference (e.g., "file:../path")
 * @param manifestDir - Directory containing manifest.json (Packages/)
 * @returns Resolved absolute path or null if invalid
 */
export const resolveFileReference = (
  reference: string,
  manifestDir: string
): string | null => {
  const result = parseFileReference(reference);
  if (!result.ok || result.value.isGitProtocol) {
    return null;
  }

  const info = result.value;
  return info.isAbsolute
    ? path.normalize(info.path)
    : path.resolve(manifestDir, info.path);
};

/**
 * Get relative path from manifest directory for display
 * Used to avoid exposing absolute paths in diagnostics
 *
 * @param absolutePath - Absolute path to convert
 * @param manifestDir - Directory containing manifest.json
 * @returns Relative path if possible, otherwise original path with home dir masked
 */
export const getDisplayPath = (
  absolutePath: string,
  manifestDir: string
): string => {
  // Try to get relative path from manifest directory
  const relativePath = path.relative(manifestDir, absolutePath);

  // If the relative path doesn't go too far up, use it
  const upCount = (relativePath.match(/\.\.\//g) || []).length;
  if (upCount <= 3 && !path.isAbsolute(relativePath)) {
    return relativePath;
  }

  // For absolute paths, mask home directory
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  if (homeDir && absolutePath.startsWith(homeDir)) {
    return absolutePath.replace(homeDir, "~");
  }

  return absolutePath;
};

/**
 * Check for common issues in file reference
 * Returns warnings (not errors) for portability concerns
 * Pure function - no mutation
 */
export const checkFileReferenceWarnings = (reference: string): readonly string[] => {
  const result = parseFileReference(reference);
  const info = result.ok ? result.value : null;

  return [
    ...(reference.includes("\\")
      ? ["Use forward slashes (/) for better cross-platform portability"]
      : []),
    ...(info?.path.includes(" ")
      ? ["Path contains spaces - ensure proper handling in build systems"]
      : []),
  ];
};

/**
 * Validate file reference path format
 * Note: Does NOT perform filesystem access - just validates format
 */
export const validateFileReferenceFormat = (
  reference: string
): { valid: boolean; error: string | null } => {
  const result = parseFileReference(reference);

  if (!result.ok) {
    const errorMessages: Record<ParseError, string> = {
      not_file_ref: "Not a file: reference",
      empty_path: "Empty path in file: reference",
      invalid_chars: "Path contains invalid control characters",
      too_long: "Path exceeds maximum length (1024 characters)",
    };
    return { valid: false, error: errorMessages[result.error] };
  }

  return { valid: true, error: null };
};

/**
 * Check if resolved path is within project boundaries
 * Returns warning info but does NOT prevent access (per Unity spec)
 *
 * @param absolutePath - Resolved absolute path
 * @param manifestDir - Directory containing manifest.json
 * @returns Object with isWithinProject flag and message
 */
export const checkProjectBoundary = (
  absolutePath: string,
  manifestDir: string
): { isWithinProject: boolean; message: string | null } => {
  // Get project root (parent of Packages/)
  const projectRoot = path.dirname(manifestDir);
  const normalizedPath = path.normalize(absolutePath);
  const normalizedRoot = path.normalize(projectRoot);

  const isWithinProject =
    normalizedPath.startsWith(normalizedRoot + path.sep) ||
    normalizedPath === normalizedRoot;

  return isWithinProject
    ? { isWithinProject: true, message: null }
    : {
        isWithinProject: false,
        message: "Path references location outside project directory",
      };
};

/**
 * Convert parse error to human-readable message
 */
export const parseErrorToMessage = (error: ParseError): string => {
  const messages: Record<ParseError, string> = {
    not_file_ref: "Not a file: reference",
    empty_path: "Empty path in file: reference",
    invalid_chars: "Path contains invalid control characters",
    too_long: "Path exceeds maximum length (1024 characters)",
  };
  return messages[error];
};
