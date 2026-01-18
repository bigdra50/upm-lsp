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

import { ProviderRegistryClient, PackageInfo, GitHubRepoInfo } from "../types";

/**
 * Token information at a position
 */
interface TokenInfo {
  /** Token value (without quotes) */
  value: string;
  /** Token type */
  type: "packageName" | "version" | "url" | "unknown";
  /** Start position of the token */
  start: Position;
  /** End position of the token */
  end: Position;
}

/**
 * GitHub URL pattern
 */
const GITHUB_URL_PATTERN = /^https?:\/\/github\.com\/[\w-]+\/[\w.-]+/;

/**
 * Git URL pattern for dependencies
 */
const GIT_URL_PATTERN = /^(git\+)?(https?:\/\/|git@)github\.com[:/][\w-]+\/[\w.-]+(\.git)?/;

/**
 * Extract the token at the given position
 *
 * @param document - Text document
 * @param position - Cursor position
 * @returns Token info or null if not on a string token
 */
function getTokenAtPosition(
  document: TextDocument,
  position: Position
): TokenInfo | null {
  const text = document.getText();
  const offset = document.offsetAt(position);

  // Find the string token containing the cursor
  // Match quoted strings in JSON
  const stringPattern = /"([^"\\]|\\.)*"/g;
  let match: RegExpExecArray | null;

  while ((match = stringPattern.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;

    if (offset >= start && offset <= end) {
      // Cursor is within this string
      const value = match[0].slice(1, -1); // Remove quotes
      const startPos = document.positionAt(start);
      const endPos = document.positionAt(end);

      // Determine token type based on context
      const type = determineTokenType(text, start, value);

      return { value, type, start: startPos, end: endPos };
    }
  }

  return null;
}

/**
 * Determine the type of token based on its context in the JSON
 *
 * @param text - Full document text
 * @param tokenStart - Start offset of the token
 * @param value - Token value
 * @returns Token type
 */
