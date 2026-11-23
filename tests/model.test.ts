import { describe, expect, it } from "vitest";
import type { LoadedTable } from "../src/load";
import { expandModel } from "../src/model";
import { runQuery } from "../src/query";
import { decodeReport, encodeReport, emptyReport, normalizeReport, reportFromJson } from "../src/report";

function table(columns: LoadedTable["columns"], rows: LoadedTable["rows"]): LoadedTable {
  return { ok: true, columns, rows };
}

describe("expandModel", () => {
  const sales = table(
    [
      { name: "regionId", type: "text" },
      { name: "revenue", type: "number" },
    ],
    [
      { regionId: "N", revenue: 10 },
      { regionId: "S", revenue: 4 },
      { regionId: "N", revenue: 1 },
    ],
  );
  const regions = table(
    [
      { name: "id", type: "text" },
      { name: "name", type: "text" },
    ],
    [
      { id: "N", name: "North" },
      { id: "S", name: "South" },
    ],
  );

  it("groups a fact table by a related column", () => {
    const expanded = expandModel("sales", sales, [{ fromColumn: "regionId", toName: "regions", toColumn: "id", to: regions }]);
    expect(expanded.error).toBeNull();
    const result = runQuery(expanded.table, [], {
      groupBy: ["regions.name"],
      measure: { column: "sales.revenue", agg: "sum" },
      filters: [],
    });
    expect(result.rows).toEqual([
      { "regions.name": "North", "sum(sales.revenue)": 11 },
      { "regions.name": "South", "sum(sales.revenue)": 4 },
    ]);
  });

  it("uses the first match when a key is duplicated", () => {
    const dup = table([{ name: "id", type: "text" }, { name: "name", type: "text" }], [
      { id: "N", name: "First" },
      { id: "N", name: "Second" },
    ]);
    const expanded = expandModel("sales", sales, [{ fromColumn: "regionId", toName: "regions", toColumn: "id", to: dup }]);
    expect(expanded.table.rows[0]["regions.name"]).toBe("First");
  });
});

describe("report codec", () => {
  it("migrates a version 1 report", () => {
    const report = normalizeReport({
      version: 1,
      name: "Old",
      sourceName: "sales.csv",
      pageFilters: [],
      tiles: [],
    });
    expect(report?.version).toBe(2);
    expect(report?.tables[0].sourceName).toBe("sales.csv");
  });

  it("rejects JSON that is not a report", () => {
    expect(reportFromJson("{")).toBeNull();
    expect(reportFromJson("{\"name\":\"x\"}")).toBeNull();
  });

  it("round-trips a report through the hash", () => {
    const report = emptyReport("München");
    report.measures.push({ id: "m1", name: "Revenue", table: "t1", column: "revenue", agg: "sum" });
    expect(decodeReport(encodeReport(report))?.name).toBe("München");
    expect(decodeReport(encodeReport(report))?.measures[0].name).toBe("Revenue");
  });
});
