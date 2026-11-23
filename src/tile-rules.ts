export type GroupType = "text" | "number" | "date" | "boolean" | "null";

export function tileReason(kind: string, group: string, measure: string, groupType: GroupType | null): string | null {
  if (kind === "kpi" && group) return "Remove the group. A KPI is one number.";
  if (kind === "kpi" && !measure) return "Choose a measure.";
  if ((kind === "bar" || kind === "line") && (!group || !measure)) return "Choose a group and a measure.";
  if (kind === "line" && groupType !== "date") return "Choose a date column for the line.";
  return null;
}
