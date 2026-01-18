import { describe, it, expect } from "vitest";
import { compareVersions, sortVersionsDescending } from "./versionUtils";

describe("compareVersions", () => {
  describe("basic semver comparison", () => {
    it("returns 0 for equal versions", () => {
      expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
      expect(compareVersions("2.3.4", "2.3.4")).toBe(0);
    });

    it("compares major versions", () => {
      expect(compareVersions("2.0.0", "1.0.0")).toBeGreaterThan(0);
      expect(compareVersions("1.0.0", "2.0.0")).toBeLessThan(0);
    });

    it("compares minor versions", () => {
      expect(compareVersions("1.2.0", "1.1.0")).toBeGreaterThan(0);
      expect(compareVersions("1.1.0", "1.2.0")).toBeLessThan(0);
    });

    it("compares patch versions", () => {
      expect(compareVersions("1.0.2", "1.0.1")).toBeGreaterThan(0);
      expect(compareVersions("1.0.1", "1.0.2")).toBeLessThan(0);
    });
  });

  describe("versions with different part counts", () => {
    it("treats missing parts as 0", () => {
      expect(compareVersions("1.0", "1.0.0")).toBe(0);
      expect(compareVersions("1", "1.0.0")).toBe(0);
      expect(compareVersions("1.0.1", "1.0")).toBeGreaterThan(0);
    });
  });

  describe("pre-release versions", () => {
    it("compares pre-release to release (pre-release is lower)", () => {
      expect(compareVersions("1.0.0-alpha", "1.0.0")).toBeLessThan(0);
      expect(compareVersions("1.0.0", "1.0.0-alpha")).toBeGreaterThan(0);
    });

    it("compares pre-release tags alphabetically", () => {
      expect(compareVersions("1.0.0-beta", "1.0.0-alpha")).toBeGreaterThan(0);
      expect(compareVersions("1.0.0-alpha", "1.0.0-beta")).toBeLessThan(0);
    });

    it("compares numeric pre-release identifiers", () => {
      expect(compareVersions("1.0.0-1", "1.0.0-2")).toBeLessThan(0);
      expect(compareVersions("1.0.0-10", "1.0.0-2")).toBeGreaterThan(0);
    });
  });

  describe("Unity-style preview versions", () => {
    it("handles preview suffix", () => {
      expect(compareVersions("1.0.0-preview", "1.0.0")).toBeLessThan(0);
      expect(compareVersions("1.0.0-preview.1", "1.0.0-preview")).toBeGreaterThan(0);
    });

    it("handles exp suffix", () => {
      expect(compareVersions("1.0.0-exp.1", "1.0.0")).toBeLessThan(0);
    });
  });
});

describe("sortVersionsDescending", () => {
  it("sorts versions from newest to oldest", () => {
    const versions = ["1.0.0", "2.0.0", "1.5.0"];
    const sorted = sortVersionsDescending(versions);
    expect(sorted).toEqual(["2.0.0", "1.5.0", "1.0.0"]);
  });

  it("does not mutate original array", () => {
    const versions = ["1.0.0", "2.0.0"];
    const sorted = sortVersionsDescending(versions);
    expect(versions).toEqual(["1.0.0", "2.0.0"]);
    expect(sorted).not.toBe(versions);
  });

  it("handles pre-release versions correctly", () => {
    const versions = ["1.0.0-alpha", "1.0.0", "1.0.0-beta"];
    const sorted = sortVersionsDescending(versions);
    expect(sorted).toEqual(["1.0.0", "1.0.0-beta", "1.0.0-alpha"]);
  });

  it("handles empty array", () => {
    expect(sortVersionsDescending([])).toEqual([]);
  });

  it("handles single element array", () => {
    expect(sortVersionsDescending(["1.0.0"])).toEqual(["1.0.0"]);
  });

  it("handles Unity package versions", () => {
    const versions = [
      "1.0.0",
      "1.1.0-preview",
      "1.1.0-preview.2",
      "1.1.0",
      "1.0.1",
    ];
    const sorted = sortVersionsDescending(versions);
    expect(sorted).toEqual([
      "1.1.0",
      "1.1.0-preview.2",
      "1.1.0-preview",
      "1.0.1",
      "1.0.0",
    ]);
  });
});