function determineTokenType(
  text: string,
  tokenStart: number,
  value: string
): TokenInfo["type"] {
  // Check if it's a URL
  if (GITHUB_URL_PATTERN.test(value) || GIT_URL_PATTERN.test(value)) {
    return "url";
  }

  // Check if in dependencies context
  const beforeToken = text.slice(0, tokenStart);

  // Find if we're in dependencies object
  const dependenciesMatch = beforeToken.match(/"dependencies"\s*:\s*\{/);
  if (dependenciesMatch) {
    const dependenciesStart =
      dependenciesMatch.index! + dependenciesMatch[0].length;

    // Count braces to check if still inside dependencies
    let braceCount = 1;
    for (let i = dependenciesStart; i < tokenStart; i++) {
      if (text[i] === "{") braceCount++;
      if (text[i] === "}") braceCount--;
      if (braceCount === 0) break;
    }

    if (braceCount > 0) {
      // Inside dependencies - check if key or value
      // Look for colon between this token and previous content
      const lineStart = beforeToken.lastIndexOf("\n") + 1;
      const lineContent = beforeToken.slice(lineStart);

      // If line has a colon before cursor, this is a value (version)
      if (lineContent.includes(":")) {
        // Check if this looks like a version or URL
        if (/^\d+\.\d+/.test(value) || value === "file:" || value.startsWith("git")) {
          return "version";
        }
        // Could be a git URL in value position
        return "version";
      }

      // This is a key (package name)
      return "packageName";
    }
  }

  return "unknown";
}

/**
 * Format author information
 *
 * @param author - Author field from package info
 * @returns Formatted author string
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
 *
 * @param info - Package information
 * @returns Markdown content for hover
 */
function createPackageHoverContent(info: PackageInfo): MarkupContent {
  const lines: string[] = [];

  // Header with display name or package name
  const title = info.displayName || info.name;
  lines.push(`## ${title}`);
  lines.push("");

  // Check if this is a built-in module
  const isBuiltInModule = info.name.startsWith("com.unity.modules.");

  // Version
  lines.push(`**Version:** ${info.version}`);

  // Type indicator for built-in modules
  if (isBuiltInModule) {
    lines.push(`**Type:** Unity Built-in Module`);
  }

  // Description
  if (info.description) {
    lines.push("");
    lines.push(info.description);
  }

  // Unity compatibility
  if (info.unity) {
    lines.push("");
    const unityVersion = info.unityRelease
      ? `${info.unity}.${info.unityRelease}`
      : info.unity;
    lines.push(`**Unity:** ${unityVersion}+`);
  }

  // Author
  if (info.author) {
    lines.push(`**Author:** ${formatAuthor(info.author)}`);
  }

  // License
  if (info.licensesUrl) {
    lines.push(`**License:** [View License](${info.licensesUrl})`);
  }

  // Documentation link
  if (info.documentationUrl) {
    lines.push("");
    lines.push(`[Documentation](${info.documentationUrl})`);
  } else if (isBuiltInModule) {
    // Add default documentation link for built-in modules
    lines.push("");
    lines.push(`[Unity Modules Documentation](https://docs.unity3d.com/Manual/upm-manifestPrj.html)`);
  }

  return {
    kind: MarkupKind.Markdown,
    value: lines.join("\n"),
  };
}

/**
 * Create hover content for a GitHub repository
 *
 * @param info - GitHub repository information
 * @returns Markdown content for hover
 */
function createGitHubHoverContent(info: GitHubRepoInfo): MarkupContent {
  const lines: string[] = [];

  // Header
  lines.push(`## ${info.fullName}`);
  lines.push("");

  // Description
  if (info.description) {
    lines.push(info.description);
    lines.push("");
  }

  // Stats
  lines.push(`**Stars:** ${info.stargazersCount.toLocaleString()}`);

  // Latest tag
  if (info.latestTag) {
    lines.push(`**Latest Tag:** ${info.latestTag}`);
  }

  // Link
  lines.push("");
  lines.push(`[View on GitHub](${info.htmlUrl})`);

  return {
    kind: MarkupKind.Markdown,
    value: lines.join("\n"),
  };
}

/**
 * Extract GitHub URL from a git dependency value
 *
 * @param value - Dependency value (may include git+ prefix, #tag suffix)
 * @returns Normalized GitHub URL or null
 */
function extractGitHubUrl(value: string): string | null {
  // Remove git+ prefix
  let url = value.replace(/^git\+/, "");

  // Remove #tag suffix
  url = url.replace(/#.*$/, "");

  // Remove .git suffix
  url = url.replace(/\.git$/, "");

  // Convert git@ to https://
  url = url.replace(/^git@github\.com:/, "https://github.com/");

  // Validate it's a GitHub URL
  if (GITHUB_URL_PATTERN.test(url)) {
    return url;
  }

  return null;
}

/**
 * Get hover information for a position in the document
 *
 * @param document - Text document
 * @param position - Cursor position
 * @param registryClient - Registry client for fetching package info
 * @returns Hover information or null
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

  // Handle based on token type
  switch (token.type) {
    case "packageName": {
      const packageInfo = await registryClient.getPackageInfo(token.value);
      if (packageInfo) {
        return {
          contents: createPackageHoverContent(packageInfo),
          range: {
            start: token.start,
            end: token.end,
          },
        };
      }
      break;
    }

    case "version": {
      // Check if it's a git URL
      const gitHubUrl = extractGitHubUrl(token.value);
      if (gitHubUrl) {
        const repoInfo = await registryClient.getGitHubRepoInfo(gitHubUrl);
        if (repoInfo) {
          return {
            contents: createGitHubHoverContent(repoInfo),
            range: {
              start: token.start,
              end: token.end,
            },
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
          return {
            contents: createGitHubHoverContent(repoInfo),
            range: {
              start: token.start,
              end: token.end,
            },
          };
        }
      }
      break;
    }
  }

  return null;
}
