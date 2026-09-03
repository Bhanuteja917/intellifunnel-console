import Papa from "papaparse";
import { ValidationError } from "@/lib/errors";

export type ParsedFile = {
  headers: string[];
  rows: Record<string, string>[];
};

export type RowError = {
  rowNumber: number;
  field: string | null;
  rawValue: string | null;
  message: string;
};

export function parseDelimited(content: string): ParsedFile {
  if (content.trim() === "") throw new ValidationError("File is empty");

  // Extract the header line first to check for duplicates before PapaParse renames them
  const lines = content.split('\n');
  const headerLine = lines[0];
  if (!headerLine) throw new ValidationError("File has no header row");

  // Parse just the header line to get the original headers
  const headerParsed = Papa.parse(headerLine);
  const originalHeaders = (headerParsed.data[0] as string[]) || [];
  if (originalHeaders.length === 0) throw new ValidationError("File has no header row");

  // Trim and check for duplicates in the original headers
  const trimmedOriginalHeaders = originalHeaders.map(h => h.trim());
  const seen = new Set<string>();
  for (const header of trimmedOriginalHeaders) {
    if (seen.has(header)) throw new ValidationError(`Duplicate column header: ${header}`);
    seen.add(header);
  }

  // Now parse the full file
  const parsed = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim(),
  });

  const headers = parsed.meta.fields ?? [];
  if (headers.length === 0) throw new ValidationError("File has no header row");

  return { headers, rows: parsed.data };
}

/** Maps source column headers to the canonical keys the importer expects. */
export function applyMapping(
  row: Record<string, string>,
  mapping: Record<string, string>,
): Record<string, string> {
  const mapped: Record<string, string> = {};
  for (const [sourceColumn, canonicalKey] of Object.entries(mapping)) {
    const value = row[sourceColumn];
    if (value !== undefined) mapped[canonicalKey] = value;
  }
  return mapped;
}
