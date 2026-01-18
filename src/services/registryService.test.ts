import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  RegistryService,
  RegistryClients,
  RegistryServiceConfig,
} from "./registryService";
import { PackageInfo } from "../types";
import { RegistryClient, Cache } from "../registries/registryClient";
import { GitHubRegistryClient } from "../registries/githubRegistry";
import { UnityEditorRegistryClient } from "../registries/unityEditorRegistry";
import { LocalPackageRegistryClient } from "../registries/localPackageRegistry";

/**
 * Create a mock registry client for testing
 */
function createMockRegistryClient(
  name: string,
  packages: PackageInfo[] = []
): RegistryClient {
  const packageMap = new Map(packages.map((p) => [p.name, p]));

  return {
    name,
    searchPackages: vi.fn(async (_query: string) => packages),
    getPackageInfo: vi.fn(async (packageName: string) => {
      return packageMap.get(packageName) ?? null;
    }),
    getVersions: vi.fn(async (packageName: string) => {
      const pkg = packageMap.get(packageName);
      return pkg ? [pkg.version] : [];
    }),
    clearCache: vi.fn(),
  };
}

/**
 * Create mock GitHub registry client
 */
function createMockGitHubClient(): GitHubRegistryClient {
  const client = {
    name: "GitHub",
    searchPackages: vi.fn(async () => []),
    getPackageInfo: vi.fn(async () => null),
    getVersions: vi.fn(async () => []),
    getTags: vi.fn(async () => ["v1.0.0", "v1.1.0"]),
    getBranches: vi.fn(async () => ["main", "develop"]),
    getAllRefs: vi.fn(async () => ["v1.0.0", "v1.1.0", "main", "develop"]),
    parseGitHubUrl: vi.fn(() => ({ owner: "test", repo: "repo" })),
    buildGitHubUrl: vi.fn(() => "https://github.com/test/repo.git"),
    fetchPackageJson: vi.fn(async () => null),
    clearCache: vi.fn(),
  } as unknown as GitHubRegistryClient;

  return client;
}

/**
 * Create mock Unity Editor registry client
 */
function createMockEditorClient(): UnityEditorRegistryClient {
  const client = {
    name: "unity-editor",
    searchPackages: vi.fn(async () => []),
    getPackageInfo: vi.fn(async () => null),
    getVersions: vi.fn(async () => []),
    versionExists: vi.fn(async () => false),
    packageExists: vi.fn(async () => false),
    getInstalledEditors: vi.fn(async () => []),
    clearCache: vi.fn(),
  } as unknown as UnityEditorRegistryClient;

  return client;
}

/**
 * Create mock Local Package registry client
 */
function createMockLocalClient(): LocalPackageRegistryClient {
  const client = {
    name: "local",
    searchPackages: vi.fn(async () => []),
    getPackageInfo: vi.fn(async () => null),
    getVersions: vi.fn(async () => []),
    versionExists: vi.fn(async () => false),
    packageExists: vi.fn(async () => false),
    setManifestDir: vi.fn(),
    getManifestDir: vi.fn(() => null),
    resolveReference: vi.fn(async () => ({
      reference: "",
      absolutePath: "",
      exists: false,
      packageInfo: null,
    })),
    listDirectories: vi.fn(async () => []),
    hasPackageJson: vi.fn(async () => false),
    clearCache: vi.fn(),
  } as unknown as LocalPackageRegistryClient;

  return client;
}

