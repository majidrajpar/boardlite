import { describe, expect, it } from "vitest";
import { columnDrift } from "../src/reload-check";

describe("columnDrift", () => {
  const current = ["region", "revenue", "units"];

  it("drifts when a used column is missing from the next file", () => {
    expect(columnDrift(current, ["units"], [{ title: "Revenue", columns: ["revenue"] }])).toEqual([
      { title: "Revenue", missing: ["revenue"] },
    ]);
  });

  it("stays quiet when the used column is still present", () => {
    expect(columnDrift(current, ["region", "units"], [{ title: "Regions", columns: ["region"] }])).toEqual([]);
  });
});
