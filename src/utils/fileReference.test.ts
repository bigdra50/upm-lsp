import { describe, it, expect } from "vitest";
import * as path from "path";
import {
  FILE_PROTOCOL_PREFIX,
  FILE_GIT_PROTOCOL_PREFIX,
  isFileReference,
  isGitFileReference,
  parseFileReference,
  resolveFileReference,
  getDisplayPath,
  checkFileReferenceWarnings,
  validateFileReferenceFormat,
  checkProjectBoundary,
} from "./fileReference";

describe("fileReference constants", () => {
  it("should have correct protocol prefixes", () => {
    expect(FILE_PROTOCOL_PREFIX).toBe("file:");
    expect(FILE_GIT_PROTOCOL_PREFIX).toBe("file://");
  });
});

describe("isFileReference", () => {
  it("should return true for file: references", () => {
    expect(isFileReference("file:../path")).toBe(true);
    expect(isFileReference("file:./path")).toBe(true);
    expect(isFileReference("file:/absolute/path")).toBe(true);
    expect(isFileReference("file:C:/Windows/path")).toBe(true);
  });

  it("should return false for non-file references", () => {
    expect(isFileReference("1.0.0")).toBe(false);
    expect(isFileReference("https://github.com/owner/repo.git")).toBe(false);
    expect(isFileReference("git+https://github.com/owner/repo.git")).toBe(false);
    expect(isFileReference("")).toBe(false);
  });
});

describe("isGitFileReference", () => {
  it("should return true for file:// Git references", () => {
    expect(isGitFileReference("file://localhost/path/repo.git")).toBe(true);
    expect(isGitFileReference("file:///path/repo.git")).toBe(true);
  });

  it("should return false for regular file: references", () => {
    expect(isGitFileReference("file:../path")).toBe(false);
    expect(isGitFileReference("file:/path")).toBe(false);
  });
});

describe("parseFileReference", () => {
  it("should parse relative paths", () => {
    const result = parseFileReference("file:../my-package");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.path).toBe("../my-package");
      expect(result.value.isAbsolute).toBe(false);
      expect(result.value.isTarball).toBe(false);
      expect(result.value.isGitProtocol).toBe(false);
    }
  });

  it("should parse absolute paths", () => {
    const result = parseFileReference("file:/absolute/path");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.path).toBe("/absolute/path");
      expect(result.value.isAbsolute).toBe(true);
    }
  });

  it("should detect tarballs", () => {
    const result = parseFileReference("file:../package.tgz");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.isTarball).toBe(true);
    }
  });

  it("should detect Git-style file:// references", () => {
    const result = parseFileReference("file://localhost/path/repo.git");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.isGitProtocol).toBe(true);
    }
  });

  it("should return error for non-file references", () => {
    expect(parseFileReference("1.0.0").ok).toBe(false);
    expect(parseFileReference("https://github.com").ok).toBe(false);
  });
});

describe("resolveFileReference", () => {
  const manifestDir = "/project/Packages";

  it("should resolve relative paths from manifest directory", () => {
    expect(resolveFileReference("file:../my-package", manifestDir)).toBe(
      path.resolve("/project/my-package")
    );
    expect(resolveFileReference("file:./local-pkg", manifestDir)).toBe(
      path.resolve("/project/Packages/local-pkg")
    );
  });

  it("should return normalized absolute paths", () => {
    expect(resolveFileReference("file:/absolute/path", manifestDir)).toBe(
      path.normalize("/absolute/path")
    );
  });

  it("should return null for non-file references", () => {
    expect(resolveFileReference("1.0.0", manifestDir)).toBeNull();
  });

  it("should return null for Git-style file:// references", () => {
    expect(resolveFileReference("file://localhost/repo.git", manifestDir)).toBeNull();
  });
});

