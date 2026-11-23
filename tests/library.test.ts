import { describe, expect, it } from "vitest";
import { libraryFromStored } from "../src/report";

describe("libraryFromStored", () => {
  const legacy = {
    version: 2,
    name: "Sales",
    tables: [],
    relationships: [],
    measures: [],
    pageFilters: [],
    tiles: [{ id: "tile-1", kind: "kpi", title: "Revenue", query: { groupBy: [], measure: { column: "revenue", agg: "sum" }, filters: [] } }],
  };

  it("wraps a version 2 report and keeps the tile id", () => {
    const result = libraryFromStored(null, legacy);
    expect(result.usedLegacy).toBe(true);
    expect(result.library.reports).toHaveLength(1);
    expect(result.library.reports[0].report.tiles[0].id).toBe("tile-1");
  });

  it("ignores the old report key once a library exists", () => {
    const library = libraryFromStored(null, legacy).library;
    library.reports[0].report.tiles[0].id = "kept";
    const second = libraryFromStored(library, legacy);
    expect(second.usedLegacy).toBe(false);
    expect(second.library.reports[0].report.tiles[0].id).toBe("kept");
  });
});