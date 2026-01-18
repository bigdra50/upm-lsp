import {
  CompletionItem,
  CompletionItemKind,
  Position,
  InsertTextFormat,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { PackageInfo } from "../types";

/**
 * Top-level keys for manifest.json
 */
const TOP_LEVEL_KEYS: CompletionItem[] = [
  {
    label: "dependencies",
    kind: CompletionItemKind.Property,
    detail: "Package dependencies",
    documentation: "Defines packages required by the project",
    insertText: '"dependencies": {\n  "$1"\n}',
    insertTextFormat: InsertTextFormat.Snippet,
  },
  {
    label: "scopedRegistries",
    kind: CompletionItemKind.Property,
    detail: "Custom package registries",
    documentation: "Defines custom npm registries for scoped packages",
    insertText: '"scopedRegistries": [\n  {\n    "name": "$1",\n    "url": "$2",\n    "scopes": [\n      "$3"\n    ]\n  }\n]',
    insertTextFormat: InsertTextFormat.Snippet,
  },
  {
    label: "testables",
    kind: CompletionItemKind.Property,
    detail: "Testable packages",
    documentation: "List of packages whose tests should be visible in Test Runner",
    insertText: '"testables": [\n  "$1"\n]',
    insertTextFormat: InsertTextFormat.Snippet,
  },
  {
    label: "enableLockFile",
    kind: CompletionItemKind.Property,
    detail: "Lock file control",
    documentation: "Enable or disable packages-lock.json generation",
    insertText: '"enableLockFile": ${1|true,false|}',
    insertTextFormat: InsertTextFormat.Snippet,
  },
];

/**
 * Keys inside scopedRegistries objects
 */
const SCOPED_REGISTRY_KEYS: CompletionItem[] = [
  {
    label: "name",
    kind: CompletionItemKind.Property,
    detail: "Registry name",
    documentation: "Display name for this registry",
    insertText: '"name": "$1"',
    insertTextFormat: InsertTextFormat.Snippet,
  },
  {
    label: "url",
    kind: CompletionItemKind.Property,
    detail: "Registry URL",
    documentation: "URL of the npm registry",
    insertText: '"url": "$1"',
    insertTextFormat: InsertTextFormat.Snippet,
  },
  {
    label: "scopes",
    kind: CompletionItemKind.Property,
    detail: "Package scopes",
    documentation: "Package name prefixes handled by this registry",
    insertText: '"scopes": [\n  "$1"\n]',
    insertTextFormat: InsertTextFormat.Snippet,
  },
];

/**
 * Package search provider interface
 */
export interface PackageSearchProvider {
  searchPackages(query: string): Promise<PackageInfo[]>;
  getVersions(packageName: string): Promise<string[]>;
}

/**
 * Check if the cursor is within the key position of a dependencies entry
 *
 * @param text - Full document text
 * @param offset - Cursor offset position
 * @returns Object with isInKey and partial input string
 */
export function isInDependenciesKey(text: string, offset: number): { isInKey: boolean; partial: string } {
  const beforeCursor = text.slice(0, offset);

  // Look for "dependencies" pattern and check nesting
  const dependenciesMatch = beforeCursor.match(/"dependencies"\s*:\s*\{/);
  if (!dependenciesMatch) {
    return { isInKey: false, partial: "" };
  }

  const dependenciesStart = dependenciesMatch.index! + dependenciesMatch[0].length;

  // Count braces to determine if we're still inside dependencies
  let braceCount = 1;
  for (let i = dependenciesStart; i < offset; i++) {
    if (text[i] === "{") braceCount++;
    if (text[i] === "}") braceCount--;
    if (braceCount === 0) return { isInKey: false, partial: "" };
  }

  if (braceCount <= 0) {
    return { isInKey: false, partial: "" };
  }

  // Check if we're in a key position (not after a colon)
  const lineStart = beforeCursor.lastIndexOf("\n") + 1;
  const currentLine = beforeCursor.slice(lineStart);

  // If line has a colon, we're in value position
  if (currentLine.includes(":")) {
    return { isInKey: false, partial: "" };
  }

  // Extract partial input (what user has typed so far)
  const quoteMatch = currentLine.match(/"([^"]*)"?$/);
  const partial = quoteMatch ? quoteMatch[1] : "";

  return { isInKey: true, partial };
}

/**
 * Check if the cursor is within the value position of a dependencies entry
 *
 * @param text - Full document text
 * @param offset - Cursor offset position
 * @returns Object with isInValue, packageName, and partial version
 */
export function isInDependenciesValue(text: string, offset: number): { isInValue: boolean; packageName: string; partial: string } {
  const beforeCursor = text.slice(0, offset);

  // Look for "dependencies" pattern and check nesting
  const dependenciesMatch = beforeCursor.match(/"dependencies"\s*:\s*\{/);
  if (!dependenciesMatch) {
    return { isInValue: false, packageName: "", partial: "" };
  }

  const dependenciesStart = dependenciesMatch.index! + dependenciesMatch[0].length;

  // Count braces to determine if we're still inside dependencies
  let braceCount = 1;
  for (let i = dependenciesStart; i < offset; i++) {
    if (text[i] === "{") braceCount++;
    if (text[i] === "}") braceCount--;
    if (braceCount === 0) return { isInValue: false, packageName: "", partial: "" };
  }

  if (braceCount <= 0) {
    return { isInValue: false, packageName: "", partial: "" };
  }

  // Check if we're after a colon (value position)
  const lineStart = beforeCursor.lastIndexOf("\n") + 1;
  const currentLine = beforeCursor.slice(lineStart);

  // Check for pattern like "key": followed by cursor
  const colonPattern = /:\s*"?$/;
  if (!colonPattern.test(currentLine)) {
    return { isInValue: false, packageName: "", partial: "" };
  }

  // Extract package name from the line
  const packageMatch = currentLine.match(/"([^"]+)"\s*:/);
  const packageName = packageMatch ? packageMatch[1] : "";

  // Extract partial version input
  const versionMatch = currentLine.match(/:\s*"([^"]*)"?$/);
  const partial = versionMatch ? versionMatch[1] : "";

  return { isInValue: true, packageName, partial };
}

