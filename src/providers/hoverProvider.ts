/**
 * Hover information provider for UPM manifest.json
 * Displays package metadata and GitHub repository information
 */

import {
  Hover,
  MarkupContent,
  MarkupKind,
  Position,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import * as path from "path";
import { URI } from "vscode-uri";

import { ProviderRegistryClient, PackageInfo, GitHubRepoInfo } from "../types";
import {
  findTokenAtPosition,
  determineTokenType,
  extractGitHubUrl,
  extractGitHubRef,
  getVersionForPackage,
  getPackageNameForVersion,
  TokenLocation,
  TokenType,
} from "../utils/jsonHelper";
import {
  isFileReference,
  parseFileReference,
  getDisplayPath,
} from "../utils/fileReference";

/**
 * Token information at a position (with type)
 */
interface TokenInfo extends TokenLocation {
  type: TokenType;
}

/**
 * Extract the token at the given position with type information
 */
function getTokenAtPosition(
  document: TextDocument,
  position: Position
): TokenInfo | null {
  const token = findTokenAtPosition(document, position);
  if (!token) return null;

  const text = document.getText();
  const tokenStart = document.offsetAt(token.range.start);
  const type = determineTokenType(text, tokenStart, token.value);

  return { ...token, type };
}

/**
 * Format author information
 */
function formatAuthor(
  author: string | { name: string; email?: string; url?: string } | undefined
): string {
  if (!author) return "Unknown";

  if (typeof author === "string") {
    return author;
  }

  let result = author.name;
  if (author.email) {
    result += ` <${author.email}>`;
  }
  if (author.url) {
    result += ` (${author.url})`;
  }
  return result;
}

/**
 * Create hover content for a Unity package
 */
function createPackageHoverContent(info: PackageInfo): MarkupContent {
  const lines: string[] = [];

  const title = info.displayName || info.name;
  lines.push(`## ${title}`);
  lines.push("");

  const isBuiltInModule = info.name.startsWith("com.unity.modules.");

  lines.push(`**Version:** ${info.version}`);

  if (isBuiltInModule) {
    lines.push(`**Type:** Unity Built-in Module`);
  }

  if (info.description) {
    lines.push("");
    lines.push(info.description);
  }

  if (info.unity) {
    lines.push("");
    const unityVersion = info.unityRelease
      ? `${info.unity}.${info.unityRelease}`
      : info.unity;
    lines.push(`**Unity:** ${unityVersion}+`);
  }

  if (info.author) {
    lines.push(`**Author:** ${formatAuthor(info.author)}`);
  }

  if (info.licensesUrl) {
    lines.push(`**License:** [View License](${info.licensesUrl})`);
  }

  if (info.documentationUrl) {
    lines.push("");
    lines.push(`[Documentation](${info.documentationUrl})`);
  } else if (isBuiltInModule) {
    lines.push("");
    lines.push(`[Unity Modules Documentation](https://docs.unity3d.com/Manual/upm-manifestPrj.html)`);
  }

  return {
    kind: MarkupKind.Markdown,
    value: lines.join("\n"),
  };
}

/**
 * Create hover content for a local package (file: reference)
 */
function createLocalPackageHoverContent(
  info: PackageInfo,
  fileReference: string,
  documentUri: string
): MarkupContent {
  const lines: string[] = [];

  const title = info.displayName || info.name;
  lines.push(`## Local Package: ${title}`);
  lines.push("");

  // Extract path from file: reference using utility
  const fileInfoResult = parseFileReference(fileReference);
  const manifestDir = path.dirname(URI.parse(documentUri).fsPath);
  const displayPath = fileInfoResult.ok
    ? getDisplayPath(
        fileInfoResult.value.isAbsolute
          ? fileInfoResult.value.path
          : path.resolve(manifestDir, fileInfoResult.value.path),
        manifestDir
      )
    : fileReference;
  lines.push(`**Path:** \`${displayPath}\``);
  lines.push(`**Version:** ${info.version}`);

  if (info.description) {
    lines.push("");
    lines.push(info.description);
  }

  if (info.unity) {
    lines.push("");
    const unityVersion = info.unityRelease
      ? `${info.unity}.${info.unityRelease}`
      : info.unity;
    lines.push(`**Unity:** ${unityVersion}+`);
  }

  if (info.author) {
    lines.push(`**Author:** ${formatAuthor(info.author)}`);
  }

  if (info.dependencies && Object.keys(info.dependencies).length > 0) {
    lines.push("");
    lines.push("**Dependencies:**");
    for (const [dep, ver] of Object.entries(info.dependencies)) {
      lines.push(`- ${dep}: ${ver}`);
    }
  }

  return {
    kind: MarkupKind.Markdown,
    value: lines.join("\n"),
  };
}

/**
 * Create hover content for version information
 */
function createVersionHoverContent(
  packageName: string,
  currentVersion: string,
  latestVersion: string | null,
  availableVersions: string[]
): MarkupContent {
  const lines: string[] = [];

  lines.push(`**Version:** ${currentVersion}`);

  if (latestVersion && latestVersion !== currentVersion) {
    lines.push(`**Latest:** ${latestVersion} ⬆️`);
  } else if (latestVersion) {
    lines.push(`**Status:** Up to date ✓`);
  }

  if (availableVersions.length > 1) {
    const recentVersions = availableVersions.slice(0, 5);
    lines.push("");
    lines.push("**Recent versions:**");
    for (const v of recentVersions) {
      const marker = v === currentVersion ? " ← current" : "";
      lines.push(`- ${v}${marker}`);
    }
    if (availableVersions.length > 5) {
      lines.push(`- ... (${availableVersions.length - 5} more)`);
    }
  }

  return {
    kind: MarkupKind.Markdown,
    value: lines.join("\n"),
  };
}

/**
 * Create hover content for a GitHub repository
 */
function createGitHubHoverContent(info: GitHubRepoInfo, currentTag?: string): MarkupContent {
  const lines: string[] = [];

  lines.push(`## ${info.fullName}`);
  lines.push("");

  if (info.description) {
    lines.push(info.description);
    lines.push("");
  }

  lines.push(`**Stars:** ${info.stargazersCount.toLocaleString()}`);

  if (info.latestTag) {
    lines.push(`**Latest Tag:** ${info.latestTag}`);
  }

  // Show tag list if available
  if (info.tags.length > 0) {
    lines.push("");
    lines.push("**Available tags:**");
    const recentTags = info.tags.slice(0, 5);
    for (const tag of recentTags) {
      const marker = tag === currentTag ? " ← current" : "";
      lines.push(`- ${tag}${marker}`);
    }
    if (info.tags.length > 5) {
      lines.push(`- ... (${info.tags.length - 5} more)`);
    }
  }

  lines.push("");
  lines.push(`[View on GitHub](${info.htmlUrl})`);

  return {
    kind: MarkupKind.Markdown,
    value: lines.join("\n"),
  };
}

/**
 * Get hover information for a position in the document
 */
export async function getHover(
  document: TextDocument,
  position: Position,
  registryClient: ProviderRegistryClient
): Promise<Hover | null> {
  const token = getTokenAtPosition(document, position);
  if (!token) {
    return null;
  }

  switch (token.type) {
    case "packageName": {
      const packageInfo = await registryClient.getPackageInfo(token.value);
      if (packageInfo) {
        return {
          contents: createPackageHoverContent(packageInfo),
          range: token.range,
        };
      }

      // If not found in registry, check if it's a GitHub URL package
      const versionValue = getVersionForPackage(document.getText(), token.value);
      if (versionValue) {
        const gitHubUrl = extractGitHubUrl(versionValue);
        if (gitHubUrl) {
          const repoInfo = await registryClient.getGitHubRepoInfo(gitHubUrl);
          if (repoInfo) {
            const currentRef = extractGitHubRef(versionValue);
            return {
              contents: createGitHubHoverContent(repoInfo, currentRef ?? undefined),
              range: token.range,
            };
          }
        }
      }
      break;
    }

    case "version": {
      // Handle file: references
      if (isFileReference(token.value)) {
        const packageInfo = await registryClient.getPackageInfo(token.value);
        if (packageInfo) {
          return {
            contents: createLocalPackageHoverContent(
              packageInfo,
              token.value,
              document.uri
            ),
            range: token.range,
          };
        }
        break;
      }

      // Handle GitHub URLs
      const gitHubUrl = extractGitHubUrl(token.value);
      if (gitHubUrl) {
        const repoInfo = await registryClient.getGitHubRepoInfo(gitHubUrl);
        if (repoInfo) {
          const currentRef = extractGitHubRef(token.value);
          return {
            contents: createGitHubHoverContent(repoInfo, currentRef ?? undefined),
            range: token.range,
          };
        }
      }

      // Handle normal version strings - show version info
      const text = document.getText();
      const offset = document.offsetAt(token.range.start);
      const packageName = getPackageNameForVersion(text, offset);
      if (packageName) {
        const versions = await registryClient.getVersions(packageName);
        if (versions.length > 0) {
          return {
            contents: createVersionHoverContent(
              packageName,
              token.value,
              versions[0],
              versions
            ),
            range: token.range,
          };
        }
      }
      break;
    }

    case "url": {
      const gitHubUrl = extractGitHubUrl(token.value);
      if (gitHubUrl) {
        const repoInfo = await registryClient.getGitHubRepoInfo(gitHubUrl);
        if (repoInfo) {
          const currentRef = extractGitHubRef(token.value);
          return {
            contents: createGitHubHoverContent(repoInfo, currentRef ?? undefined),
            range: token.range,
          };
        }
      }
      break;
    }
  }

  return null;
}
