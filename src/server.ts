#!/usr/bin/env node
/**
 * UPM Language Server - Unity Package Manager manifest.json support
 */

import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  InitializeResult,
  TextDocumentSyncKind,
  CompletionItem,
  Hover,
  TextDocumentPositionParams,
  DidChangeConfigurationNotification,
} from "vscode-languageserver/node";

import { TextDocument } from "vscode-languageserver-textdocument";

import { ProviderRegistryClient, GitHubRepoInfo, PackageInfo } from "./types";
import { getCompletionsAsync, getHover, getDiagnostics, PackageSearchProvider } from "./providers";
import {
  UnityRegistryClient,
  OpenUpmRegistryClient,
  GitHubRegistryClient,
  UnityEditorRegistryClient,
} from "./registries";

// Create LSP connection via stdio
const connection = createConnection(ProposedFeatures.all);

// Document manager
const documents = new TextDocuments<TextDocument>(TextDocument);

// Registry clients
const unityRegistry = new UnityRegistryClient();
const openUpmRegistry = new OpenUpmRegistryClient();
const githubRegistry = new GitHubRegistryClient();
const unityEditorRegistry = new UnityEditorRegistryClient();

// Cache for versions (to avoid repeated lookups)
const versionsCache = new Map<string, string[]>();

// Debounce state for diagnostics validation
const pendingValidations = new Map<string, { version: number; timer: ReturnType<typeof setTimeout> }>();
const VALIDATION_DEBOUNCE_MS = 400;

// Cache for package list (expensive to fetch)
let packageListCache: PackageInfo[] | null = null;
let packageListCacheTime = 0;
const PACKAGE_LIST_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

/**
 * Get all packages from registries (with caching)
 */
async function getAllPackages(): Promise<PackageInfo[]> {
  const now = Date.now();
  if (packageListCache && now - packageListCacheTime < PACKAGE_LIST_CACHE_TTL) {
    return packageListCache;
  }

  connection.console.log("Fetching package list from registries...");

  const [unityPackages, openUpmPackages] = await Promise.all([
    unityRegistry.searchPackages("").catch(() => []),
    openUpmRegistry.searchPackages("").catch(() => []),
  ]);

  // Merge and dedupe (Unity takes precedence)
  const packageMap = new Map<string, PackageInfo>();
  for (const pkg of [...openUpmPackages, ...unityPackages]) {
    packageMap.set(pkg.name, pkg);
  }

  packageListCache = Array.from(packageMap.values());
  packageListCacheTime = now;

  connection.console.log(`Cached ${packageListCache.length} packages`);
  return packageListCache;
}

/**
 * Create a PackageSearchProvider for completion
 */
function createPackageSearchProvider(): PackageSearchProvider {
  return {
    async searchPackages(query: string): Promise<PackageInfo[]> {
      const allPackages = await getAllPackages();

      if (!query) {
        // Return popular Unity packages as default
        return allPackages
          .filter(pkg => pkg.name.startsWith("com.unity."))
          .slice(0, 50);
      }

      // Filter by query
      const lowerQuery = query.toLowerCase();
      return allPackages
        .filter(pkg =>
          pkg.name.toLowerCase().includes(lowerQuery) ||
          (pkg.displayName && pkg.displayName.toLowerCase().includes(lowerQuery))
        )
        .slice(0, 50);
    },

    async getVersions(packageName: string): Promise<string[]> {
      // Check cache first
      let versions = versionsCache.get(packageName);
      if (versions) {
        return versions;
      }

      // For com.unity.* packages, try local Unity Editor first (has accurate versions)
      if (packageName.startsWith("com.unity.")) {
        versions = await unityEditorRegistry.getVersions(packageName).catch(() => []);
        if (versions.length > 0) {
          versionsCache.set(packageName, versions);
          return versions;
        }
      }

      // Try Unity registry, then OpenUPM
      versions = await unityRegistry.getVersions(packageName).catch(() => []);
      if (versions.length === 0) {
        versions = await openUpmRegistry.getVersions(packageName).catch(() => []);
      }

      versionsCache.set(packageName, versions);
      return versions;
    },
  };
}

const packageSearchProvider = createPackageSearchProvider();

/**
 * Create a ProviderRegistryClient adapter that wraps the base registry clients
 */
function createProviderRegistryClient(): ProviderRegistryClient {
  return {
    async getPackageInfo(packageName: string) {
      // For com.unity.* packages, try local Unity Editor first (more accurate)
      if (packageName.startsWith("com.unity.")) {
        const editorInfo = await unityEditorRegistry.getPackageInfo(packageName).catch(() => null);
        if (editorInfo) return editorInfo;
      }

      // Try Unity registry, then OpenUPM
      const unityInfo = await unityRegistry.getPackageInfo(packageName).catch(() => null);
      if (unityInfo) return unityInfo;
      return openUpmRegistry.getPackageInfo(packageName).catch(() => null);
    },

    async packageExists(packageName: string) {
      // For com.unity.* packages, check local Unity Editor first
      if (packageName.startsWith("com.unity.")) {
        const editorExists = await unityEditorRegistry.packageExists(packageName).catch(() => false);
        if (editorExists) return true;
      }

      const info = await this.getPackageInfo(packageName);
      return info !== null;
    },

    async versionExists(packageName: string, version: string) {
      // For com.unity.* packages, check local Unity Editor first
      if (packageName.startsWith("com.unity.")) {
        const editorVersionExists = await unityEditorRegistry.versionExists(packageName, version).catch(() => false);
        if (editorVersionExists) return true;
      }

      const versions = await packageSearchProvider.getVersions(packageName);
      return versions.includes(version);
    },

    async getDeprecationInfo(_packageName: string) {
      return null;
    },

    async getGitHubRepoInfo(url: string): Promise<GitHubRepoInfo | null> {
      try {
        const info = await githubRegistry.getPackageInfo(url);
        if (!info) return null;

        const match = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
        if (!match) return null;

        const [, owner, repo] = match;
        const tags = await githubRegistry.getTags(owner, repo).catch(() => []);

        return {
          fullName: `${owner}/${repo}`,
          description: info.description || null,
          stargazersCount: 0,
          latestTag: tags[0] || null,
          htmlUrl: `https://github.com/${owner}/${repo}`,
        };
      } catch {
        return null;
      }
    },
  };
}

