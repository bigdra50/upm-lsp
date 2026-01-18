import { describe, it, expect } from "vitest";
import {
  ResolveContext,
  parseReference,
  resolveToAbsolutePath,
  buildPackageInfo,
  emptyInfo,
  createInfo,
  getCacheKey,
  filterDirectories,
  isFileReference,
} from "./localPackage";

describe("localPackage pure functions", () => {
  describe("parseReference", () => {
    it("should parse valid file: reference", () => {
      const result = parseReference("file:../my-package");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.path).toBe("../my-package");
        expect(result.value.isGitProtocol).toBe(false);
      }
    });

    it("should return error for non-file reference", () => {
      const result = parseReference("1.0.0");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe("parse_error");
      }
    });

    it("should return error for git protocol", () => {
      const result = parseReference("file://localhost/repo.git");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe("git_protocol");
      }
    });
  });

  describe("resolveToAbsolutePath", () => {
    const ctx: ResolveContext = { manifestDir: "/project/Packages" };

    it("should resolve relative path", () => {
      const result = resolveToAbsolutePath(ctx)("file:../my-package");
      expect(result.ok).toBe(true);
    });

    it("should return error for invalid reference", () => {
      const result = resolveToAbsolutePath(ctx)("1.0.0");
      expect(result.ok).toBe(false);
    });

    it("should return error for git protocol", () => {
      const result = resolveToAbsolutePath(ctx)("file://localhost/repo.git");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe("git_protocol");
      }
    });
  });

  describe("buildPackageInfo", () => {
    it("should build PackageInfo from valid JSON", () => {
      const json = {
        name: "com.example.package",
        version: "1.0.0",
        displayName: "Example Package",
        description: "A test package",
      };

      const result = buildPackageInfo(json);
      expect(result).not.toBeNull();
      expect(result?.name).toBe("com.example.package");
      expect(result?.version).toBe("1.0.0");
      expect(result?.displayName).toBe("Example Package");
    });

    it("should return null for invalid JSON", () => {
      expect(buildPackageInfo(null)).toBeNull();
      expect(buildPackageInfo(undefined)).toBeNull();
      expect(buildPackageInfo("string")).toBeNull();
      expect(buildPackageInfo({})).toBeNull();
      expect(buildPackageInfo({ name: "test" })).toBeNull(); // missing version
    });

    it("should handle optional fields gracefully", () => {
      const json = {
        name: "minimal",
        version: "1.0.0",
      };

      const result = buildPackageInfo(json);
      expect(result).not.toBeNull();
      expect(result?.displayName).toBeUndefined();
      expect(result?.description).toBeUndefined();
    });
  });

  describe("emptyInfo", () => {
    it("should create empty LocalPackageInfo", () => {
      const info = emptyInfo("file:../path");
      expect(info.reference).toBe("file:../path");
      expect(info.absolutePath).toBe("");
      expect(info.exists).toBe(false);
      expect(info.packageInfo).toBeNull();
    });
  });

  describe("createInfo", () => {
    it("should create LocalPackageInfo with all fields", () => {
      const packageInfo = { name: "test", version: "1.0.0" };
      const info = createInfo("file:../path", "/abs/path", true, packageInfo);

      expect(info.reference).toBe("file:../path");
      expect(info.absolutePath).toBe("/abs/path");
      expect(info.exists).toBe(true);
      expect(info.packageInfo).toBe(packageInfo);
    });
  });

  describe("getCacheKey", () => {
    it("should combine manifestDir and reference", () => {
      const key = getCacheKey("/project/Packages", "file:../my-pkg");
      expect(key).toBe("/project/Packages:file:../my-pkg");
    });
  });

  describe("filterDirectories", () => {
    it("should filter directories and exclude hidden", () => {
      const entries = [
        { name: "dir1", isDirectory: true },
        { name: "file.txt", isDirectory: false },
        { name: ".hidden", isDirectory: true },
        { name: "dir2", isDirectory: true },
      ];

      const result = filterDirectories(entries);
      expect(result).toEqual(["dir1", "dir2"]);
    });

    it("should return empty array for empty input", () => {
      expect(filterDirectories([])).toEqual([]);
    });
  });

  describe("isFileReference (re-export)", () => {
    it("should correctly identify file references", () => {
      expect(isFileReference("file:../path")).toBe(true);
      expect(isFileReference("1.0.0")).toBe(false);
    });
  });
});
