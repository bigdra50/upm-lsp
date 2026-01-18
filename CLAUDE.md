# CLAUDE.md

Unity Package Manager manifest.json 向け Language Server。

## Commands

```bash
# Install dependencies
npm install

# Build
npm run build

# Run LSP (stdio mode)
node dist/server.js --stdio
# or after npm link:
upm-lsp --stdio
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        server.ts                            │
│  ─────────────────────────────────────────────────────────  │
│  LSP Connection (stdio) / TextDocuments Manager             │
│  onCompletion / onHover / onDiagnostics                     │
└────────────────────┬────────────────────────────────────────┘
                     │
     ┌───────────────┼───────────────┐
     │               │               │
     ▼               ▼               ▼
┌─────────┐   ┌───────────┐   ┌────────────────┐
│completion│   │   hover   │   │  diagnostics   │
│Provider │   │ Provider  │   │   Provider     │
└─────────┘   └───────────┘   └────────────────┘
     │               │               │
     └───────────────┼───────────────┘
                     │
                     ▼
        ┌────────────────────────┐
        │ ProviderRegistryClient │
        └────────────┬───────────┘
                     │
     ┌───────────────┼───────────────┐
     │               │               │
     ▼               ▼               ▼
┌─────────┐   ┌───────────┐   ┌──────────┐
│  Unity  │   │  OpenUPM  │   │  GitHub  │
│Registry │   │ Registry  │   │ Registry │
└─────────┘   └───────────┘   └──────────┘
```

## Key Files

| File | Description |
|------|-------------|
| `src/server.ts` | LSP entry point, connection setup |
| `src/types.ts` | ManifestJson, PackageInfo, ProviderRegistryClient |
| `src/providers/completionProvider.ts` | JSON position-aware completion |
| `src/providers/hoverProvider.ts` | Package/GitHub info on hover |
| `src/providers/diagnosticProvider.ts` | JSON validation, package existence |
| `src/registries/registryClient.ts` | Cache class, base interface |
| `src/registries/unityRegistry.ts` | packages.unity.com client |
| `src/registries/openUpmRegistry.ts` | package.openupm.com client |
| `src/registries/githubRegistry.ts` | GitHub API client for tags/branches |

## API Endpoints

| Registry | Endpoint | Purpose |
|----------|----------|---------|
| Unity | `https://packages.unity.com/-/all` | All packages |
| Unity | `https://packages.unity.com/{pkg}` | Package details |
| OpenUPM | `https://package.openupm.com/-/all` | All packages |
| OpenUPM | `https://package.openupm.com/{pkg}` | Package details |
| GitHub | `https://api.github.com/repos/{owner}/{repo}/tags` | Tags list |
| GitHub | `https://raw.githubusercontent.com/{owner}/{repo}/{ref}/package.json` | Package.json |

## Testing

```bash
# Test with sample manifest
echo '{"dependencies":{"com.unity.inputsystem":"1.0.0"}}' | \
  node dist/server.js --stdio

# Manual LSP test
npm test
```
