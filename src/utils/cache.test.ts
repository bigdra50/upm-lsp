import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as Cache from "./cache";

describe("Immutable Cache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("empty", () => {
    it("should create empty cache", () => {
      const cache = Cache.empty<string>();
      expect(Cache.size(cache)).toBe(0);
    });
  });

  describe("set/get", () => {
    it("should store and retrieve values", () => {
      const cache1 = Cache.empty<number>();
      const cache2 = Cache.set(cache1, "key", 42, 1000);

      expect(Cache.get(cache2, "key")).toBe(42);
      // Original cache is unchanged (immutable)
      expect(Cache.get(cache1, "key")).toBeNull();
    });

    it("should return null for non-existent key", () => {
      const cache = Cache.empty<number>();
      expect(Cache.get(cache, "missing")).toBeNull();
    });

    it("should return null for expired entry", () => {
      const cache1 = Cache.empty<number>();
      const cache2 = Cache.set(cache1, "key", 42, 1000);

      expect(Cache.get(cache2, "key")).toBe(42);

      vi.advanceTimersByTime(1001);

      expect(Cache.get(cache2, "key")).toBeNull();
    });
  });

  describe("has", () => {
    it("should return true for existing non-expired key", () => {
      const cache = Cache.set(Cache.empty<number>(), "key", 42, 1000);
      expect(Cache.has(cache, "key")).toBe(true);
    });

    it("should return false for missing key", () => {
      const cache = Cache.empty<number>();
      expect(Cache.has(cache, "missing")).toBe(false);
    });

    it("should return false for expired key", () => {
      const cache = Cache.set(Cache.empty<number>(), "key", 42, 1000);

      vi.advanceTimersByTime(1001);

      expect(Cache.has(cache, "key")).toBe(false);
    });
  });

  describe("remove", () => {
    it("should remove entry and return new cache", () => {
      const cache1 = Cache.set(Cache.empty<number>(), "key", 42, 1000);
      const cache2 = Cache.remove(cache1, "key");

      expect(Cache.get(cache1, "key")).toBe(42); // Original unchanged
      expect(Cache.get(cache2, "key")).toBeNull();
    });

    it("should handle removing non-existent key", () => {
      const cache1 = Cache.empty<number>();
      const cache2 = Cache.remove(cache1, "missing");

      expect(Cache.size(cache2)).toBe(0);
    });
  });

  describe("prune", () => {
    it("should remove expired entries", () => {
      let cache = Cache.empty<number>();
      cache = Cache.set(cache, "a", 1, 1000);
      cache = Cache.set(cache, "b", 2, 2000);
      cache = Cache.set(cache, "c", 3, 3000);

      expect(Cache.size(cache)).toBe(3);

      vi.advanceTimersByTime(1500);

      const pruned = Cache.prune(cache);

      expect(Cache.size(pruned)).toBe(2);
      expect(Cache.get(pruned, "a")).toBeNull();
      expect(Cache.get(pruned, "b")).toBe(2);
      expect(Cache.get(pruned, "c")).toBe(3);
    });
  });

  describe("size/activeSize", () => {
    it("should return total size including expired", () => {
      let cache = Cache.empty<number>();
      cache = Cache.set(cache, "a", 1, 1000);
      cache = Cache.set(cache, "b", 2, 2000);

      vi.advanceTimersByTime(1500);

      // size includes expired entries
      expect(Cache.size(cache)).toBe(2);
      // activeSize excludes expired entries
      expect(Cache.activeSize(cache)).toBe(1);
    });
  });

  describe("mapValues", () => {
    it("should transform non-expired values", () => {
      let cache = Cache.empty<number>();
      cache = Cache.set(cache, "a", 1, 1000);
      cache = Cache.set(cache, "b", 2, 2000);

      vi.advanceTimersByTime(1500);

      const mapped = Cache.mapValues(cache, (v) => v * 10);

      // Only "b" is non-expired
      expect(Cache.size(mapped)).toBe(1);
      expect(Cache.get(mapped, "a")).toBeNull();
      expect(Cache.get(mapped, "b")).toBe(20);
    });
  });

  describe("getOrSet", () => {
    it("should return cached value without calling getter", () => {
      const cache = Cache.set(Cache.empty<number>(), "key", 42, 1000);
      const getter = vi.fn(() => 100);

      const result = Cache.getOrSet(cache, "key", getter, 1000);

      expect(result.value).toBe(42);
      expect(getter).not.toHaveBeenCalled();
      expect(result.cache).toBe(cache); // Same cache reference
    });

    it("should call getter and cache result for missing key", () => {
      const cache = Cache.empty<number>();
      const getter = vi.fn(() => 100);

      const result = Cache.getOrSet(cache, "key", getter, 1000);

      expect(result.value).toBe(100);
      expect(getter).toHaveBeenCalledOnce();
      expect(Cache.get(result.cache, "key")).toBe(100);
    });
  });

  describe("getOrSetAsync", () => {
    it("should return cached value without calling getter", async () => {
      const cache = Cache.set(Cache.empty<number>(), "key", 42, 1000);
      const getter = vi.fn(async () => 100);

      const result = await Cache.getOrSetAsync(cache, "key", getter, 1000);

      expect(result.value).toBe(42);
      expect(getter).not.toHaveBeenCalled();
    });

    it("should call async getter and cache result for missing key", async () => {
      const cache = Cache.empty<number>();
      const getter = vi.fn(async () => 100);

      const result = await Cache.getOrSetAsync(cache, "key", getter, 1000);

      expect(result.value).toBe(100);
      expect(getter).toHaveBeenCalledOnce();
      expect(Cache.get(result.cache, "key")).toBe(100);
    });
  });
});
