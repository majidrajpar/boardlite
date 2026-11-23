import { describe, expect, it } from "vitest";
import { tileReason } from "../src/tile-rules";

describe("tileReason", () => {
  it("rejects a KPI that has a group", () => {
    expect(tileReason("kpi", "sales.region", "sales.revenue", "text")).toBe("Remove the group. A KPI is one number.");
  });

  it("rejects a KPI without a measure", () => {
    expect(tileReason("kpi", "", "", null)).toBe("Choose a measure.");
  });

  it("rejects a chart without a group or a measure", () => {
    expect(tileReason("bar", "", "sales.revenue", null)).toBe("Choose a group and a measure.");
    expect(tileReason("line", "sales.date", "", "date")).toBe("Choose a group and a measure.");
  });

  it("rejects a line that is not grouped by a date", () => {
    expect(tileReason("line", "sales.region", "sales.revenue", "text")).toBe("Choose a date column for the line.");
  });

  it("allows a line grouped by a date", () => {
    expect(tileReason("line", "sales.date", "sales.revenue", "date")).toBeNull();
  });
});
