import Papa from "papaparse";
import * as XLSX from "xlsx";

export type ColumnType = "text" | "number" | "date" | "boolean" | "null";
export type RefuseReason = "extension" | "empty" | "headers_only" | "too_many_rows" | "too_many_columns";
export type Cell = string | number | boolean | null;

export type LoadedTable = {
  ok: true;
  columns: { name: string; type: ColumnType }[];
  rows: Record<string, Cell>[];
};

export type LoadResult = LoadedTable | { ok: false; refuseReason: RefuseReason };

const MAX_ROWS = 50_000;
const MAX_COLS = 100;
const NUMBER_RE = /^[\$€£¥]?-?(?:\d+\.?\d*|\.\d+)$/;
const DATE_RE = /^(\d{4}-\d{2}-\d{2})(?:T.*)?$/;
const BOOL_RE = /^(true|false)$/i;

function dedupeHeaders(raw: string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((header) => {
    const trimmed = header.trim();
    const base = trimmed === "" ? "column" : trimmed;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base}_${count}`;
  });
}

function isBlankRecord(cells: string[]): boolean {
  return cells.length === 0 || (cells.length === 1 && cells[0].trim() === "");
}

function cellValue(raw: string): Cell {
  if (raw.trim() === "") return null;
  return raw;
}

function calendarDate(value: string): string | null {
  const match = DATE_RE.exec(value);
  if (!match) return null;
  const [year, month, day] = match[1].split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return match[1];
}

function fromExcelDate(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function infer(values: Cell[]): ColumnType {
  const present = values.filter((value) => value !== null);
  if (present.length === 0) return "null";
  if (present.every((value) => typeof value === "number")) return "number";
  if (present.every((value) => typeof value === "boolean")) return "boolean";
  if (present.every((value) => typeof value === "string" && BOOL_RE.test(value))) return "boolean";
  if (present.every((value) => typeof value === "string" && NUMBER_RE.test(value))) return "number";
  if (present.every((value) => typeof value === "string" && calendarDate(value))) return "date";
  return "text";
}

function coerce(value: Cell, type: ColumnType): Cell {
  if (value === null || type === "text" || type === "null") return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (type === "boolean") return value.toLowerCase() === "true";
  if (type === "number") return Number(value.replace(/^[\$€£¥]/, ""));
  return calendarDate(value);
}

function finish(headers: string[], matrix: Cell[][]): LoadResult {
  if (headers.length === 0) return { ok: false, refuseReason: "empty" };
  if (headers.length > MAX_COLS) return { ok: false, refuseReason: "too_many_columns" };
  if (matrix.length === 0) return { ok: false, refuseReason: "headers_only" };
  if (matrix.length > MAX_ROWS) return { ok: false, refuseReason: "too_many_rows" };
  const names = dedupeHeaders(headers);
  const columns = names.map((name, index) => ({
    name,
    type: infer(matrix.map((row) => row[index] ?? null)),
  }));
  const rows = matrix.map((row) => {
    const record: Record<string, Cell> = {};
    columns.forEach((column, index) => {
      record[column.name] = coerce(row[index] ?? null, column.type);
    });
    return record;
  });
  return { ok: true, columns, rows };
}

function loadCsv(text: string): LoadResult {
  if (text.trim() === "") return { ok: false, refuseReason: "empty" };
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const parsed = Papa.parse<string[]>(normalized, { header: false, skipEmptyLines: false });
  const records = parsed.data.filter((row) => !isBlankRecord(row.map((cell) => cell ?? "")));
  if (records.length === 0) return { ok: false, refuseReason: "empty" };
  const [header, ...body] = records;
  const width = header.length;
  const matrix = body.map((row) => header.map((_, index) => cellValue(index < row.length ? String(row[index] ?? "") : "")));
  return finish(header.slice(0, width), matrix);
}

function loadXlsx(bytes: Uint8Array): LoadResult {
  const book = XLSX.read(bytes, { type: "array", cellDates: true });
  const sheet = book.Sheets[book.SheetNames[0]];
  if (!sheet) return { ok: false, refuseReason: "empty" };
  const grid = XLSX.utils.sheet_to_json<(string | number | boolean | Date | null)[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  });
  const records = grid.filter((row) => row.some((cell) => cell !== null && String(cell).trim() !== ""));
  if (records.length === 0) return { ok: false, refuseReason: "empty" };
  const [headerRow, ...body] = records;
  const headers = headerRow.map((cell) => (cell === null ? "" : String(cell)));
  const matrix = body.map((row) =>
    headers.map((_, index) => {
      const cell = row[index] ?? null;
      if (cell === null || (typeof cell === "string" && cell.trim() === "")) return null;
      if (cell instanceof Date) return fromExcelDate(cell);
      if (typeof cell === "number" || typeof cell === "boolean") return cell;
      return String(cell);
    }),
  );
  return finish(headers, matrix);
}

export function loadFile(fileName: string, bytes: Uint8Array): LoadResult {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv")) {
    if (bytes.byteLength === 0) return { ok: false, refuseReason: "empty" };
    return loadCsv(new TextDecoder("utf-8").decode(bytes));
  }
  if (lower.endsWith(".xlsx")) {
    if (bytes.byteLength === 0) return { ok: false, refuseReason: "empty" };
    return loadXlsx(bytes);
  }
  return { ok: false, refuseReason: "extension" };
}
