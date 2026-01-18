import {
  CompletionItem,
  CompletionItemKind,
  Position,
  InsertTextFormat,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { PackageInfo } from "../types";
import { getJsonContext, JsonContext } from "../utils/jsonHelper";

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
 * @deprecated Use getJsonContext from jsonHelper instead
 */
export function isInDependenciesKey(text: string, offset: number): { isInKey: boolean; partial: string } {
  const document = TextDocument.create("", "json", 0, text);
  const position = document.positionAt(offset);
  const context = getJsonContext(document, position);

  if (context.type === "dependenciesKey") {
    return { isInKey: true, partial: context.partial };
  }
  return { isInKey: false, partial: "" };
}

/**
 * Check if the cursor is within the value position of a dependencies entry
 * @deprecated Use getJsonContext from jsonHelper instead
 */
export function isInDependenciesValue(text: string, offset: number): { isInValue: boolean; packageName: string; partial: string } {
  const document = TextDocument.create("", "json", 0, text);
  const position = document.positionAt(offset);
  const context = getJsonContext(document, position);

  if (context.type === "dependenciesValue") {
    return { isInValue: true, packageName: context.packageName, partial: context.partial };
  }
  return { isInValue: false, packageName: "", partial: "" };
}

/**
 * Check if the cursor is within a scopedRegistries array object
 * @deprecated Use getJsonContext from jsonHelper instead
 */
export function isInScopedRegistriesObject(text: string, offset: number): boolean {
  const document = TextDocument.create("", "json", 0, text);
  const position = document.positionAt(offset);
  const context = getJsonContext(document, position);
  return context.type === "scopedRegistriesObject";
}

/**
 * Create completion items from package info
 */
function createPackageCompletionItems(packages: PackageInfo[], partial: string): CompletionItem[] {
  return packages
    .filter(pkg => pkg.name.toLowerCase().includes(partial.toLowerCase()))
    .slice(0, 50)
    .map((pkg, index) => ({
      label: pkg.name,
      kind: CompletionItemKind.Module,
      detail: pkg.displayName || pkg.name,
      documentation: pkg.description || undefined,
      sortText: String(index).padStart(5, "0"),
      insertText: `"${pkg.name}": "$1"`,
      insertTextFormat: InsertTextFormat.Snippet,
      data: { packageName: pkg.name },
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
 * Get completions based on JSON context
 */
function getCompletionsForContext(context: JsonContext): CompletionItem[] {
  switch (context.type) {
    case "scopedRegistriesObject":
      return SCOPED_REGISTRY_KEYS;
    case "topLevel":
      return TOP_LEVEL_KEYS;
    default:
      return [];
  }
}

/**
 * Get completions based on cursor position in the document (sync version)
 * Returns static completions only
 */
export function getCompletions(
  document: TextDocument,
  position: Position
): CompletionItem[] {
  const context = getJsonContext(document, position);
  return getCompletionsForContext(context);
}

/**
 * Get completions with async package search
 */
export async function getCompletionsAsync(
  document: TextDocument,
  position: Position,
  searchProvider?: PackageSearchProvider
): Promise<CompletionItem[]> {
  const context = getJsonContext(document, position);

  // Handle dependencies key position (package name completion)
  if (context.type === "dependenciesKey" && searchProvider) {
    const packages = await searchProvider.searchPackages(context.partial || "com.unity");
    return createPackageCompletionItems(packages, context.partial);
  }

  // Handle dependencies value position (version completion)
  if (context.type === "dependenciesValue" && searchProvider && context.packageName) {
    const versions = await searchProvider.getVersions(context.packageName);
    return createVersionCompletionItems(versions, context.partial);
  }

  // Fall back to static completions
  return getCompletionsForContext(context);
}
