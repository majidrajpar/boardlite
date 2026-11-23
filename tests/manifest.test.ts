import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadFile, type ColumnType } from "../src/load";

const root = resolve(import.meta.dirname, "../testdata");
const manifest = JSON.parse(readFileSync(resolve(root, "MANIFEST.json"), "utf8")) as {
  files: {
    path: string;
    expect: "load" | "refuse";
    refuseReason: string | null;
    columns: { expectType: string; expectNameAfterDedupe: string }[];
  }[];
};

function typeName(type: ColumnType): string {
  return type === "null" ? "null-column" : type;
}

describe("testdata manifest", () => {
  for (const file of manifest.files) {
    it(file.path, () => {
      const bytes = new Uint8Array(readFileSync(resolve(root, file.path)));
      const result = loadFile(file.path, bytes);
      if (file.expect === "refuse") {
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.refuseReason).toBe(file.refuseReason);
        return;
      }
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.columns.map((column) => column.name)).toEqual(file.columns.map((column) => column.expectNameAfterDedupe));
      expect(result.columns.map((column) => typeName(column.type))).toEqual(file.columns.map((column) => column.expectType));
      if (file.path === "boundary/rows_50000.csv") expect(result.rows).toHaveLength(50_000);
      if (file.path === "dirty/sales_messy.csv") expect(result.rows).toHaveLength(220);
      if (file.path === "xlsx/sales_dates.xlsx") {
        const values = result.rows.flatMap((row) => Object.values(row).map(String));
        expect(values).not.toContain("SHOULD_NOT_BE_READ");
        expect(result.rows[9].revenue).toBeNull();
      }
    });
  }
});
