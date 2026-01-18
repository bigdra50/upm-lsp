import { describe, it, expect } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { LineIndex, getJsonContext, isGitHubUrl, extractGitHubUrl } from "./jsonHelper";

describe("LineIndex", () => {
  describe("positionAt", () => {
    it("returns position for single line text", () => {
      const lineIndex = new LineIndex("hello world");
      expect(lineIndex.positionAt(0)).toEqual({ line: 0, character: 0 });
      expect(lineIndex.positionAt(5)).toEqual({ line: 0, character: 5 });
      expect(lineIndex.positionAt(11)).toEqual({ line: 0, character: 11 });
    });

    it("returns position for multi-line text", () => {
      const text = "line1\nline2\nline3";
      const lineIndex = new LineIndex(text);

      // line1: offsets 0-5 (5 chars + newline at 5)
      expect(lineIndex.positionAt(0)).toEqual({ line: 0, character: 0 });
      expect(lineIndex.positionAt(5)).toEqual({ line: 0, character: 5 });

      // line2: offsets 6-11 (starts at 6)
      expect(lineIndex.positionAt(6)).toEqual({ line: 1, character: 0 });
      expect(lineIndex.positionAt(8)).toEqual({ line: 1, character: 2 });

      // line3: offsets 12-16 (starts at 12)
      expect(lineIndex.positionAt(12)).toEqual({ line: 2, character: 0 });
      expect(lineIndex.positionAt(16)).toEqual({ line: 2, character: 4 });
    });

    it("handles empty lines", () => {
      const text = "a\n\nb";
      const lineIndex = new LineIndex(text);

      expect(lineIndex.positionAt(0)).toEqual({ line: 0, character: 0 }); // 'a'
      expect(lineIndex.positionAt(2)).toEqual({ line: 1, character: 0 }); // empty line
      expect(lineIndex.positionAt(3)).toEqual({ line: 2, character: 0 }); // 'b'
    });

    it("handles CRLF line endings", () => {
      // LineIndex only counts \n, so \r is treated as regular character
      const text = "a\r\nb";
      const lineIndex = new LineIndex(text);

      expect(lineIndex.positionAt(0)).toEqual({ line: 0, character: 0 }); // 'a'
      expect(lineIndex.positionAt(1)).toEqual({ line: 0, character: 1 }); // '\r'
      expect(lineIndex.positionAt(3)).toEqual({ line: 1, character: 0 }); // 'b'
    });
  });
});

describe("getJsonContext", () => {
  function createDocument(content: string): TextDocument {
    return TextDocument.create("file:///test.json", "json", 1, content);
  }

  it("returns topLevel for empty object", () => {
    const doc = createDocument('{\n  \n}');
    const context = getJsonContext(doc, { line: 1, character: 2 });
    expect(context.type).toBe("topLevel");
  });

  it("returns dependenciesKey inside dependencies object", () => {
    const doc = createDocument('{\n  "dependencies": {\n    ""\n  }\n}');
    const context = getJsonContext(doc, { line: 2, character: 5 });
    expect(context.type).toBe("dependenciesKey");
  });

  it("returns dependenciesValue for version position", () => {
    // Line 2: '    "com.unity.test": ""'
    // Position 22 is after colon+space+quote (the cursor inside version string)
    const doc = createDocument('{\n  "dependencies": {\n    "com.unity.test": ""\n  }\n}');
    const context = getJsonContext(doc, { line: 2, character: 23 });
    expect(context.type).toBe("dependenciesValue");
    if (context.type === "dependenciesValue") {
      expect(context.packageName).toBe("com.unity.test");
    }
  });

  it("returns unknown outside known sections", () => {
    const doc = createDocument('{\n  "unknown": {\n    "key": "value"\n  }\n}');
    const context = getJsonContext(doc, { line: 2, character: 10 });
    expect(context.type).toBe("unknown");
  });

  it("returns scopedRegistriesObject inside scopedRegistries array object", () => {
    const doc = createDocument('{\n  "scopedRegistries": [\n    {\n      ""\n    }\n  ]\n}');
    const context = getJsonContext(doc, { line: 3, character: 6 });
    expect(context.type).toBe("scopedRegistriesObject");
  });
});

describe("isGitHubUrl", () => {
  it("returns true for HTTPS GitHub URLs", () => {
    expect(isGitHubUrl("https://github.com/owner/repo")).toBe(true);
    expect(isGitHubUrl("https://github.com/owner/repo.git")).toBe(true);
    expect(isGitHubUrl("https://github.com/owner/my-repo")).toBe(true);
  });

  it("returns true for git+ prefixed URLs", () => {
    expect(isGitHubUrl("git+https://github.com/owner/repo.git")).toBe(true);
  });

  it("returns true for SSH-style URLs", () => {
    expect(isGitHubUrl("git@github.com:owner/repo.git")).toBe(true);
  });

  it("returns false for non-GitHub URLs", () => {
    expect(isGitHubUrl("https://gitlab.com/owner/repo")).toBe(false);
    expect(isGitHubUrl("https://example.com")).toBe(false);
    expect(isGitHubUrl("1.0.0")).toBe(false);
  });
});

describe("extractGitHubUrl", () => {
  it("extracts URL from git+ prefixed URL", () => {
    expect(extractGitHubUrl("git+https://github.com/owner/repo.git")).toBe(
      "https://github.com/owner/repo"
    );
  });

  it("removes .git suffix", () => {
    expect(extractGitHubUrl("https://github.com/owner/repo.git")).toBe(
      "https://github.com/owner/repo"
    );
  });

  it("removes fragment identifier", () => {
    expect(extractGitHubUrl("https://github.com/owner/repo#v1.0.0")).toBe(
      "https://github.com/owner/repo"
    );
  });

  it("converts SSH URL to HTTPS", () => {
    expect(extractGitHubUrl("git@github.com:owner/repo.git")).toBe(
      "https://github.com/owner/repo"
    );
  });

  it("returns null for non-GitHub URLs", () => {
    expect(extractGitHubUrl("https://gitlab.com/owner/repo")).toBe(null);
    expect(extractGitHubUrl("not-a-url")).toBe(null);
  });
});
