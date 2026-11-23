import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { workbookBytes } from "../src/export-xlsx";

describe("workbookBytes", () => {
  it("writes one sheet per tile with the result rows", () => {
    const bytes = workbookBytes([
      { name: "Revenue by region", rows: [{ region: "North", revenue: 11 }, { region: "South", revenue: 4 }] },
      { name: "Revenue by region", rows: [] },
    ]);
    const book = XLSX.read(bytes, { type: "array" });
    expect(book.SheetNames).toEqual(["Revenue by region", "Revenue by region 2"]);
    const rows = XLSX.utils.sheet_to_json(book.Sheets["Revenue by region"]);
    expect(rows).toEqual([{ region: "North", revenue: 11 }, { region: "South", revenue: 4 }]);
    expect(XLSX.utils.sheet_to_json(book.Sheets["Revenue by region 2"])).toEqual([{ note: "No rows" }]);
  });
});
