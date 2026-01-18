/**
 * Diagnostic provider for UPM manifest.json
 * Validates JSON syntax, package names, versions, and scoped registries
 */

import {
  Diagnostic,
  DiagnosticSeverity,
  Position,
  Range,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import { ProviderRegistryClient } from "../types";

/**
 * Diagnostic source identifier
 */
const DIAGNOSTIC_SOURCE = "upm-lsp";

/**
 * Token location information
 */
interface TokenLocation {
  /** Token value (without quotes) */
  value: string;
  /** Token range in document */
  range: Range;
}

/**
 * Dependency entry with location
 */
interface DependencyEntry {
  /** Package name */
  name: TokenLocation;
  /** Version string */
  version: TokenLocation;
}

/**
 * Scoped registry entry with location
 */
interface ScopedRegistryEntry {
  /** Registry name */
  name?: TokenLocation;
  /** Registry URL */
  url?: TokenLocation;
  /** Scopes array range */
  scopesRange?: Range;
  /** Individual scopes */
  scopes: TokenLocation[];
  /** Full registry object range */
  range: Range;
}

/**
 * Find the position of a JSON parse error from the error message
 *
 * @param text - Document text
 * @param errorMessage - JSON parse error message
 * @returns Position of the error
 */
function findJsonErrorPosition(text: string, errorMessage: string): Position {
  // Try to extract position from error message
  // Node.js format: "at position N" or "in JSON at position N"
  const positionMatch = errorMessage.match(/position\s+(\d+)/i);
  if (positionMatch) {
    const offset = parseInt(positionMatch[1], 10);
    return offsetToPosition(text, offset);
  }

  // Try line/column format: "line N column M"
  const lineColMatch = errorMessage.match(/line\s+(\d+)\s+column\s+(\d+)/i);
  if (lineColMatch) {
    return {
      line: parseInt(lineColMatch[1], 10) - 1,
      character: parseInt(lineColMatch[2], 10) - 1,
    };
  }

  // Default to start of document
  return { line: 0, character: 0 };
}

/**
 * Convert offset to Position
 *
 * @param text - Document text
 * @param offset - Character offset
 * @returns Position
 */
function offsetToPosition(text: string, offset: number): Position {
  let line = 0;
  let character = 0;

  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === "\n") {
      line++;
      character = 0;
    } else {
      character++;
    }
  }

  return { line, character };
}

/**
 * Find all string tokens in the document with their positions
 *
 * @param text - Document text
 * @returns Map of string values to their locations
 */
function findStringTokens(text: string): Map<number, TokenLocation> {
  const tokens = new Map<number, TokenLocation>();
  const stringPattern = /"([^"\\]|\\.)*"/g;
  let match: RegExpExecArray | null;

  while ((match = stringPattern.exec(text)) !== null) {
    const start = match.index;
    const value = match[0].slice(1, -1); // Remove quotes
    const startPos = offsetToPosition(text, start);
    const endPos = offsetToPosition(text, start + match[0].length);

    tokens.set(start, {
      value,
      range: { start: startPos, end: endPos },
    });
  }

  return tokens;
}

/**
 * Find dependencies entries with their positions
 *
 * @param text - Document text
 * @param tokens - Pre-computed string tokens
 * @returns Array of dependency entries
 */