const providerRegistry = createProviderRegistryClient();

// Configuration
let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;

connection.onInitialize((params: InitializeParams): InitializeResult => {
  const capabilities = params.capabilities;

  hasConfigurationCapability = !!(
    capabilities.workspace && capabilities.workspace.configuration
  );
  hasWorkspaceFolderCapability = !!(
    capabilities.workspace && capabilities.workspace.workspaceFolders
  );

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        resolveProvider: true,
        triggerCharacters: ['"', ":", ".", "#", "/"],
      },
      hoverProvider: true,
    },
  };

  if (hasWorkspaceFolderCapability) {
    result.capabilities.workspace = {
      workspaceFolders: {
        supported: true,
      },
    };
  }

  connection.console.log("UPM Language Server initialized");
  return result;
});

connection.onInitialized(() => {
  if (hasConfigurationCapability) {
    connection.client.register(
      DidChangeConfigurationNotification.type,
      undefined
    );
  }
  connection.console.log("UPM Language Server ready");

  // Log detected Unity Editor installations
  const editors = unityEditorRegistry.getInstalledEditors();
  if (editors.length > 0) {
    connection.console.log(`Found ${editors.length} Unity Editor installation(s):`);
    for (const editor of editors) {
      connection.console.log(`  - ${editor.version}`);
    }
  } else {
    connection.console.log("No Unity Editor installations found (built-in package validation limited)");
  }

  // Pre-fetch package list in background
  getAllPackages().catch(() => {});
});

/**
 * Check if document is a manifest.json file
 */
function isManifestFile(uri: string): boolean {
  return uri.endsWith("Packages/manifest.json") || uri.endsWith("manifest.json");
}

/**
 * Validate document and send diagnostics
 */
async function validateDocument(document: TextDocument): Promise<void> {
  const diagnostics = await getDiagnostics(document, providerRegistry);
  connection.sendDiagnostics({ uri: document.uri, diagnostics });
}

/**
 * Validate document with debouncing and version checking
 * Cancels pending validation if document version has changed
 */
function validateDocumentDebounced(document: TextDocument): void {
  const uri = document.uri;
  const version = document.version;

  // Cancel existing pending validation for this document
  const pending = pendingValidations.get(uri);
  if (pending) {
    clearTimeout(pending.timer);
  }

  // Schedule new validation
  const timer = setTimeout(async () => {
    // Check if document version is still current (not stale)
    const currentDoc = documents.get(uri);
    if (!currentDoc || currentDoc.version !== version) {
      // Document changed or closed, skip validation
      pendingValidations.delete(uri);
      return;
    }

    pendingValidations.delete(uri);
    await validateDocument(currentDoc);
  }, VALIDATION_DEBOUNCE_MS);

  pendingValidations.set(uri, { version, timer });
}

// Document lifecycle handlers
documents.onDidOpen((event) => {
  if (!isManifestFile(event.document.uri)) return;

  connection.console.log(`Opened: ${event.document.uri}`);
  validateDocument(event.document);
});

documents.onDidChangeContent((event) => {
  if (!isManifestFile(event.document.uri)) return;

  validateDocumentDebounced(event.document);
});

documents.onDidSave((event) => {
  if (!isManifestFile(event.document.uri)) return;

  connection.console.log(`Saved: ${event.document.uri}`);
  validateDocument(event.document);
});

documents.onDidClose((event) => {
  // Cancel pending validation if exists
  const pending = pendingValidations.get(event.document.uri);
  if (pending) {
    clearTimeout(pending.timer);
    pendingValidations.delete(event.document.uri);
  }
  connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

// Completion handler (async for package search)
connection.onCompletion(
  async (params: TextDocumentPositionParams): Promise<CompletionItem[]> => {
    const document = documents.get(params.textDocument.uri);
    if (!document || !isManifestFile(params.textDocument.uri)) {
      return [];
    }

    return getCompletionsAsync(document, params.position, packageSearchProvider);
  }
);

connection.onCompletionResolve(async (item: CompletionItem): Promise<CompletionItem> => {
  // If the item is a package name, fetch additional info
  if (item.data?.packageName) {
    const info = await providerRegistry.getPackageInfo(item.data.packageName);
    if (info) {
      item.documentation = {
        kind: "markdown",
        value: [
          `**${info.displayName || info.name}**`,
          "",
          info.description || "",
          "",
          `Unity: ${info.unity || "N/A"}`,
          `License: ${info.licensesUrl ? `[View](${info.licensesUrl})` : "N/A"}`,
        ].join("\n"),
      };
    }
  }
  return item;
});

// Hover handler
connection.onHover(async (params: TextDocumentPositionParams): Promise<Hover | null> => {
  const document = documents.get(params.textDocument.uri);
  if (!document || !isManifestFile(params.textDocument.uri)) {
    return null;
  }

  return getHover(document, params.position, providerRegistry);
});

// Start listening
documents.listen(connection);
connection.listen();
