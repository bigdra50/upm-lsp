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

# Run tests
npm test
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
        ┌────────────┴────────────┐
        │                         │
        ▼                         ▼
┌──────────────────┐    ┌─────────────────┐
│ RegistryService  │    │  src/utils/     │
│  (orchestrator)  │    │  - fileReference│
└────────┬─────────┘    │  - packageJson  │
         │              │  - jsonHelper   │
         │              └─────────────────┘
     ┌───┴───┬───────────┬───────────┐
     │       │           │           │
     ▼       ▼           ▼           ▼
┌───────┐┌───────┐┌──────────┐┌──────────┐
│ Unity ││OpenUPM││  GitHub  ││  Local   │
│Registry││Registry││ Registry ││ Registry │
└───────┘└───────┘└──────────┘└──────────┘
```

## Key Files

### Core

| File | Description |
|------|-------------|
| `src/server.ts` | LSP entry point, connection setup |
| `src/types.ts` | ManifestJson, PackageInfo, ProviderRegistryClient |
| `src/services/registryService.ts` | Registry orchestrator, cache management |

### Providers

| File | Description |
|------|-------------|
| `src/providers/completionProvider.ts` | JSON position-aware completion |
| `src/providers/hoverProvider.ts` | Package/GitHub/Local info on hover |
| `src/providers/diagnosticProvider.ts` | JSON validation, package/path existence |

### Registries

| File | Description |
|------|-------------|
| `src/registries/registryClient.ts` | Cache class, base interface |
| `src/registries/unityRegistry.ts` | packages.unity.com client |
| `src/registries/openUpmRegistry.ts` | package.openupm.com client |
| `src/registries/githubRegistry.ts` | GitHub API client for tags/branches |
| `src/registries/unityEditorRegistry.ts` | Local Unity Editor built-in packages |
| `src/registries/localPackageRegistry.ts` | Local file: protocol packages |

### Utilities

| File | Description |
|------|-------------|
| `src/utils/fileReference.ts` | file: protocol parsing, validation, path resolution |
| `src/utils/packageJson.ts` | package.json reading utility |
| `src/utils/jsonHelper.ts` | JSON position/token utilities |

## Supported Package Sources

| Source | Format | Example |
|--------|--------|---------|
| Unity Registry | `"name": "version"` | `"com.unity.inputsystem": "1.7.0"` |
| OpenUPM | `"name": "version"` | `"com.cysharp.unitask": "2.5.0"` |
| GitHub | `"name": "git+url"` | `"com.example.pkg": "https://github.com/owner/repo.git#v1.0.0"` |
| Local (file:) | `"name": "file:path"` | `"com.mycompany.pkg": "file:../LocalPackages/my-pkg"` |
| Unity Editor | Built-in | `"com.unity.modules.physics": "1.0.0"` |

## file: Protocol Support

Unity Package Manager の file: プロトコルをサポート:

```json
{
  "dependencies": {
    "com.example.local": "file:../LocalPackages/my-pkg",
    "com.example.absolute": "file:/Users/dev/packages/pkg",
    "com.example.tarball": "file:../Downloads/package.tgz"
  }
}
```

### Features

- Path validation (existence check)
- package.json validation
- Hover info for local packages
- Cross-platform path handling (use `/` not `\`)
- Project boundary warnings (informational)

### Path Resolution

- Relative paths: resolved from `Packages/` directory (where manifest.json is)
- Absolute paths: used as-is
- `file://` (Git protocol): not supported (different from `file:`)

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
# Run all tests
npm test

# Test with sample manifest
echo '{"dependencies":{"com.unity.inputsystem":"1.0.0"}}' | \
  node dist/server.js --stdio
```