describe("getDisplayPath", () => {
  it("should return relative path when within manifest directory", () => {
    const manifestDir = "/project/Packages";
    const absolutePath = "/project/LocalPackages/my-pkg";
    const result = getDisplayPath(absolutePath, manifestDir);
    expect(result).toBe("../LocalPackages/my-pkg");
  });

  it("should use relative path when upCount is within limit", () => {
    // upCount = 2, which is <= 3, so relative path is used
    const manifestDir = "/project/Packages";
    const absolutePath = "/home/user/other-project/package";
    const result = getDisplayPath(absolutePath, manifestDir);
    // Relative path is preferred when upCount <= 3
    expect(result).toBe("../../home/user/other-project/package");
  });

  it("should mask home directory when upCount exceeds limit", () => {
    const originalHome = process.env.HOME;
    process.env.HOME = "/home/user";

    // Use a deeply nested manifest dir so upCount > 3
    const manifestDir = "/a/b/c/d/e/Packages";
    const absolutePath = "/home/user/package";
    const result = getDisplayPath(absolutePath, manifestDir);
    expect(result).toBe("~/package");

    process.env.HOME = originalHome;
  });

  it("should return absolute path when home masking not applicable", () => {
    const originalHome = process.env.HOME;
    process.env.HOME = "/home/user";

    // Use a deeply nested manifest dir so upCount > 3
    const manifestDir = "/a/b/c/d/e/Packages";
    const absolutePath = "/var/packages/external";
    const result = getDisplayPath(absolutePath, manifestDir);
    expect(result).toBe("/var/packages/external");

    process.env.HOME = originalHome;
  });
});

describe("checkFileReferenceWarnings", () => {
  it("should warn about backslashes", () => {
    const warnings = checkFileReferenceWarnings("file:..\\Windows\\path");
    expect(warnings).toContain("Use forward slashes (/) for better cross-platform portability");
  });

  it("should warn about spaces in path", () => {
    const warnings = checkFileReferenceWarnings("file:../my package/path");
    expect(warnings).toContain("Path contains spaces - ensure proper handling in build systems");
  });

  it("should return empty array for valid paths", () => {
    const warnings = checkFileReferenceWarnings("file:../valid-path/package");
    expect(warnings).toHaveLength(0);
  });
});

describe("validateFileReferenceFormat", () => {
  it("should accept valid file references", () => {
    expect(validateFileReferenceFormat("file:../path").valid).toBe(true);
    expect(validateFileReferenceFormat("file:./path").valid).toBe(true);
    expect(validateFileReferenceFormat("file:/absolute").valid).toBe(true);
  });

  it("should reject non-file references", () => {
    const result = validateFileReferenceFormat("1.0.0");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Not a file: reference");
  });

  it("should reject empty paths", () => {
    const result = validateFileReferenceFormat("file:");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Empty path in file: reference");
  });

  it("should reject paths with control characters", () => {
    const result = validateFileReferenceFormat("file:../path\x00malicious");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Path contains invalid control characters");
  });

  it("should accept Git-style file:// references", () => {
    const result = validateFileReferenceFormat("file://localhost/repo.git");
    expect(result.valid).toBe(true);
  });
});

describe("checkProjectBoundary", () => {
  const manifestDir = "/project/Packages";
  const projectRoot = "/project";

  it("should return isWithinProject=true for paths within project", () => {
    const result = checkProjectBoundary("/project/Assets/package", manifestDir);
    expect(result.isWithinProject).toBe(true);
    expect(result.message).toBeNull();
  });

  it("should return isWithinProject=false for paths outside project", () => {
    const result = checkProjectBoundary("/other-project/package", manifestDir);
    expect(result.isWithinProject).toBe(false);
    expect(result.message).toBe("Path references location outside project directory");
  });

  it("should handle sibling directories correctly", () => {
    // ../LocalPackages would be /project/../LocalPackages = /LocalPackages
    const result = checkProjectBoundary("/LocalPackages/my-pkg", manifestDir);
    expect(result.isWithinProject).toBe(false);
  });
});
