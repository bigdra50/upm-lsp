/**
 * JSON parsing utilities for manifest.json analysis
 * Provides position-aware parsing without full AST generation
 */

import { Position, Range } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

/**
 * Pre-computed line index for O(log n) offset-to-position conversion
 */
export class LineIndex {
  private readonly lineStarts: number[];

  constructor(text: string) {
    this.lineStarts = [0];
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10) {
        this.lineStarts.push(i + 1);
      }
    }
  }

  positionAt(offset: number): Position {
    let low = 0;
    let high = this.lineStarts.length - 1;

    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (this.lineStarts[mid] <= offset) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }

    return {
      line: low,
      character: offset - this.lineStarts[low],
    };
  }
}

/**
 * Token location with value and range
 */
export interface TokenLocation {
  value: string;
  range: Range;
}

/**
 * Context types within manifest.json
 */
export type JsonContext =
  | { type: "topLevel" }
  | { type: "dependenciesKey"; partial: string }
  | { type: "dependenciesValue"; packageName: string; partial: string }
  | { type: "scopedRegistriesObject" }
  | { type: "scopedRegistriesScopes" }
  | { type: "unknown" };

/**
 * Token type determined by JSON context
 */
export type TokenType = "packageName" | "version" | "url" | "unknown";

/**
 * GitHub URL patterns
 */
const GITHUB_URL_PATTERN = /^https?:\/\/github\.com\/[\w-]+\/[\w.-]+/;
const GIT_URL_PATTERN = /^(git\+)?(https?:\/\/|git@)github\.com[:/][\w-]+\/[\w.-]+(\.git)?/;

/**
 * Count braces from a starting position to determine if still inside an object
 */
function countBraces(text: string, startOffset: number, endOffset: number): number {
  let braceCount = 1;
  for (let i = startOffset; i < endOffset; i++) {
    if (text[i] === "{") braceCount++;
    if (text[i] === "}") braceCount--;
    if (braceCount === 0) return 0;
  }
  return braceCount;
}

/**
 * Find the start of a JSON object/array by key name
 */
function findObjectStart(text: string, keyPattern: RegExp): { index: number; length: number } | null {
  const match = text.match(keyPattern);
  if (!match || match.index === undefined) return null;
  return { index: match.index, length: match[0].length };
}

/**
 * Check if inside a dependencies object
 */
function isInsideDependencies(text: string, offset: number): { inside: boolean; startOffset: number } {
  const beforeCursor = text.slice(0, offset);
  const match = findObjectStart(beforeCursor, /"dependencies"\s*:\s*\{/);
  if (!match) return { inside: false, startOffset: 0 };

  const startOffset = match.index + match.length;
  const braceCount = countBraces(text, startOffset, offset);
  return { inside: braceCount > 0, startOffset };
}

/**
 * Check if inside scopedRegistries array
 */
function isInsideScopedRegistries(text: string, offset: number): {
  inside: boolean;
  inObject: boolean;
  startOffset: number
} {
  const beforeCursor = text.slice(0, offset);
  const match = findObjectStart(beforeCursor, /"scopedRegistries"\s*:\s*\[/);
  if (!match) return { inside: false, inObject: false, startOffset: 0 };

  const startOffset = match.index + match.length;
  let bracketCount = 1;
  let braceCount = 0;
  let inObject = false;

  for (let i = startOffset; i < offset; i++) {
    const char = text[i];
    if (char === "[") bracketCount++;
    if (char === "]") bracketCount--;
    if (char === "{") {
      braceCount++;
      inObject = true;
    }
    if (char === "}") {
      braceCount--;
      if (braceCount === 0) inObject = false;
    }
    if (bracketCount === 0) return { inside: false, inObject: false, startOffset };
  }

  return { inside: bracketCount > 0, inObject: inObject && braceCount > 0, startOffset };
}

/**
 * Check if at top-level object position
 */
function isAtTopLevel(text: string, offset: number): boolean {
  const beforeCursor = text.slice(0, offset);
  let braceDepth = 0;
  let bracketDepth = 0;
  let inString = false;
  let escape = false;

  for (const char of beforeCursor) {
    if (escape) {
      escape = false;
      continue;
    }
    if (char === "\\") {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === "{") braceDepth++;
    if (char === "}") braceDepth--;
    if (char === "[") bracketDepth++;
    if (char === "]") bracketDepth--;
  }

  return braceDepth === 1 && bracketDepth === 0;
}

/**
 * Extract partial input from current line
 */
function extractPartialInput(beforeCursor: string): string {
  const lineStart = beforeCursor.lastIndexOf("\n") + 1;
  const currentLine = beforeCursor.slice(lineStart);
  const quoteMatch = currentLine.match(/"([^"]*)"?$/);
  return quoteMatch ? quoteMatch[1] : "";
}

/**
 * Check if current line has a colon (indicating value position)
 */
function isInValuePosition(beforeCursor: string): boolean {
  const lineStart = beforeCursor.lastIndexOf("\n") + 1;
  const currentLine = beforeCursor.slice(lineStart);
  return currentLine.includes(":");
}

/**
 * Extract package name from current line
 */
function extractPackageNameFromLine(beforeCursor: string): string {
  const lineStart = beforeCursor.lastIndexOf("\n") + 1;
  const currentLine = beforeCursor.slice(lineStart);
  const packageMatch = currentLine.match(/"([^"]+)"\s*:/);
  return packageMatch ? packageMatch[1] : "";
}

/**
 * Extract partial version from current line
 */
function extractPartialVersion(beforeCursor: string): string {
  const lineStart = beforeCursor.lastIndexOf("\n") + 1;
  const currentLine = beforeCursor.slice(lineStart);
  const versionMatch = currentLine.match(/:\s*"([^"]*)"?$/);
  return versionMatch ? versionMatch[1] : "";
}

