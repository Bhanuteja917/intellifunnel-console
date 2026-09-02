const LEGAL_SUFFIXES = [
  "inc", "incorporated", "llc", "ltd", "limited", "plc", "gmbh", "ag", "sa",
  "srl", "bv", "nv", "oy", "ab", "as", "pty", "pvt", "private", "corp",
  "co", "company", "llp", "lp",
];

export function normalizeCompanyName(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/[.,'"()]/g, " ")
    .replace(/&/g, " and ")
    .replace(/\s+/g, " ")
    .trim();

  const words = base.split(" ");
  while (words.length > 1) {
    const last = words[words.length - 1];
    if (last !== undefined && LEGAL_SUFFIXES.includes(last)) {
      words.pop();
      continue;
    }
    break;
  }
  return words.join(" ");
}
