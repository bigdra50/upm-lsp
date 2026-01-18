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
import { URI } from "vscode-uri";
import * as path from "path";

import { LspSettings } from "./types";
import { getCompletionsAsync, getHover, getDiagnostics } from "./providers";
import { RegistryService, Logger } from "./services";

// Create LSP connection via stdio
const connection = createConnection(ProposedFeatures.all);

// Document manager
const documents = new TextDocuments<TextDocument>(TextDocument);

// Logger adapter for RegistryService
const connectionLogger: Logger = {
  log: (message: string) => connection.console.log(message),
};

// Registry service (orchestrates registry clients and caching)
const registryService = new RegistryService(undefined, undefined, connectionLogger);
const packageSearchProvider = registryService.createPackageSearchProvider();
const providerRegistry = registryService.createProviderRegistryClient();

// Debounce state for diagnostics validation
const pendingValidations = new Map<string, { version: number; timer: ReturnType<typeof setTimeout> }>();
const VALIDATION_DEBOUNCE_MS = 400;

// Configuration
let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;

// LSP settings from initializationOptions
let lspSettings: LspSettings = {
  networkValidation: true, // default: enabled
};

connection.onInitialize((params: InitializeParams): InitializeResult => {
  // Parse initializationOptions
  const initOptions = params.initializationOptions as LspSettings | undefined;
  if (initOptions) {
    if (typeof initOptions.networkValidation === "boolean") {
      lspSettings.networkValidation = initOptions.networkValidation;
    }
  }
  connection.console.log(`Network validation: ${lspSettings.networkValidation ? "enabled" : "disabled"}`);

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
  registryService.editorRegistry.getInstalledEditors().then((editors) => {
    if (editors.length > 0) {
      connection.console.log(`Found ${editors.length} Unity Editor installation(s):`);
      for (const editor of editors) {
        connection.console.log(`  - ${editor.version}`);
      }
    } else {
      connection.console.log("No Unity Editor installations found (built-in package validation limited)");
    }
  }).catch(() => {});

  // Pre-fetch package list in background
  registryService.prefetchPackages();
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
  const diagnostics = await getDiagnostics(document, providerRegistry, {
    networkValidation: lspSettings.networkValidation ?? true,
  });
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

/**
 * Update manifest directory for local package resolution
 */
function updateManifestDir(documentUri: string): void {
  const manifestDir = path.dirname(URI.parse(documentUri).fsPath);
  registryService.setManifestDir(manifestDir);
}

// Document lifecycle handlers
documents.onDidOpen((event) => {
  if (!isManifestFile(event.document.uri)) return;

  updateManifestDir(event.document.uri);
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