describe("RegistryService", () => {
  let unityClient: RegistryClient;
  let openUpmClient: RegistryClient;
  let githubClient: GitHubRegistryClient;
  let editorClient: UnityEditorRegistryClient;
  let localClient: LocalPackageRegistryClient;
  let clients: RegistryClients;

  beforeEach(() => {
    unityClient = createMockRegistryClient("Unity", [
      { name: "com.unity.inputsystem", version: "1.7.0", displayName: "Input System" },
      { name: "com.unity.textmeshpro", version: "3.2.0", displayName: "TextMeshPro" },
    ]);

    openUpmClient = createMockRegistryClient("OpenUPM", [
      { name: "com.cysharp.unitask", version: "2.5.0", displayName: "UniTask" },
    ]);

    githubClient = createMockGitHubClient();
    editorClient = createMockEditorClient();
    localClient = createMockLocalClient();

    clients = {
      unity: unityClient,
      openUpm: openUpmClient,
      github: githubClient,
      editor: editorClient,
      local: localClient,
    };
  });

  describe("constructor", () => {
    it("uses default config when not provided", () => {
      const service = new RegistryService(clients);
      expect(service).toBeDefined();
    });

    it("accepts custom config", () => {
      const config: RegistryServiceConfig = {
        versionCacheTtlMs: 1000,
        versionCacheMaxEntries: 100,
        packageListCacheTtlMs: 2000,
      };
      const service = new RegistryService(clients, config);
      expect(service).toBeDefined();
    });
  });

  describe("getAllPackages", () => {
    it("returns merged packages from Unity and OpenUPM", async () => {
      const service = new RegistryService(clients);
      const packages = await service.getAllPackages();

      expect(packages).toHaveLength(3);
      expect(packages.map((p) => p.name)).toContain("com.unity.inputsystem");
      expect(packages.map((p) => p.name)).toContain("com.unity.textmeshpro");
      expect(packages.map((p) => p.name)).toContain("com.cysharp.unitask");
    });

    it("deduplicates packages (Unity takes precedence)", async () => {
      // Add same package to both registries
      const duplicatePackage: PackageInfo = {
        name: "com.unity.test",
        version: "1.0.0",
        displayName: "Test Package",
      };

      unityClient = createMockRegistryClient("Unity", [
        { ...duplicatePackage, version: "2.0.0" }, // Unity has newer version
      ]);
      openUpmClient = createMockRegistryClient("OpenUPM", [
        { ...duplicatePackage, version: "1.0.0" },
      ]);

      const service = new RegistryService({
        unity: unityClient,
        openUpm: openUpmClient,
        github: githubClient,
        editor: editorClient,
        local: localClient,
      });

      const packages = await service.getAllPackages();

      expect(packages).toHaveLength(1);
      expect(packages[0].version).toBe("2.0.0"); // Unity version takes precedence
    });

    it("caches package list", async () => {
      const service = new RegistryService(clients);

      await service.getAllPackages();
      await service.getAllPackages();

      // searchPackages should only be called once per client (cached)
      expect(unityClient.searchPackages).toHaveBeenCalledTimes(1);
      expect(openUpmClient.searchPackages).toHaveBeenCalledTimes(1);
    });

    it("handles registry errors gracefully", async () => {
      const failingClient = createMockRegistryClient("Failing");
      failingClient.searchPackages = vi.fn(async () => {
        throw new Error("Network error");
      });

      const service = new RegistryService({
        unity: failingClient,
        openUpm: openUpmClient,
        github: githubClient,
        editor: editorClient,
        local: localClient,
      });

      const packages = await service.getAllPackages();

      // Should still return packages from working registry
      expect(packages.map((p) => p.name)).toContain("com.cysharp.unitask");
    });
  });

  describe("getVersions", () => {
    it("returns versions from cache if available", async () => {
      const service = new RegistryService(clients);

      await service.getVersions("com.unity.inputsystem");
      await service.getVersions("com.unity.inputsystem");

      // Should only call getVersions once (cached)
      expect(unityClient.getVersions).toHaveBeenCalledTimes(1);
    });

    it("falls back to OpenUPM if Unity returns empty", async () => {
      unityClient.getVersions = vi.fn(async () => []);
      openUpmClient.getVersions = vi.fn(async () => ["2.5.0", "2.4.0"]);

      const service = new RegistryService({
        unity: unityClient,
        openUpm: openUpmClient,
        github: githubClient,
        editor: editorClient,
        local: localClient,
      });

      const versions = await service.getVersions("com.cysharp.unitask");

      expect(versions).toEqual(["2.5.0", "2.4.0"]);
    });
  });

  describe("createPackageSearchProvider", () => {
    it("returns a valid PackageSearchProvider", async () => {
      const service = new RegistryService(clients);
      const provider = service.createPackageSearchProvider();

      expect(provider.searchPackages).toBeDefined();
      expect(provider.getVersions).toBeDefined();
    });

    it("searchPackages filters by query", async () => {
      const service = new RegistryService(clients);
      const provider = service.createPackageSearchProvider();

      const results = await provider.searchPackages("input");

      expect(results.length).toBeGreaterThan(0);
      expect(results.some((p) => p.name.includes("input"))).toBe(true);
    });

    it("searchPackages returns Unity packages when query is empty", async () => {
      const service = new RegistryService(clients);
      const provider = service.createPackageSearchProvider();

      const results = await provider.searchPackages("");

      // Should return com.unity.* packages by default
      expect(results.every((p) => p.name.startsWith("com.unity."))).toBe(true);
    });
  });

  describe("createProviderRegistryClient", () => {
    it("returns a valid ProviderRegistryClient", () => {
      const service = new RegistryService(clients);
      const client = service.createProviderRegistryClient();

      expect(client.getPackageInfo).toBeDefined();
      expect(client.packageExists).toBeDefined();
      expect(client.versionExists).toBeDefined();
      expect(client.getDeprecationInfo).toBeDefined();
      expect(client.getGitHubRepoInfo).toBeDefined();
    });

    it("packageExists returns true for existing package", async () => {
      const service = new RegistryService(clients);
      const client = service.createProviderRegistryClient();

      const exists = await client.packageExists("com.unity.inputsystem");

      expect(exists).toBe(true);
    });

    it("packageExists returns false for non-existing package", async () => {
      const service = new RegistryService(clients);
      const client = service.createProviderRegistryClient();

      const exists = await client.packageExists("com.unknown.package");

      expect(exists).toBe(false);
    });

    it("versionExists checks versions correctly", async () => {
      unityClient.getVersions = vi.fn(async () => ["1.7.0", "1.6.0"]);

      const service = new RegistryService({
        unity: unityClient,
        openUpm: openUpmClient,
        github: githubClient,
        editor: editorClient,
        local: localClient,
      });
      const client = service.createProviderRegistryClient();

      const exists170 = await client.versionExists("com.unity.inputsystem", "1.7.0");
      const exists100 = await client.versionExists("com.unity.inputsystem", "1.0.0");

      expect(exists170).toBe(true);
      expect(exists100).toBe(false);
    });

    it("getDeprecationInfo returns null (not implemented)", async () => {
      const service = new RegistryService(clients);
      const client = service.createProviderRegistryClient();

      const info = await client.getDeprecationInfo("com.unity.inputsystem");

      expect(info).toBeNull();
    });
  });

  describe("clearCache", () => {
    it("clears all caches", async () => {
      const service = new RegistryService(clients);

      // Populate caches
      await service.getAllPackages();
      await service.getVersions("com.unity.inputsystem");

      service.clearCache();

      // Fetch again - should call registries
      await service.getAllPackages();

      expect(unityClient.searchPackages).toHaveBeenCalledTimes(2);
      expect(unityClient.clearCache).toHaveBeenCalled();
      expect(openUpmClient.clearCache).toHaveBeenCalled();
      expect(githubClient.clearCache).toHaveBeenCalled();
      expect(editorClient.clearCache).toHaveBeenCalled();
      expect(localClient.clearCache).toHaveBeenCalled();
    });
  });

  describe("editorRegistry", () => {
    it("returns editor registry client", () => {
      const service = new RegistryService(clients);

      expect(service.editorRegistry).toBe(editorClient);
    });
  });

  describe("localRegistry", () => {
    it("returns local registry client", () => {
      const service = new RegistryService(clients);

      expect(service.localRegistry).toBe(localClient);
    });
  });

  describe("setManifestDir", () => {
    it("sets manifest directory on local client", () => {
      const service = new RegistryService(clients);

      service.setManifestDir("/path/to/manifest");

      expect(localClient.setManifestDir).toHaveBeenCalledWith("/path/to/manifest");
    });
  });

  describe("prefetchPackages", () => {
    it("calls getAllPackages without awaiting", () => {
      const service = new RegistryService(clients);

      // Should not throw
      service.prefetchPackages();

      // Eventually the registries should be called
      expect(unityClient.searchPackages).toHaveBeenCalled();
    });
  });
});