function findDependencies(
  text: string,
  tokens: Map<number, TokenLocation>
): DependencyEntry[] {
  const dependencies: DependencyEntry[] = [];

  // Find dependencies object
  const dependenciesMatch = text.match(/"dependencies"\s*:\s*\{/);
  if (!dependenciesMatch || dependenciesMatch.index === undefined) {
    return dependencies;
  }

  const startOffset = dependenciesMatch.index + dependenciesMatch[0].length;

  // Find the end of dependencies object
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

  // Extract key-value pairs within dependencies
  const dependenciesContent = text.slice(startOffset, endOffset);

  // Pattern: "package-name": "version"
  const entryPattern = /"([^"]+)"\s*:\s*"([^"]+)"/g;
  let entryMatch: RegExpExecArray | null;

  while ((entryMatch = entryPattern.exec(dependenciesContent)) !== null) {
    const absoluteOffset = startOffset + entryMatch.index;

    // Find the name token
    const nameToken = tokens.get(absoluteOffset);
    if (!nameToken) continue;

    // Find the value token (after the colon)
    const colonPos = text.indexOf(":", absoluteOffset + entryMatch[1].length + 2);
    const valueStart = text.indexOf('"', colonPos);
    const valueToken = tokens.get(valueStart);
    if (!valueToken) continue;

    dependencies.push({
      name: nameToken,
      version: valueToken,
    });
  }

  return dependencies;
}

/**
 * Find scoped registries with their positions
 *
 * @param text - Document text
 * @param tokens - Pre-computed string tokens
 * @returns Array of scoped registry entries
 */
function findScopedRegistries(
  text: string,
  tokens: Map<number, TokenLocation>
): ScopedRegistryEntry[] {
  const registries: ScopedRegistryEntry[] = [];

  // Find scopedRegistries array
  const registriesMatch = text.match(/"scopedRegistries"\s*:\s*\[/);
  if (!registriesMatch || registriesMatch.index === undefined) {
    return registries;
  }

  const arrayStart = registriesMatch.index + registriesMatch[0].length;

  // Find registry objects within the array
  let bracketCount = 1;
  let braceCount = 0;
  let objectStart = -1;
  let i = arrayStart;

  while (i < text.length && bracketCount > 0) {
    const char = text[i];

    if (char === "[") bracketCount++;
    if (char === "]") bracketCount--;

    if (char === "{") {
      if (braceCount === 0) {
        objectStart = i;
      }
      braceCount++;
    }

    if (char === "}") {
      braceCount--;
      if (braceCount === 0 && objectStart !== -1) {
        // Found a complete registry object
        const objectEnd = i + 1;
        const objectText = text.slice(objectStart, objectEnd);
        const registry = parseRegistryObject(
          text,
          objectText,
          objectStart,
          objectEnd,
          tokens
        );
        registries.push(registry);
        objectStart = -1;
      }
    }

    i++;
  }

  return registries;
}

/**
 * Parse a single scoped registry object
 *
 * @param fullText - Full document text
 * @param objectText - Registry object text
 * @param objectStart - Start offset of the object
 * @param objectEnd - End offset of the object
 * @param tokens - Pre-computed string tokens
 * @returns Parsed scoped registry entry
 */
function parseRegistryObject(
  fullText: string,
  objectText: string,
  objectStart: number,
  objectEnd: number,
  tokens: Map<number, TokenLocation>
): ScopedRegistryEntry {
  const startPos = offsetToPosition(fullText, objectStart);
  const endPos = offsetToPosition(fullText, objectEnd);

  const registry: ScopedRegistryEntry = {
    scopes: [],
    range: { start: startPos, end: endPos },
  };

  // Find name
  const nameMatch = objectText.match(/"name"\s*:\s*"([^"]+)"/);
  if (nameMatch) {
    const nameOffset = objectStart + objectText.indexOf('"name"');
    const valueStart = fullText.indexOf('"', nameOffset + 6); // Skip past "name":
    const valueToken = tokens.get(valueStart);
    if (valueToken) {
      registry.name = valueToken;
    }
  }

  // Find url
  const urlMatch = objectText.match(/"url"\s*:\s*"([^"]+)"/);
  if (urlMatch) {
    const urlOffset = objectStart + objectText.indexOf('"url"');
    const valueStart = fullText.indexOf('"', urlOffset + 5); // Skip past "url":
    const valueToken = tokens.get(valueStart);
    if (valueToken) {
      registry.url = valueToken;
    }
  }

  // Find scopes
  const scopesMatch = objectText.match(/"scopes"\s*:\s*\[/);
  if (scopesMatch && scopesMatch.index !== undefined) {
    const scopesStart = objectStart + scopesMatch.index;
    const scopesArrayStart = scopesStart + scopesMatch[0].length;

    // Find end of scopes array
    let bracketCount = 1;
    let scopesArrayEnd = scopesArrayStart;
    for (let j = scopesArrayStart; j < fullText.length && bracketCount > 0; j++) {
      if (fullText[j] === "[") bracketCount++;
      if (fullText[j] === "]") bracketCount--;
      scopesArrayEnd = j;
    }

    registry.scopesRange = {
      start: offsetToPosition(fullText, scopesStart),
      end: offsetToPosition(fullText, scopesArrayEnd + 1),
    };

    // Find individual scope strings
    const scopesContent = fullText.slice(scopesArrayStart, scopesArrayEnd);
    const scopePattern = /"([^"]+)"/g;
    let scopeMatch: RegExpExecArray | null;

    while ((scopeMatch = scopePattern.exec(scopesContent)) !== null) {
      const scopeOffset = scopesArrayStart + scopeMatch.index;
      const scopeToken = tokens.get(scopeOffset);
      if (scopeToken) {
        registry.scopes.push(scopeToken);
      }
    }
  }

  return registry;
}

