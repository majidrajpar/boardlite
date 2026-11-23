import type { Cell, LoadedTable } from "./load";

export type Agg = "count" | "sum" | "avg" | "min" | "max";
export type TextOp = "eq" | "neq" | "contains";
export type NumberOp = "gt" | "gte" | "lt" | "lte";

export type Filter =
  | { column: string; op: TextOp; value: string }
  | { column: string; op: NumberOp; value: number }
  | { column: string; op: "between"; start: string; end: string };

export type Query = {
  table?: string;
  groupBy: string[];
  measure: { column: string; agg: Agg } | null;
  filters: Filter[];
};

export type QueryResult = {
  columns: string[];
  rows: Record<string, string | number | null>[];
  error: string | null;
  warning: string | null;
};

function display(value: Cell): string {
  if (value === null) return "";
  return String(value);
}

function columnType(table: LoadedTable, name: string) {
  return table.columns.find((column) => column.name === name);
}

function applyFilters(table: LoadedTable, filters: Filter[]): { rows: LoadedTable["rows"]; error: string | null } {
  let rows = table.rows;
  for (const filter of filters) {
    const column = columnType(table, filter.column);
    if (!column) return { rows: [], error: `Missing column ${filter.column}.` };
    if (filter.op === "gt" || filter.op === "gte" || filter.op === "lt" || filter.op === "lte") {
      if (column.type !== "number") return { rows: [], error: `${filter.column} is ${column.type}.` };
      rows = rows.filter((row) => {
        const value = row[filter.column];
        if (typeof value !== "number") return false;
        if (filter.op === "gt") return value > filter.value;
        if (filter.op === "gte") return value >= filter.value;
        if (filter.op === "lt") return value < filter.value;
        return value <= filter.value;
      });
    } else if (filter.op === "between") {
      if (column.type !== "date") return { rows: [], error: `${filter.column} is ${column.type}.` };
      rows = rows.filter((row) => {
        const value = row[filter.column];
        return typeof value === "string" && value >= filter.start && value <= filter.end;
      });
    } else if (filter.op === "eq" || filter.op === "neq" || filter.op === "contains") {
      const expected = filter.value;
      rows = rows.filter((row) => {
        const text = display(row[filter.column] ?? null);
        if (filter.op === "eq") return text === expected;
        if (filter.op === "neq") return text !== expected;
        return text.includes(expected);
      });
    }
  }
  return { rows, error: null };
}

function compareValues(a: string | number | null, b: string | number | null, type: string): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (type === "number" && typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

function measureValue(values: Cell[], agg: Agg): number | null {
  if (agg === "count") return values.length;
  const numbers = values.filter((value): value is number => typeof value === "number");
  if (numbers.length === 0) return null;
  if (agg === "sum") return numbers.reduce((sum, value) => sum + value, 0);
  if (agg === "min") return Math.min(...numbers);
  if (agg === "max") return Math.max(...numbers);
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

export function pageFiltersFor(
  table: LoadedTable,
  filters: Filter[],
  modelTables: string[],
): { filters: Filter[]; error: string | null } {
  const present = new Set(table.columns.map((column) => column.name));
  const inModel = new Set(modelTables);
  const active: Filter[] = [];
  for (const filter of filters) {
    if (present.has(filter.column)) {
      active.push(filter);
      continue;
    }
    const tableName = filter.column.includes(".") ? filter.column.slice(0, filter.column.indexOf(".")) : "";
    if (tableName && !inModel.has(tableName)) continue;
    return { filters: [], error: `Missing column ${filter.column}.` };
  }
  return { filters: active, error: null };
}

export function runQuery(table: LoadedTable, filters: Filter[], query: Query): QueryResult {
  for (const name of query.groupBy) {
    if (!columnType(table, name)) return { columns: [], rows: [], error: `Missing column ${name}.`, warning: null };
  }
  if (query.measure && query.measure.agg !== "count" && !columnType(table, query.measure.column)) {
    return { columns: [], rows: [], error: `Missing column ${query.measure.column}.`, warning: null };
  }
  const filtered = applyFilters(table, [...filters, ...query.filters]);
  if (filtered.error) return { columns: [], rows: [], error: filtered.error, warning: null };

  if (!query.measure && query.groupBy.length === 0) {
    return {
      columns: table.columns.map((column) => column.name),
      rows: filtered.rows.map((row) => {
        const out: Record<string, string | number | null> = {};
        for (const column of table.columns) {
          const value = row[column.name];
          out[column.name] = typeof value === "boolean" ? String(value) : value;
        }
        return out;
      }),
      error: null,
      warning: null,
    };
  }

  const measureName = query.measure?.agg === "count" ? "count" : `${query.measure?.agg}(${query.measure?.column})`;
  const groups = new Map<string, LoadedTable["rows"]>();
  for (const row of filtered.rows) {
    const key = JSON.stringify(query.groupBy.map((name) => row[name] ?? null));
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }
  if (query.groupBy.length === 0 && groups.size === 0) groups.set("[]", []);

  const rows = [...groups.entries()].map(([key, bucket]) => {
    const keys = JSON.parse(key) as (string | number | boolean | null)[];
    const out: Record<string, string | number | null> = {};
    query.groupBy.forEach((name, index) => {
      const value = keys[index];
      out[name] = typeof value === "boolean" ? String(value) : value;
    });
    if (query.measure) {
      const values = query.measure.agg === "count" ? bucket.map(() => null) : bucket.map((row) => row[query.measure!.column] ?? null);
      out[measureName] = measureValue(values, query.measure.agg);
    }
    return out;
  });

  rows.sort((left, right) => {
    for (const name of query.groupBy) {
      const type = columnType(table, name)?.type ?? "text";
      const order = compareValues(left[name], right[name], type);
      if (order !== 0) return order;
    }
    return 0;
  });

  const columns = query.measure ? [...query.groupBy, measureName] : [...query.groupBy];
  return { columns, rows, error: null, warning: null };
}
