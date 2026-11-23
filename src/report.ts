import { openDB } from "idb";
import type { Agg, Filter, Query } from "./query";

export type Tile = {
  id: string;
  kind: "table" | "kpi" | "bar" | "line";
  title: string;
  query: Query;
};

export type TableMeta = {
  id: string;
  name: string;
  sourceName: string;
  sourceUrl: string;
};

export type Relationship = {
  id: string;
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
};

export type Measure = {
  id: string;
  name: string;
  table: string;
  column: string;
  agg: Agg;
};

export type Report = {
  version: 2;
  name: string;
  tables: TableMeta[];
  relationships: Relationship[];
  measures: Measure[];
  pageFilters: Filter[];
  tiles: Tile[];
};

const DB = "boardlite";
const STORE = "kv";
const KEY = "report";

export function emptyReport(name = "Untitled"): Report {
  return { version: 2, name, tables: [], relationships: [], measures: [], pageFilters: [], tiles: [] };
}

function isFilterList(value: unknown): value is Filter[] {
  return Array.isArray(value);
}

export function reportFromJson(text: string): Report | null {
  try {
    return normalizeReport(JSON.parse(text));
  } catch {
    return null;
  }
}

export function normalizeReport(value: unknown): Report | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.name !== "string" || !Array.isArray(raw.tiles) || !isFilterList(raw.pageFilters)) return null;
  if (raw.version === 2 && Array.isArray(raw.tables) && Array.isArray(raw.relationships) && Array.isArray(raw.measures)) {
    return raw as Report;
  }
  if (raw.version === 1) {
    const sourceName = typeof raw.sourceName === "string" ? raw.sourceName : "";
    const report = emptyReport(raw.name);
    report.pageFilters = raw.pageFilters as Filter[];
    report.tiles = raw.tiles as Tile[];
    if (sourceName) {
      report.tables.push({ id: "t1", name: sourceName.replace(/\.[^.]+$/, "") || "table", sourceName, sourceUrl: "" });
    }
    return report;
  }
  return null;
}

export function encodeReport(report: Report): string {
  const bytes = new TextEncoder().encode(JSON.stringify(report));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `#r=${btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")}`;
}

export function decodeReport(hash: string): Report | null {
  const token = hash.startsWith("#r=") ? hash.slice(3) : "";
  if (!token) return null;
  try {
    const padded = token.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (token.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return normalizeReport(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}

export async function saveReport(report: Report): Promise<"saved" | "unavailable"> {
  try {
    const db = await openDB(DB, 1, { upgrade(database) { database.createObjectStore(STORE); } });
    await db.put(STORE, report, KEY);
    return "saved";
  } catch {
    return "unavailable";
  }
}

export async function loadStoredReport(): Promise<Report | null> {
  try {
    const db = await openDB(DB, 1, { upgrade(database) { database.createObjectStore(STORE); } });
    return normalizeReport(await db.get(STORE, KEY));
  } catch {
    return null;
  }
}
