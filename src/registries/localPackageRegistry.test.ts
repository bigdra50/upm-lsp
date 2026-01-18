import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { LocalPackageRegistryClient } from "./localPackageRegistry";
import {
  parseFileReference,
  resolveFileReference,
} from "../utils/fileReference";

describe("parseFileReference", () => {
  it("should parse file: prefix and return FileReferenceInfo", () => {
    const result1 = parseFileReference("file:../my-package");
    expect(result1.ok).toBe(true);
    if (result1.ok) {
      expect(result1.value.path).toBe("../my-package");
      expect(result1.value.isAbsolute).toBe(false);
    }

    const result2 = parseFileReference("file:./local/pkg");
    expect(result2.ok).toBe(true);
    if (result2.ok) {
      expect(result2.value.path).toBe("./local/pkg");
    }

    const result3 = parseFileReference("file:/absolute/path");
    expect(result3.ok).toBe(true);
    if (result3.ok) {
      expect(result3.value.path).toBe("/absolute/path");
      expect(result3.value.isAbsolute).toBe(true);
    }
  });

  it("should return error for non-file references", () => {
    expect(parseFileReference("1.0.0").ok).toBe(false);
    expect(parseFileReference("https://github.com/owner/repo.git").ok).toBe(false);
    expect(parseFileReference("git+https://github.com/owner/repo.git").ok).toBe(false);
  });

  it("should detect tarballs", () => {
    const result = parseFileReference("file:../package.tgz");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.isTarball).toBe(true);
    }
  });
});

describe("resolveFileReference", () => {
  it("should resolve relative paths from manifest directory", () => {
    const manifestDir = "/project/Packages";
    expect(resolveFileReference("file:../my-package", manifestDir)).toBe(
      path.resolve("/project/my-package")
    );
    expect(resolveFileReference("file:./local-pkg", manifestDir)).toBe(
      path.resolve("/project/Packages/local-pkg")
    );
  });

  it("should return absolute paths unchanged", () => {
    const manifestDir = "/project/Packages";
    expect(resolveFileReference("file:/absolute/path", manifestDir)).toBe(
      path.normalize("/absolute/path")
    );
  });

  it("should return null for non-file references", () => {
    expect(resolveFileReference("1.0.0", "/any")).toBeNull();
  });
});