/**
 * Check if the cursor is within a scopedRegistries array object
 */
export function isInScopedRegistriesObject(text: string, offset: number): boolean {
  const beforeCursor = text.slice(0, offset);

  const registriesMatch = beforeCursor.match(/"scopedRegistries"\s*:\s*\[/);
  if (!registriesMatch) {
    return false;
  }

  const registriesStart = registriesMatch.index! + registriesMatch[0].length;

  let bracketCount = 1;
  let braceCount = 0;
  let inObject = false;

  for (let i = registriesStart; i < offset; i++) {
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
    if (bracketCount === 0) return false;
  }

  return inObject && braceCount > 0;
}

/**
 * Check if cursor is at top-level object position
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
 * Create completion items from package info
 */
function createPackageCompletionItems(packages: PackageInfo[], partial: string): CompletionItem[] {
  return packages
    .filter(pkg => pkg.name.toLowerCase().includes(partial.toLowerCase()))
    .slice(0, 50) // Limit results
    .map((pkg, index) => ({
      label: pkg.name,
      kind: CompletionItemKind.Module,
      detail: pkg.displayName || pkg.name,
      documentation: pkg.description || undefined,
      sortText: String(index).padStart(5, "0"), // Maintain order
      insertText: `"${pkg.name}": "$1"`,
      insertTextFormat: InsertTextFormat.Snippet,
      data: { packageName: pkg.name }, // For resolve
    }));
}

/**
 * Create version completion items
 */
function createVersionCompletionItems(versions: string[], partial: string): CompletionItem[] {
  return versions
    .filter(v => v.startsWith(partial))
    .slice(0, 20)
    .map((version, index) => ({
      label: version,
      kind: CompletionItemKind.Value,
      detail: index === 0 ? "Latest" : undefined,
      sortText: String(index).padStart(5, "0"),
      insertText: version,
    }));
}

/**
 * Get completions based on cursor position in the document (sync version)
 * Returns static completions only
 */
export function getCompletions(
  document: TextDocument,
  position: Position
): CompletionItem[] {
  const text = document.getText();
  const offset = document.offsetAt(position);

  // Check scopedRegistries object position
  if (isInScopedRegistriesObject(text, offset)) {
    return SCOPED_REGISTRY_KEYS;
  }

  // Check top-level position
  if (isAtTopLevel(text, offset)) {
    return TOP_LEVEL_KEYS;
  }

  return [];
}

/**
 * Get completions with async package search
 */
export async function getCompletionsAsync(
  document: TextDocument,
  position: Position,
  searchProvider?: PackageSearchProvider
): Promise<CompletionItem[]> {
  const text = document.getText();
  const offset = document.offsetAt(position);

  // Check dependencies key position (package name completion)
  const keyInfo = isInDependenciesKey(text, offset);
  if (keyInfo.isInKey && searchProvider) {
    // Search for packages matching partial input
    const packages = await searchProvider.searchPackages(keyInfo.partial || "com.unity");
    return createPackageCompletionItems(packages, keyInfo.partial);
  }

  // Check dependencies value position (version completion)
  const valueInfo = isInDependenciesValue(text, offset);
  if (valueInfo.isInValue && searchProvider && valueInfo.packageName) {
    const versions = await searchProvider.getVersions(valueInfo.packageName);
    return createVersionCompletionItems(versions, valueInfo.partial);
  }

  // Fall back to sync completions
  return getCompletions(document, position);
}
