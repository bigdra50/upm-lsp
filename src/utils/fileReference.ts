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
  original: string;
  /** Path after removing file: prefix */
  path: string;
  /** Whether it's an absolute path */
  isAbsolute: boolean;
  /** Whether it's a tarball (.tgz) */
  isTarball: boolean;
  /** Whether it's a Git-style file:// reference */
  isGitProtocol: boolean;
}

/**
 * Validation result for file reference
 */
export interface FileReferenceValidation {
  /** Whether the reference is valid */
  valid: boolean;
  /** Resolved absolute path (null if invalid) */
  absolutePath: string | null;
  /** Whether path exists */
  exists: boolean;
  /** Whether package.json exists (for directories) */
  hasPackageJson: boolean;
  /** Warning messages (not errors, just informational) */
  warnings: string[];
  /** Error message if invalid */
  error: string | null;
}

/**
 * Check if a version string is a file: reference
 */
export function isFileReference(version: string): boolean {
  return version.startsWith(FILE_PROTOCOL_PREFIX);
}

/**
 * Check if a version string is a Git-style file:// reference
 */
export function isGitFileReference(version: string): boolean {
  return version.startsWith(FILE_GIT_PROTOCOL_PREFIX);
}

/**
 * Parse a file: reference string
 */
export function parseFileReference(reference: string): FileReferenceInfo | null {
  if (!isFileReference(reference)) {
    return null;
  }

  // Check for Git-style file:// first
  if (isGitFileReference(reference)) {
    return {
      original: reference,
      path: reference.slice(FILE_GIT_PROTOCOL_PREFIX.length),
      isAbsolute: true,
      isTarball: false,
      isGitProtocol: true,
    };
  }

  const filePath = reference.slice(FILE_PROTOCOL_PREFIX.length);

  return {
    original: reference,
    path: filePath,
    isAbsolute: path.isAbsolute(filePath),
    isTarball: filePath.endsWith(".tgz"),
    isGitProtocol: false,
  };
}

/**
 * Resolve file reference path to absolute path
 *
 * @param reference - The file: reference (e.g., "file:../path")
 * @param manifestDir - Directory containing manifest.json (Packages/)
 * @returns Resolved absolute path or null if invalid
 */
export function resolveFileReference(
  reference: string,
  manifestDir: string
): string | null {
  const info = parseFileReference(reference);
  if (!info || info.isGitProtocol) {
    return null;
  }

  if (info.isAbsolute) {
    return path.normalize(info.path);
  }

  return path.resolve(manifestDir, info.path);
}

/**
 * Get relative path from manifest directory for display
 * Used to avoid exposing absolute paths in diagnostics
 *
 * @param absolutePath - Absolute path to convert
 * @param manifestDir - Directory containing manifest.json
 * @returns Relative path if possible, otherwise original path with home dir masked
 */
export function getDisplayPath(
  absolutePath: string,
  manifestDir: string
): string {
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
}

/**
 * Check for common issues in file reference
 * Returns warnings (not errors) for portability concerns
 */
export function checkFileReferenceWarnings(reference: string): string[] {
  const warnings: string[] = [];

  // Check for backslashes (Windows paths should use forward slashes)
  if (reference.includes("\\")) {
    warnings.push("Use forward slashes (/) for better cross-platform portability");
  }

  // Check for spaces in path (might need quoting in some contexts)
  const info = parseFileReference(reference);
  if (info && info.path.includes(" ")) {
    warnings.push("Path contains spaces - ensure proper handling in build systems");
  }

  return warnings;
}

/**
 * Validate file reference path
 * Note: Does NOT perform filesystem access - just validates format
 */
export function validateFileReferenceFormat(reference: string): {
  valid: boolean;
  error: string | null;
} {
  if (!isFileReference(reference)) {
    return { valid: false, error: "Not a file: reference" };
  }

  const info = parseFileReference(reference);
  if (!info) {
    return { valid: false, error: "Failed to parse file: reference" };
  }

  // Git-style file:// is valid but handled differently
  if (info.isGitProtocol) {
    return { valid: true, error: null };
  }

  // Check for empty path
  if (!info.path || info.path.trim() === "") {
    return { valid: false, error: "Empty path in file: reference" };
  }

  // Check for control characters
  if (/[\x00-\x1f]/.test(info.path)) {
    return { valid: false, error: "Path contains invalid control characters" };
  }

  // Check for excessively long paths
  if (info.path.length > 1024) {
    return { valid: false, error: "Path exceeds maximum length (1024 characters)" };
  }

  return { valid: true, error: null };
}

/**
 * Check if resolved path is within project boundaries
 * Returns warning info but does NOT prevent access (per Unity spec)
 *
 * @param absolutePath - Resolved absolute path
 * @param manifestDir - Directory containing manifest.json
 * @returns Object with isWithinProject flag and message
 */
export function checkProjectBoundary(
  absolutePath: string,
  manifestDir: string
): { isWithinProject: boolean; message: string | null } {
  // Get project root (parent of Packages/)
  const projectRoot = path.dirname(manifestDir);
  const normalizedPath = path.normalize(absolutePath);
  const normalizedRoot = path.normalize(projectRoot);

  const isWithinProject = normalizedPath.startsWith(normalizedRoot + path.sep) ||
    normalizedPath === normalizedRoot;

  if (!isWithinProject) {
    return {
      isWithinProject: false,
      message: "Path references location outside project directory",
    };
  }

  return { isWithinProject: true, message: null };
}