/**
 * Validate JSON syntax and return parse error diagnostic if any
 *
 * @param document - Text document
 * @returns JSON parse error diagnostic or null
 */
function validateJsonSyntax(document: TextDocument): Diagnostic | null {
  const text = document.getText();

  try {
    JSON.parse(text);
    return null;
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    const errorPos = findJsonErrorPosition(text, errorMessage);

    return {
      severity: DiagnosticSeverity.Error,
      range: {
        start: errorPos,
        end: { line: errorPos.line, character: errorPos.character + 1 },
      },
      message: `JSON syntax error: ${errorMessage}`,
      source: DIAGNOSTIC_SOURCE,
    };
  }
}

/**
 * Validate semver version format
 *
 * @param version - Version string
 * @returns true if valid semver format
 */
function isValidVersionFormat(version: string): boolean {
  // Allow various UPM version formats:
  // - Semver: 1.0.0, 1.0.0-preview.1
  // - Git URLs: git+https://..., git@github.com:...
  // - File paths: file:../path
  // - Keywords: latest

  if (version === "latest") return true;
  if (version.startsWith("file:")) return true;
  if (version.startsWith("git+")) return true;
  if (version.startsWith("git@")) return true;
  if (version.startsWith("https://")) return true;
  if (version.startsWith("http://")) return true;

  // Basic semver pattern
  const semverPattern = /^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/;
  return semverPattern.test(version);
}

/**
 * Get diagnostics for a document
 *
 * @param document - Text document
 * @param registryClient - Registry client for package validation
 * @returns Array of diagnostics
 */
export async function getDiagnostics(
  document: TextDocument,
  registryClient: ProviderRegistryClient
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  const text = document.getText();

  // 1. Check JSON syntax
  const syntaxError = validateJsonSyntax(document);
  if (syntaxError) {
    diagnostics.push(syntaxError);
    // Don't continue if JSON is invalid
    return diagnostics;
  }

  // Pre-compute string tokens
  const tokens = findStringTokens(text);

  // 2. Validate dependencies
  const dependencies = findDependencies(text, tokens);

  for (const dep of dependencies) {
    // Check version format
    if (!isValidVersionFormat(dep.version.value)) {
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range: dep.version.range,
        message: `Invalid version format: "${dep.version.value}"`,
        source: DIAGNOSTIC_SOURCE,
      });
      continue;
    }

    // Skip validation for non-registry dependencies
    if (
      dep.version.value.startsWith("file:") ||
      dep.version.value.startsWith("git") ||
      dep.version.value.startsWith("http")
    ) {
      continue;
    }

    // Check if package exists
    const exists = await registryClient.packageExists(dep.name.value);
    if (!exists) {
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range: dep.name.range,
        message: `Unknown package: "${dep.name.value}"`,
        source: DIAGNOSTIC_SOURCE,
      });
      continue;
    }

    // Check if version exists (UnityEditorRegistry provides accurate versions for com.unity.* packages)
    const versionExists = await registryClient.versionExists(
      dep.name.value,
      dep.version.value
    );
    if (!versionExists) {
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range: dep.version.range,
        message: `Version "${dep.version.value}" not found for package "${dep.name.value}"`,
        source: DIAGNOSTIC_SOURCE,
      });
    }

    // Check for deprecation
    const deprecationMessage = await registryClient.getDeprecationInfo(
      dep.name.value
    );
    if (deprecationMessage) {
      diagnostics.push({
        severity: DiagnosticSeverity.Hint,
        range: dep.name.range,
        message: `Deprecated: ${deprecationMessage}`,
        source: DIAGNOSTIC_SOURCE,
      });
    }
  }

  // 3. Validate scoped registries
  const registries = findScopedRegistries(text, tokens);

  for (const registry of registries) {
    // Check required fields
    if (!registry.name) {
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range: registry.range,
        message: 'Scoped registry missing required field: "name"',
        source: DIAGNOSTIC_SOURCE,
      });
    }

    if (!registry.url) {
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range: registry.range,
        message: 'Scoped registry missing required field: "url"',
        source: DIAGNOSTIC_SOURCE,
      });
    }

    // Check for empty scopes
    if (registry.scopesRange && registry.scopes.length === 0) {
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range: registry.scopesRange,
        message: "Scoped registry has empty scopes array",
        source: DIAGNOSTIC_SOURCE,
      });
    }

    if (!registry.scopesRange) {
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range: registry.range,
        message: 'Scoped registry missing required field: "scopes"',
        source: DIAGNOSTIC_SOURCE,
      });
    }
  }

  return diagnostics;
}
