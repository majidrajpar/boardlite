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

export type SavedReport = { id: string; name: string; report: Report };
export type Library = { version: 1; activeId: string; reports: SavedReport[] };

const DB = "boardlite";
const STORE = "kv";
const LEGACY_KEY = "report";
const LIBRARY_KEY = "library";

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

export function isLibrary(value: unknown): value is Library {
  if (!value || typeof value !== "object") return false;
  const library = value as Library;
  return library.version === 1 && typeof library.activeId === "string" && Array.isArray(library.reports);
}

export function libraryFromStored(storedLibrary: unknown, storedReport: unknown): { library: Library; usedLegacy: boolean } {
  if (isLibrary(storedLibrary)) return { library: storedLibrary, usedLegacy: false };
  const legacy = normalizeReport(storedReport);
  if (legacy) {
    return {
      library: { version: 1, activeId: "legacy", reports: [{ id: "legacy", name: legacy.name || "Untitled", report: legacy }] },
      usedLegacy: true,
    };
  }
  const report = emptyReport();
  return { library: { version: 1, activeId: "untitled", reports: [{ id: "untitled", name: report.name, report }] }, usedLegacy: false };
}

async function database() {
  return openDB(DB, 1, { upgrade(base) { if (!base.objectStoreNames.contains(STORE)) base.createObjectStore(STORE); } });
}

export async function loadLibrary(): Promise<Library> {
  const db = await database();
  const stored = await db.get(STORE, LIBRARY_KEY);
  const legacy = isLibrary(stored) ? null : await db.get(STORE, LEGACY_KEY);
  const result = libraryFromStored(stored, legacy);
  if (result.usedLegacy) {
    await db.put(STORE, result.library, LIBRARY_KEY);
    await db.delete(STORE, LEGACY_KEY);
  }
  return result.library;
}

export async function saveLibrary(library: Library): Promise<"saved" | "unavailable"> {
  try {
    const db = await database();
    await db.put(STORE, library, LIBRARY_KEY);
    return "saved";
  } catch {
    return "unavailable";
  }
}
