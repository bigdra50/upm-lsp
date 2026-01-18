import { describe, it, expect } from "vitest";
import {
  ok,
  err,
  isOk,
  isErr,
  map,
  flatMap,
  mapError,
  getOrElse,
  getOrElseWith,
  fromNullable,
  tryCatch,
  tryCatchAsync,
  all,
  match,
} from "./result";

describe("Result", () => {
  describe("ok/err constructors", () => {
    it("should create Ok result", () => {
      const result = ok(42);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(42);
      }
    });

    it("should create Err result", () => {
      const result = err("error");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("error");
      }
    });
  });

  describe("isOk/isErr", () => {
    it("should correctly identify Ok", () => {
      const result = ok(42);
      expect(isOk(result)).toBe(true);
      expect(isErr(result)).toBe(false);
    });

    it("should correctly identify Err", () => {
      const result = err("error");
      expect(isOk(result)).toBe(false);
      expect(isErr(result)).toBe(true);
    });
  });

  describe("map", () => {
    it("should transform Ok value", () => {
      const result = map(ok(2), (x) => x * 3);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(6);
      }
    });

    it("should pass through Err", () => {
      const result = map(err("error"), (x: number) => x * 3);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("error");
      }
    });
  });

  describe("flatMap", () => {
    it("should chain Ok results", () => {
      const result = flatMap(ok(2), (x) => ok(x * 3));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(6);
      }
    });

    it("should short-circuit on Err", () => {
      const result = flatMap(err("first"), (_: number) => err("second"));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("first");
      }
    });

    it("should propagate Err from function", () => {
      const result = flatMap(ok(2), (_) => err("computed error"));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("computed error");
      }
    });
  });

  describe("mapError", () => {
    it("should transform Err value", () => {
      const result = mapError(err("error"), (e) => `wrapped: ${e}`);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("wrapped: error");
      }
    });

    it("should pass through Ok", () => {
      const result = mapError(ok(42), (e: string) => `wrapped: ${e}`);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(42);
      }
    });
  });

  describe("getOrElse", () => {
    it("should return value for Ok", () => {
      expect(getOrElse(ok(42), 0)).toBe(42);
    });

    it("should return default for Err", () => {
      expect(getOrElse(err("error"), 0)).toBe(0);
    });
  });

  describe("getOrElseWith", () => {
    it("should return value for Ok", () => {
      expect(getOrElseWith(ok(42), () => 0)).toBe(42);
    });

    it("should compute default from error for Err", () => {
      expect(getOrElseWith(err("error"), (e) => e.length)).toBe(5);
    });
  });

  describe("fromNullable", () => {
    it("should return Ok for non-null value", () => {
      const result = fromNullable(42, "null error");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(42);
      }
    });

    it("should return Err for null", () => {
      const result = fromNullable(null, "null error");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("null error");
      }
    });

    it("should return Err for undefined", () => {
      const result = fromNullable(undefined, "undefined error");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("undefined error");
      }
    });
  });

  describe("tryCatch", () => {
    it("should return Ok for successful function", () => {
      const result = tryCatch(
        () => 42,
        () => "error"
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(42);
      }
    });

    it("should return Err for throwing function", () => {
      const result = tryCatch(
        () => {
          throw new Error("boom");
        },
        (e) => (e as Error).message
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("boom");
      }
    });
  });

  describe("tryCatchAsync", () => {
    it("should return Ok for successful async function", async () => {
      const result = await tryCatchAsync(
        async () => 42,
        () => "error"
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(42);
      }
    });

    it("should return Err for rejecting async function", async () => {
      const result = await tryCatchAsync(
        async () => {
          throw new Error("async boom");
        },
        (e) => (e as Error).message
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("async boom");
      }
    });
  });

  describe("all", () => {
    it("should combine all Ok results", () => {
      const results = [ok(1), ok(2), ok(3)];
      const combined = all(results);
      expect(combined.ok).toBe(true);
      if (combined.ok) {
        expect(combined.value).toEqual([1, 2, 3]);
      }
    });

    it("should return first Err", () => {
      const results = [ok(1), err("second error"), ok(3)];
      const combined = all(results);
      expect(combined.ok).toBe(false);
      if (!combined.ok) {
        expect(combined.error).toBe("second error");
      }
    });

    it("should handle empty array", () => {
      const combined = all([]);
      expect(combined.ok).toBe(true);
      if (combined.ok) {
        expect(combined.value).toEqual([]);
      }
    });
  });

  describe("match", () => {
    it("should call onOk for Ok result", () => {
      const result = match(
        ok(42),
        (v) => `value: ${v}`,
        (e) => `error: ${e}`
      );
      expect(result).toBe("value: 42");
    });

    it("should call onErr for Err result", () => {
      const result = match(
        err("boom"),
        (v: number) => `value: ${v}`,
        (e) => `error: ${e}`
      );
      expect(result).toBe("error: boom");
    });
  });
});