describe("LocalPackageRegistryClient", () => {
  let client: LocalPackageRegistryClient;
  let tempDir: string;
  let packageDir: string;

  beforeEach(async () => {
    client = new LocalPackageRegistryClient(0); // No cache for tests
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "upm-lsp-test-"));
    packageDir = path.join(tempDir, "my-local-package");
    await fs.mkdir(packageDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("setManifestDir", () => {
    it("should set and get manifest directory", () => {
      expect(client.getManifestDir()).toBeNull();
      client.setManifestDir("/some/dir");
      expect(client.getManifestDir()).toBe("/some/dir");
    });

    it("should clear cache when directory changes", async () => {
      // Create a client with longer cache TTL to verify cache behavior
      const cachedClient = new LocalPackageRegistryClient(60000);
      await fs.writeFile(
        path.join(packageDir, "package.json"),
        JSON.stringify({ name: "test", version: "1.0.0" })
      );

      cachedClient.setManifestDir(tempDir);

      // First resolve should read from filesystem and cache
      const result1 = await cachedClient.resolveReference("file:my-local-package");
      expect(result1.packageInfo?.version).toBe("1.0.0");

      // Change version on disk
      await fs.writeFile(
        path.join(packageDir, "package.json"),
        JSON.stringify({ name: "test", version: "2.0.0" })
      );

      // Setting same dir should NOT clear cache (still returns old version)
      cachedClient.setManifestDir(tempDir);
      const result2 = await cachedClient.resolveReference("file:my-local-package");
      expect(result2.packageInfo?.version).toBe("1.0.0");

      // Setting different dir should clear cache
      cachedClient.setManifestDir("/different/dir");
      cachedClient.setManifestDir(tempDir);
      const result3 = await cachedClient.resolveReference("file:my-local-package");
      expect(result3.packageInfo?.version).toBe("2.0.0");
    });
  });

  describe("resolveReference", () => {
    it("should resolve file reference and read package.json", async () => {
      const packageJson = {
        name: "com.example.local",
        version: "1.0.0",
        displayName: "Local Package",
        description: "A local package for testing",
      };
      await fs.writeFile(
        path.join(packageDir, "package.json"),
        JSON.stringify(packageJson)
      );

      client.setManifestDir(tempDir);
      const result = await client.resolveReference(
        `file:my-local-package`
      );

      expect(result.exists).toBe(true);
      expect(result.packageInfo).not.toBeNull();
      expect(result.packageInfo?.name).toBe("com.example.local");
      expect(result.packageInfo?.version).toBe("1.0.0");
    });

    it("should return exists=false for non-existent path", async () => {
      client.setManifestDir(tempDir);
      const result = await client.resolveReference("file:non-existent");

      expect(result.exists).toBe(false);
      expect(result.packageInfo).toBeNull();
    });

    it("should return packageInfo=null when directory exists but no package.json", async () => {
      client.setManifestDir(tempDir);
      const result = await client.resolveReference("file:my-local-package");

      expect(result.exists).toBe(true);
      expect(result.packageInfo).toBeNull();
    });
  });

  describe("getPackageInfo", () => {
    it("should return package info for valid file reference", async () => {
      const packageJson = {
        name: "com.test.pkg",
        version: "2.0.0",
      };
      await fs.writeFile(
        path.join(packageDir, "package.json"),
        JSON.stringify(packageJson)
      );

      client.setManifestDir(tempDir);
      const info = await client.getPackageInfo("file:my-local-package");

      expect(info).not.toBeNull();
      expect(info?.name).toBe("com.test.pkg");
      expect(info?.version).toBe("2.0.0");
    });

    it("should return null for non-file reference", async () => {
      const info = await client.getPackageInfo("com.unity.inputsystem");
      expect(info).toBeNull();
    });
  });

  describe("packageExists", () => {
    it("should return true when directory exists", async () => {
      client.setManifestDir(tempDir);
      const exists = await client.packageExists("file:my-local-package");
      expect(exists).toBe(true);
    });

    it("should return false for non-existent path", async () => {
      client.setManifestDir(tempDir);
      const exists = await client.packageExists("file:not-exists");
      expect(exists).toBe(false);
    });

    it("should return false for non-file reference", async () => {
      const exists = await client.packageExists("com.unity.inputsystem");
      expect(exists).toBe(false);
    });
  });

  describe("versionExists", () => {
    it("should return true when package.json exists", async () => {
      await fs.writeFile(
        path.join(packageDir, "package.json"),
        JSON.stringify({ name: "test", version: "1.0.0" })
      );

      client.setManifestDir(tempDir);
      const exists = await client.versionExists("file:my-local-package", "1.0.0");
      expect(exists).toBe(true);
    });

    it("should return false when no package.json", async () => {
      client.setManifestDir(tempDir);
      const exists = await client.versionExists("file:my-local-package", "1.0.0");
      expect(exists).toBe(false);
    });
  });

  describe("getVersions", () => {
    it("should return version from package.json", async () => {
      await fs.writeFile(
        path.join(packageDir, "package.json"),
        JSON.stringify({ name: "test", version: "3.2.1" })
      );

      client.setManifestDir(tempDir);
      const versions = await client.getVersions("file:my-local-package");
      expect(versions).toEqual(["3.2.1"]);
    });

    it("should return empty array when no package.json", async () => {
      client.setManifestDir(tempDir);
      const versions = await client.getVersions("file:my-local-package");
      expect(versions).toEqual([]);
    });
  });

  describe("listDirectories", () => {
    it("should list subdirectories", async () => {
      await fs.mkdir(path.join(tempDir, "subdir1"));
      await fs.mkdir(path.join(tempDir, "subdir2"));
      await fs.writeFile(path.join(tempDir, "file.txt"), "test");

      client.setManifestDir(tempDir);
      const dirs = await client.listDirectories(".");
      expect(dirs).toContain("subdir1");
      expect(dirs).toContain("subdir2");
      expect(dirs).toContain("my-local-package");
      expect(dirs).not.toContain("file.txt");
    });

    it("should exclude hidden directories", async () => {
      await fs.mkdir(path.join(tempDir, ".hidden"));

      client.setManifestDir(tempDir);
      const dirs = await client.listDirectories(".");
      expect(dirs).not.toContain(".hidden");
    });
  });

  describe("hasPackageJson", () => {
    it("should return true when package.json exists", async () => {
      await fs.writeFile(
        path.join(packageDir, "package.json"),
        JSON.stringify({ name: "test", version: "1.0.0" })
      );

      client.setManifestDir(tempDir);
      const has = await client.hasPackageJson("my-local-package");
      expect(has).toBe(true);
    });

    it("should return false when no package.json", async () => {
      client.setManifestDir(tempDir);
      const has = await client.hasPackageJson("my-local-package");
      expect(has).toBe(false);
    });
  });

  describe("searchPackages", () => {
    it("should return empty array (not applicable for local)", async () => {
      const results = await client.searchPackages("test");
      expect(results).toEqual([]);
    });
  });
});
