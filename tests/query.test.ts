import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadFile, type LoadedTable } from "../src/load";
import { pageFiltersFor, runQuery, type Filter } from "../src/query";

function table(): LoadedTable {
  return {
    ok: true,
    columns: [
      { name: "region", type: "text" },
      { name: "revenue", type: "number" },
      { name: "date", type: "date" },
    ],
    rows: [
      { region: "North", revenue: 10, date: "2024-01-01" },
      { region: "North", revenue: null, date: "2024-01-02" },
      { region: "South", revenue: 5, date: "2024-02-01" },
    ],
  };
}

describe("runQuery", () => {
  it("sums by region and skips nulls", () => {
    const result = runQuery(table(), [], { groupBy: ["region"], measure: { column: "revenue", agg: "sum" }, filters: [] });
    expect(result.error).toBeNull();
    expect(result.rows).toEqual([
      { region: "North", "sum(revenue)": 10 },
      { region: "South", "sum(revenue)": 5 },
    ]);
  });

  it("returns one row when there is no group", () => {
    const result = runQuery(table(), [], { groupBy: [], measure: { column: "revenue", agg: "avg" }, filters: [] });
    expect(result.rows).toEqual([{ "avg(revenue)": 7.5 }]);
  });

  it("applies a page filter and a tile filter together", () => {
    const page: Filter = { column: "region", op: "eq", value: "North" };
    const tile: Filter = { column: "date", op: "eq", value: "2024-01-02" };
    const both = runQuery(table(), [page], { groupBy: [], measure: { column: "revenue", agg: "count" }, filters: [tile] });
    const pageOnly = runQuery(table(), [page], { groupBy: [], measure: { column: "revenue", agg: "count" }, filters: [] });
    expect(both.rows).toEqual([{ count: 1 }]);
    expect(pageOnly.rows).toEqual([{ count: 2 }]);
  });

  it("skips a page filter that belongs to another table", () => {
    const data = table();
    data.columns = data.columns.map((column) => ({ ...column, name: `sales.${column.name}` }));
    data.rows = data.rows.map((row) => ({ "sales.region": row.region, "sales.revenue": row.revenue, "sales.date": row.date }));
    const scoped = pageFiltersFor(data, [{ column: "regions.name", op: "eq", value: "North" }], ["sales"]);
    expect(scoped.error).toBeNull();
    expect(scoped.filters).toEqual([]);
    const missing = pageFiltersFor(data, [{ column: "sales.missing", op: "eq", value: "N" }], ["sales"]);
    expect(missing.error).toBe("Missing column sales.missing.");
  });

  it("explains a numeric filter on text", () => {
    const result = runQuery(table(), [{ column: "region", op: "gt", value: 1 }], { groupBy: [], measure: null, filters: [] });
    expect(result.rows).toEqual([]);
    expect(result.error).toBe("region is text.");
  });

  it("counts an empty group as zero and averages it as null", () => {
    const empty = table();
    empty.rows = [];
    expect(runQuery(empty, [], { groupBy: [], measure: { column: "revenue", agg: "count" }, filters: [] }).rows).toEqual([{ count: 0 }]);
    expect(runQuery(empty, [], { groupBy: [], measure: { column: "revenue", agg: "avg" }, filters: [] }).rows).toEqual([{ "avg(revenue)": null }]);
  });

  it("loads the clean fixture and filters a region", () => {
    const bytes = new Uint8Array(readFileSync(resolve(import.meta.dirname, "../testdata/clean/sales_small.csv")));
    const loaded = loadFile("sales_small.csv", bytes);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const result = runQuery(loaded, [{ column: "region", op: "eq", value: "North" }], {
      groupBy: [],
      measure: { column: "revenue", agg: "sum" },
      filters: [],
    });
    expect(result.error).toBeNull();
    expect(result.rows).toHaveLength(1);
    expect(typeof result.rows[0]["sum(revenue)"]).toBe("number");
  });
});
