/**
 * Registry clients for UPM package sources
 */

// Base types and utilities
export {
  RegistryClient,
  NpmRegistryClient,
  Cache,
  CacheOptions,
  RegistryError,
  RegistryErrorCode,
  NpmAllPackagesResponse,
  NpmPackageEntry,
  NpmVersionInfo,
  NpmPackageDetailResponse,
} from "./registryClient";

// Version utilities
export { compareVersions, sortVersionsDescending } from "./versionUtils";

// Registry implementations
export { UnityRegistryClient } from "./unityRegistry";
export { OpenUpmRegistryClient } from "./openUpmRegistry";
export { GitHubRegistryClient, GitHubUrlInfo } from "./githubRegistry";
export { UnityEditorRegistryClient } from "./unityEditorRegistry";
export {
  LocalPackageRegistryClient,
  LocalPackageInfo,
} from "./localPackageRegistry";

// Re-export file reference utilities from common utils for backward compatibility
export {
  parseFileReference,
  resolveFileReference,
  isFileReference,
  validateFileReferenceFormat,
  getDisplayPath,
  checkProjectBoundary,
} from "../utils/fileReference";
