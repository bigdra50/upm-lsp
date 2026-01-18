/**
 * Version comparison utilities
 */

type VersionPart = string | number;

/**
 * Compare semver versions
 * Returns negative if a < b, positive if a > b, 0 if equal
 *
 * Supports pre-release tags (e.g., 1.0.0-alpha < 1.0.0)
 */
export function compareVersions(a: string, b: string): number {
  const partsA = parseVersionParts(a);
  const partsB = parseVersionParts(b);

  const maxLen = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < maxLen; i++) {
    const partA = partsA[i] ?? 0;
    const partB = partsB[i] ?? 0;

    // Numeric comparison
    if (typeof partA === "number" && typeof partB === "number") {
      if (partA !== partB) {
        return partA - partB;
      }
      continue;
    }

    // String comparison (pre-release tags)
    const strA = String(partA);
    const strB = String(partB);
    if (strA !== strB) {
      // Pre-release versions are less than release versions
      if (typeof partA === "string" && typeof partB === "number") return -1;
      if (typeof partA === "number" && typeof partB === "string") return 1;
      return strA.localeCompare(strB);
    }
  }

  return 0;
}

/**
 * Parse version string into comparable parts
 */
function parseVersionParts(version: string): VersionPart[] {
  return version
    .split(/[.-]/)
    .map((p) => (isNaN(Number(p)) ? p : Number(p)));
}

/**
 * Sort versions in descending order (newest first)
 */
export function sortVersionsDescending(versions: string[]): string[] {
  return [...versions].sort((a, b) => compareVersions(b, a));
}