/**
 * Determine JSON context at cursor position
 */
export function getJsonContext(document: TextDocument, position: Position): JsonContext {
  const text = document.getText();
  const offset = document.offsetAt(position);
  const beforeCursor = text.slice(0, offset);

  // Check scopedRegistries first (more specific)
  const scopedResult = isInsideScopedRegistries(text, offset);
  if (scopedResult.inObject) {
    return { type: "scopedRegistriesObject" };
  }

  // Check dependencies
  const depResult = isInsideDependencies(text, offset);
  if (depResult.inside) {
    if (isInValuePosition(beforeCursor)) {
      const colonPattern = /:\s*"?$/;
      const lineStart = beforeCursor.lastIndexOf("\n") + 1;
      const currentLine = beforeCursor.slice(lineStart);

      if (colonPattern.test(currentLine)) {
        return {
          type: "dependenciesValue",
          packageName: extractPackageNameFromLine(beforeCursor),
          partial: extractPartialVersion(beforeCursor),
        };
      }
    }
    return {
      type: "dependenciesKey",
      partial: extractPartialInput(beforeCursor),
    };
  }

  // Check top-level
  if (isAtTopLevel(text, offset)) {
    return { type: "topLevel" };
  }

  return { type: "unknown" };
}

/**
 * Determine token type based on context and value
 */
export function determineTokenType(
  text: string,
  tokenStart: number,
  value: string
): TokenType {
  // Check URL patterns first
  if (GITHUB_URL_PATTERN.test(value) || GIT_URL_PATTERN.test(value)) {
    return "url";
  }

  // Check dependencies context
  const depResult = isInsideDependencies(text, tokenStart);
  if (depResult.inside) {
    const beforeToken = text.slice(0, tokenStart);
    if (isInValuePosition(beforeToken)) {
      return "version";
    }
    return "packageName";
  }

  return "unknown";
}

/**
 * Find all string tokens in text
 */
export function findStringTokens(text: string, lineIndex: LineIndex): Map<number, TokenLocation> {
  const tokens = new Map<number, TokenLocation>();
  const stringPattern = /"([^"\\]|\\.)*"/g;
  let match: RegExpExecArray | null;

  while ((match = stringPattern.exec(text)) !== null) {
    const start = match.index;
    const value = match[0].slice(1, -1);
    const startPos = lineIndex.positionAt(start);
    const endPos = lineIndex.positionAt(start + match[0].length);

    tokens.set(start, {
      value,
      range: { start: startPos, end: endPos },
    });
  }

  return tokens;
}

/**
 * Find token at a specific position
 */
export function findTokenAtPosition(
  document: TextDocument,
  position: Position
): TokenLocation | null {
  const text = document.getText();
  const offset = document.offsetAt(position);
  const stringPattern = /"([^"\\]|\\.)*"/g;
  let match: RegExpExecArray | null;

  while ((match = stringPattern.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;

    if (offset >= start && offset <= end) {
      const value = match[0].slice(1, -1);
      const startPos = document.positionAt(start);
      const endPos = document.positionAt(end);
      return { value, range: { start: startPos, end: endPos } };
    }
  }

  return null;
}

/**
 * Find dependencies object boundaries
 */
export function findDependenciesBoundaries(text: string): { start: number; end: number } | null {
  const match = findObjectStart(text, /"dependencies"\s*:\s*\{/);
  if (!match) return null;

  const startOffset = match.index + match.length;
  let braceCount = 1;
  let endOffset = startOffset;

  for (let i = startOffset; i < text.length; i++) {
    if (text[i] === "{") braceCount++;
    if (text[i] === "}") braceCount--;
    if (braceCount === 0) {
      endOffset = i;
      break;
    }
  }

  return { start: startOffset, end: endOffset };
}

/**
 * Find scopedRegistries array boundaries
 */
export function findScopedRegistriesBoundaries(text: string): { start: number; end: number } | null {
  const match = findObjectStart(text, /"scopedRegistries"\s*:\s*\[/);
  if (!match) return null;

  const startOffset = match.index + match.length;
  let bracketCount = 1;
  let endOffset = startOffset;

  for (let i = startOffset; i < text.length; i++) {
    if (text[i] === "[") bracketCount++;
    if (text[i] === "]") bracketCount--;
    if (bracketCount === 0) {
      endOffset = i;
      break;
    }
  }

  return { start: startOffset, end: endOffset };
}

/**
 * Parse JSON error position from error message
 */
export function parseJsonErrorPosition(lineIndex: LineIndex, errorMessage: string): Position {
  const positionMatch = errorMessage.match(/position\s+(\d+)/i);
  if (positionMatch) {
    const offset = parseInt(positionMatch[1], 10);
    return lineIndex.positionAt(offset);
  }

  const lineColMatch = errorMessage.match(/line\s+(\d+)\s+column\s+(\d+)/i);
  if (lineColMatch) {
    return {
      line: parseInt(lineColMatch[1], 10) - 1,
      character: parseInt(lineColMatch[2], 10) - 1,
    };
  }

  return { line: 0, character: 0 };
}

/**
 * Check if value is a GitHub/Git URL
 */
export function isGitHubUrl(value: string): boolean {
  return GITHUB_URL_PATTERN.test(value) || GIT_URL_PATTERN.test(value);
}

/**
 * Extract normalized GitHub URL from git dependency value
 */
export function extractGitHubUrl(value: string): string | null {
  let url = value.replace(/^git\+/, "");
  url = url.replace(/#.*$/, "");
  url = url.replace(/\.git$/, "");
  url = url.replace(/^git@github\.com:/, "https://github.com/");

  if (GITHUB_URL_PATTERN.test(url)) {
    return url;
  }
  return null;
}
