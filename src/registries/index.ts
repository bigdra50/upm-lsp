/**
 * Registry clients for UPM package sources
 */

// Base types and utilities
export {
  RegistryClient,
  NpmRegistryClient,
  Cache,
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
