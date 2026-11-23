import type { Cell, LoadedTable } from "./load";

export type Join = {
  fromColumn: string;
  toName: string;
  toColumn: string;
  to: LoadedTable;
};

function display(value: Cell): string {
  if (value === null) return "";
  return String(value);
}

export function qualify(tableName: string, column: string): string {
  return `${tableName}.${column}`;
}

export function expandModel(baseName: string, base: LoadedTable, joins: Join[]): { table: LoadedTable; error: string | null } {
  for (const join of joins) {
    if (!base.columns.some((column) => column.name === join.fromColumn)) {
      return { table: base, error: `${baseName} has no column ${join.fromColumn}.` };
    }
    if (!join.to.columns.some((column) => column.name === join.toColumn)) {
      return { table: base, error: `${join.toName} has no column ${join.toColumn}.` };
    }
  }
  const lookups = joins.map((join) => {
    const map = new Map<string, Record<string, Cell>>();
    for (const row of join.to.rows) {
      const key = display(row[join.toColumn] ?? null);
      if (!map.has(key)) map.set(key, row);
    }
    return { join, map };
  });
  const columns = [
    ...base.columns.map((column) => ({ name: qualify(baseName, column.name), type: column.type })),
    ...joins.flatMap((join) => join.to.columns.map((column) => ({ name: qualify(join.toName, column.name), type: column.type }))),
  ];
  const rows = base.rows.map((row) => {
    const out: Record<string, Cell> = {};
    for (const column of base.columns) out[qualify(baseName, column.name)] = row[column.name] ?? null;
    for (const { join, map } of lookups) {
      const match = map.get(display(row[join.fromColumn] ?? null));
      for (const column of join.to.columns) {
        out[qualify(join.toName, column.name)] = match ? (match[column.name] ?? null) : null;
      }
    }
    return out;
  });
  return { table: { ok: true, columns, rows }, error: null };
}
