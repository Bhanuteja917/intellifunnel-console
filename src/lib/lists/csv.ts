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

  const parsed = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  });

  const headers = parsed.meta.fields ?? [];
  if (headers.length === 0) throw new ValidationError("File has no header row");

  // Check if PapaParse renamed any headers due to duplicates
  if (parsed.meta.renamedHeaders && Object.keys(parsed.meta.renamedHeaders).length > 0) {
    // Get the original duplicated header name from the values of renamedHeaders
    const duplicatedHeaders = Object.values(parsed.meta.renamedHeaders);
    throw new ValidationError(`Duplicate column header: ${duplicatedHeaders[0]}`);
  }

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
