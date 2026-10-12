/** Marmalade class IDs: djb2 over the lowercased class name, as uint32. */
export function classHash(name: string): number {
  let h = 5381;
  for (const ch of name.toLowerCase()) h = (Math.imul(h, 33) + ch.charCodeAt(0)) >>> 0;
  return h;
}

/** Top-level record types found in every .group.bin. */
export const KNOWN_RECORDS = {
  members: 0x8081e087, // ResGroupMembers
  childPaths: 0x3b495dc0, // ResGroupChildPaths
  resources: 0xdc3c2177, // ResGroupResources
} as const;

/**
 * Maps class hashes back to names by hashing every printable ASCII run
 * (length >= 3) in the game binary. On collision the first string wins.
 */
export function buildClassNameDictionary(binary: Buffer): Map<number, string> {
  const dict = new Map<number, string>();
  let start = -1;
  for (let i = 0; i <= binary.length; i++) {
    const c = i < binary.length ? binary[i] : 0;
    const printable = c >= 0x20 && c <= 0x7e;
    if (printable && start < 0) start = i;
    if (!printable && start >= 0) {
      if (i - start >= 3) {
        const s = binary.toString("latin1", start, i);
        const h = classHash(s);
        if (!dict.has(h)) dict.set(h, s);
      }
      start = -1;
    }
  }
  return dict;
}

export function describeClass(hash: number, dict: Map<number, string>): string {
  return dict.get(hash) ?? `0x${hash.toString(16).padStart(8, "0")}`;
}
