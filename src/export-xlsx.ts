import * as XLSX from "xlsx";

export type ExportSheet = {
  name: string;
  rows: Record<string, string | number | null>[];
};

function sheetName(name: string, used: Set<string>): string {
  const cleaned = name.replace(/[\\/*?:[\]]/g, " ").trim().slice(0, 31) || "Sheet";
  let unique = cleaned;
  let count = 2;
  while (used.has(unique)) {
    const suffix = ` ${count}`;
    unique = `${cleaned.slice(0, 31 - suffix.length)}${suffix}`;
    count += 1;
  }
  used.add(unique);
  return unique;
}

export function workbookBytes(sheets: ExportSheet[]): Uint8Array {
  const book = XLSX.utils.book_new();
  const used = new Set<string>();
  const source = sheets.length > 0 ? sheets : [{ name: "BoardLite", rows: [{ note: "Add a tile before exporting." }] }];
  for (const sheet of source) {
    const rows = sheet.rows.length > 0 ? sheet.rows : [{ note: "No rows" }];
    const worksheet = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(book, worksheet, sheetName(sheet.name, used));
  }
  return new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}
