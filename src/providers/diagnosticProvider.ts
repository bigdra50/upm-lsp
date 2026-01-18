/**
 * Diagnostic provider for UPM manifest.json
 * Validates JSON syntax, package names, versions, and scoped registries
 */

import * as path from "path";

import {
  Diagnostic,
  DiagnosticSeverity,
  Range,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import { ProviderRegistryClient } from "../types";
import {
  LineIndex,
  TokenLocation,
  findStringTokens,
  findDependenciesBoundaries,
  findScopedRegistriesBoundaries,
  parseJsonErrorPosition,
} from "../utils/jsonHelper";
import {
  isFileReference,
  parseFileReference,
  resolveFileReference,
  validateFileReferenceFormat,
  checkFileReferenceWarnings,
  getDisplayPath,
  checkProjectBoundary,
} from "../utils/fileReference";
import { LocalPackageRegistryClient } from "../registries/localPackageRegistry";

const DIAGNOSTIC_SOURCE = "upm-lsp";

/**
 * Dependency entry with location
 */
interface DependencyEntry {
  name: TokenLocation;
  version: TokenLocation;
}

/**
 * Scoped registry entry with location
 */
interface ScopedRegistryEntry {
  name?: TokenLocation;
  url?: TokenLocation;
  scopesRange?: Range;
  scopes: TokenLocation[];
  range: Range;
}

/**
 * Validate JSON syntax
 */
function validateJsonSyntax(document: TextDocument, lineIndex: LineIndex): Diagnostic | null {
  const text = document.getText();

  try {
    JSON.parse(text);
    return null;
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    const errorPos = parseJsonErrorPosition(lineIndex, errorMessage);

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
 */
function isValidVersionFormat(version: string): boolean {
  if (version === "latest") return true;
  if (version.startsWith("file:")) return true;
  if (version.startsWith("git+")) return true;
  if (version.startsWith("git@")) return true;
  if (version.startsWith("https://")) return true;
  if (version.startsWith("http://")) return true;

  const semverPattern = /^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/;
  return semverPattern.test(version);
}

/**
 * Find dependencies entries with their positions
 */
function findDependencies(
  text: string,
  tokens: Map<number, TokenLocation>
): DependencyEntry[] {
  const dependencies: DependencyEntry[] = [];

  const boundaries = findDependenciesBoundaries(text);
  if (!boundaries) return dependencies;

  const { start: startOffset, end: endOffset } = boundaries;
  const dependenciesContent = text.slice(startOffset, endOffset);

  const entryPattern = /"([^"]+)"\s*:\s*"([^"]+)"/g;
  let entryMatch: RegExpExecArray | null;

  while ((entryMatch = entryPattern.exec(dependenciesContent)) !== null) {
    const absoluteOffset = startOffset + entryMatch.index;

    const nameToken = tokens.get(absoluteOffset);
    if (!nameToken) continue;

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
 * Parse a single scoped registry object
 */
function parseRegistryObject(
  fullText: string,
  objectText: string,
  objectStart: number,
  objectEnd: number,
  tokens: Map<number, TokenLocation>,
  lineIndex: LineIndex
): ScopedRegistryEntry {
  const startPos = lineIndex.positionAt(objectStart);
  const endPos = lineIndex.positionAt(objectEnd);

  const registry: ScopedRegistryEntry = {
    scopes: [],
    range: { start: startPos, end: endPos },
  };

  // Find name
  const nameMatch = objectText.match(/"name"\s*:\s*"([^"]+)"/);
  if (nameMatch) {
    const nameOffset = objectStart + objectText.indexOf('"name"');
    const valueStart = fullText.indexOf('"', nameOffset + 6);
    const valueToken = tokens.get(valueStart);
    if (valueToken) {
      registry.name = valueToken;
    }
  }

  // Find url
  const urlMatch = objectText.match(/"url"\s*:\s*"([^"]+)"/);
  if (urlMatch) {
    const urlOffset = objectStart + objectText.indexOf('"url"');
    const valueStart = fullText.indexOf('"', urlOffset + 5);
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

    let bracketCount = 1;
    let scopesArrayEnd = scopesArrayStart;
    for (let j = scopesArrayStart; j < fullText.length && bracketCount > 0; j++) {
      if (fullText[j] === "[") bracketCount++;
      if (fullText[j] === "]") bracketCount--;
      scopesArrayEnd = j;
    }

    registry.scopesRange = {
      start: lineIndex.positionAt(scopesStart),
      end: lineIndex.positionAt(scopesArrayEnd + 1),
    };

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
 * Find scoped registries with their positions
 */
function findScopedRegistries(
  text: string,
  tokens: Map<number, TokenLocation>,
  lineIndex: LineIndex
): ScopedRegistryEntry[] {
  const registries: ScopedRegistryEntry[] = [];

  const boundaries = findScopedRegistriesBoundaries(text);
  if (!boundaries) return registries;

  const arrayStart = boundaries.start;

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
        const objectEnd = i + 1;
        const objectText = text.slice(objectStart, objectEnd);
        const registry = parseRegistryObject(
          text,
          objectText,
          objectStart,
          objectEnd,
          tokens,
          lineIndex
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
 * Diagnostic options
 */
interface DiagnosticOptions {
  networkValidation: boolean;
}

/**
 * Get diagnostics for a document
 */
export async function getDiagnostics(
  document: TextDocument,
  registryClient: ProviderRegistryClient,
  options: DiagnosticOptions = { networkValidation: true }
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  const text = document.getText();

  // Get manifest directory for resolving file: references
  const documentUri = document.uri;
  const manifestPath = documentUri.startsWith("file://")
    ? documentUri.slice(7)
    : documentUri;
  const manifestDir = path.dirname(manifestPath);

  // Initialize local package registry for file: reference validation
  const localRegistry = new LocalPackageRegistryClient();
  localRegistry.setManifestDir(manifestDir);

  const lineIndex = new LineIndex(text);

  // 1. Check JSON syntax
  const syntaxError = validateJsonSyntax(document, lineIndex);
  if (syntaxError) {
    diagnostics.push(syntaxError);
    return diagnostics;
  }

  const tokens = findStringTokens(text, lineIndex);

  // 2. Validate dependencies
  const dependencies = findDependencies(text, tokens);

  for (const dep of dependencies) {
    if (!isValidVersionFormat(dep.version.value)) {
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range: dep.version.range,
        message: `Invalid version format: "${dep.version.value}"`,
        source: DIAGNOSTIC_SOURCE,
      });
      continue;
    }

    // Validate file: references (local filesystem, no network needed)
    if (isFileReference(dep.version.value)) {
      // 1. Format validation
      const formatValidation = validateFileReferenceFormat(dep.version.value);
      if (!formatValidation.valid) {
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: dep.version.range,
          message: formatValidation.error ?? "Invalid file: reference format",
          source: DIAGNOSTIC_SOURCE,
        });
        continue;
      }

      // 2. Check for warnings (backslash, spaces, etc.)
      const warnings = checkFileReferenceWarnings(dep.version.value);
      for (const warning of warnings) {
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range: dep.version.range,
          message: warning,
          source: DIAGNOSTIC_SOURCE,
        });
      }

      // 3. Parse and resolve path
      const fileInfoResult = parseFileReference(dep.version.value);
      if (!fileInfoResult.ok || fileInfoResult.value.isGitProtocol) {
        // Git-style file:// references are handled differently
        continue;
      }

      const absolutePath = resolveFileReference(dep.version.value, manifestDir);
      if (!absolutePath) {
        continue;
      }

      // 4. Check project boundary (Info level, not error)
      const boundaryCheck = checkProjectBoundary(absolutePath, manifestDir);
      if (!boundaryCheck.isWithinProject) {
        const displayPath = getDisplayPath(absolutePath, manifestDir);
        diagnostics.push({
          severity: DiagnosticSeverity.Information,
          range: dep.version.range,
          message: `${boundaryCheck.message}: ${displayPath}`,
          source: DIAGNOSTIC_SOURCE,
        });
      }

      // 5. Use LocalPackageRegistryClient for filesystem validation
      const resolved = await localRegistry.resolveReference(dep.version.value);
      const displayPath = getDisplayPath(resolved.absolutePath, manifestDir);

      if (!resolved.exists) {
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range: dep.version.range,
          message: `Local package path not found: ${displayPath}`,
          source: DIAGNOSTIC_SOURCE,
        });
      } else if (!resolved.packageInfo) {
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range: dep.version.range,
          message: `package.json not found in: ${displayPath}`,
          source: DIAGNOSTIC_SOURCE,
        });
      }
      continue;
    }

    // Skip git/http references (no validation)
    if (
      dep.version.value.startsWith("git") ||
      dep.version.value.startsWith("http")
    ) {
      continue;
    }

    // Skip network validation if disabled
    if (!options.networkValidation) {
      continue;
    }

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
  const registries = findScopedRegistries(text, tokens, lineIndex);

  for (const registry of registries) {
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
