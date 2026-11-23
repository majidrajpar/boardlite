import * as Plot from "@observablehq/plot";
import { workbookBytes } from "./export-xlsx";
import { loadFile, type LoadedTable } from "./load";
import { expandModel, qualify, type Join } from "./model";
import { pageFiltersFor, runQuery, type Agg, type Filter, type Query } from "./query";
import { columnDrift } from "./reload-check";
import {
  decodeReport,
  emptyReport,
  encodeReport,
  loadLibrary,
  reportFromJson,
  saveLibrary,
  type Library,
  type Measure,
  type Relationship,
  type Report,
  type TableMeta,
  type Tile,
} from "./report";
import { tileReason, type GroupType } from "./tile-rules";

const status = document.querySelector<HTMLElement>("#status")!;
const columnsEl = document.querySelector<HTMLElement>("#columns")!;
const canvas = document.querySelector<HTMLElement>("#canvas")!;
const nameEl = document.querySelector<HTMLElement>("#report-name")!;
const pageForm = document.querySelector<HTMLFormElement>("#page-filters")!;
const addForm = document.querySelector<HTMLFormElement>("#add-tile")!;
const modelEl = document.querySelector<HTMLElement>("#model")!;
const confirmDialog = document.querySelector<HTMLDialogElement>("#confirm")!;
const confirmText = document.querySelector<HTMLElement>("#confirm-text")!;
const tileHint = document.querySelector<HTMLElement>("#tile-hint")!;
const keepButton = document.querySelector<HTMLButtonElement>("#keep")!;
const reportsSelect = document.querySelector<HTMLSelectElement>("#reports")!;

const opened = new Map<string, LoadedTable>();
let library: Library = { version: 1, activeId: "untitled", reports: [{ id: "untitled", name: "Untitled", report: emptyReport() }] };
let report: Report = library.reports[0].report;
let shared = false;
const undoStack: { tiles: Tile[]; pageFilters: Filter[] }[] = [];

function uid(): string {
  return crypto.randomUUID();
}

function remember() {
  undoStack.push(structuredClone({ tiles: report.tiles, pageFilters: report.pageFilters }));
  if (undoStack.length > 20) undoStack.shift();
}

function undo() {
  const previous = undoStack.pop();
  if (!previous) {
    renderStatus("Nothing to undo.");
    return;
  }
  report.tiles = previous.tiles;
  report.pageFilters = previous.pageFilters;
  void persist();
  render();
}

function groupTypeOf(column: string): GroupType | null {
  const dot = column.indexOf(".");
  if (dot < 0) return null;
  const tableName = column.slice(0, dot);
  const columnName = column.slice(dot + 1);
  const meta = report.tables.find((table) => table.name === tableName);
  const data = meta ? opened.get(meta.id) : undefined;
  const type = data?.columns.find((item) => item.name === columnName)?.type;
  return type && type !== "null" ? type : type === "null" ? "null" : null;
}

function columnsUsedBy(tableName: string): { title: string; columns: string[] }[] {
  return report.tiles.map((tile) => {
    const names = [...tile.query.groupBy, ...tile.query.filters.map((filter) => filter.column), ...report.pageFilters.map((filter) => filter.column)];
    if (tile.query.measure?.column) names.push(tile.query.measure.column);
    const columns = names.filter((name) => name.startsWith(`${tableName}.`)).map((name) => name.slice(tableName.length + 1));
    return { title: tile.title, columns };
  });
}

function askConfirm(message: string): Promise<boolean> {
  confirmText.textContent = message;
  confirmDialog.showModal();
  return new Promise((resolve) => {
    confirmDialog.addEventListener("close", () => resolve(confirmDialog.returnValue === "ok"), { once: true });
  });
}

function stem(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "").replace(/[^\w]+/g, "_").replace(/^_|_$/g, "");
  return base || "table";
}

function uniqueName(base: string): string {
  const names = new Set(report.tables.map((table) => table.name));
  if (!names.has(base)) return base;
  let index = 2;
  while (names.has(`${base}_${index}`)) index += 1;
  return `${base}_${index}`;
}

function metaById(id: string): TableMeta | undefined {
  return report.tables.find((table) => table.id === id);
}

function columnsFor(tableId: string): string[] {
  const meta = metaById(tableId);
  const data = meta ? opened.get(meta.id) : undefined;
  if (!meta || !data) return [];
  const joins: Join[] = [];
  for (const link of report.relationships) {
    if (link.fromTable !== meta.id) continue;
    const to = metaById(link.toTable);
    const toData = to ? opened.get(to.id) : undefined;
    if (!to || !toData) continue;
    joins.push({ fromColumn: link.fromColumn, toName: to.name, toColumn: link.toColumn, to: toData });
  }
  const expanded = expandModel(meta.name, data, joins);
  return expanded.error ? data.columns.map((column) => qualify(meta.name, column.name)) : expanded.table.columns.map((column) => column.name);
}

function columnChoices(): string[] {
  const names: string[] = [];
  for (const meta of report.tables) {
    const data = opened.get(meta.id);
    if (!data) continue;
    for (const column of data.columns) names.push(qualify(meta.name, column.name));
  }
  return names;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

function renderStatus(text: string) {
  status.textContent = shared ? `Read-only link. ${text}` : text;
}

function prefix(baseName: string, column: string): string {
  return column.includes(".") ? column : qualify(baseName, column);
}

function prepared(query: Query): { table: LoadedTable; query: Query; pageFilters: Filter[]; error: string | null } {
  const meta = metaById(query.table ?? "") ?? report.tables[0];
  const empty: LoadedTable = { ok: true, columns: [], rows: [] };
  if (!meta) return { table: empty, query, pageFilters: [], error: "Open a CSV or Excel file." };
  const data = opened.get(meta.id);
  if (!data) return { table: empty, query, pageFilters: [], error: `Open ${meta.sourceName || meta.name} to fill this tile.` };
  const joins: Join[] = [];
  for (const link of report.relationships) {
    if (link.fromTable !== meta.id) continue;
    const to = metaById(link.toTable);
    const toData = to ? opened.get(to.id) : undefined;
    if (!to || !toData) return { table: empty, query, pageFilters: [], error: "Open the related table to fill this tile." };
    joins.push({ fromColumn: link.fromColumn, toName: to.name, toColumn: link.toColumn, to: toData });
  }
  const expanded = expandModel(meta.name, data, joins);
  if (expanded.error) return { table: empty, query, pageFilters: [], error: expanded.error };
  const measure = resolveMeasure(query.measure, meta);
  const next: Query = {
    table: meta.id,
    groupBy: query.groupBy.map((column) => prefix(meta.name, column)),
    measure: measure.measure,
    filters: query.filters.map((filter) => ({ ...filter, column: prefix(meta.name, filter.column) })),
  };
  const pageFilters = report.pageFilters.map((filter) => ({ ...filter, column: prefix(meta.name, filter.column) }));
  const scoped = pageFiltersFor(expanded.table, pageFilters, [meta.name, ...joins.map((join) => join.toName)]);
  if (measure.error) return { table: expanded.table, query: next, pageFilters: scoped.filters, error: measure.error };
  if (scoped.error) return { table: expanded.table, query: next, pageFilters: [], error: scoped.error };
  return { table: expanded.table, query: next, pageFilters: scoped.filters, error: null };
}

function resolveMeasure(measure: Query["measure"], meta: TableMeta): { measure: Query["measure"]; error: string | null } {
  if (!measure) return { measure, error: null };
  const saved = report.measures.find((item) => item.name === measure.column || item.id === measure.column);
  if (!saved) return { measure: { ...measure, column: prefix(meta.name, measure.column) }, error: null };
  const owner = metaById(saved.table);
  if (!owner) return { measure, error: `Missing measure ${saved.name}.` };
  return { measure: { column: qualify(owner.name, saved.column), agg: saved.agg }, error: null };
}

function renderColumns() {
  columnsEl.replaceChildren();
  for (const name of columnChoices()) {
    const chip = document.createElement("span");
    chip.className = "chip";
    const [tableName, columnName] = name.split(".");
    const meta = report.tables.find((table) => table.name === tableName);
    const type = meta && opened.get(meta.id)?.columns.find((column) => column.name === columnName)?.type;
    chip.textContent = type ? `${name} · ${type}` : name;
    columnsEl.append(chip);
  }
}

function select(options: string[], value = "", blankLabel = "None"): HTMLSelectElement {
  const element = document.createElement("select");
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = blankLabel;
  element.append(blank);
  for (const option of options) {
    const item = document.createElement("option");
    item.value = option;
    item.textContent = option;
    if (option === value) item.selected = true;
    element.append(item);
  }
  return element;
}

function filterLabel(filter: Filter): string {
  return `${filter.column} ${filter.op} ${"value" in filter ? filter.value : `${filter.start}..${filter.end}`}`;
}

function readFilter(column: string, op: string, value: string, end: string): Filter | null {
  if (op === "gt" || op === "gte" || op === "lt" || op === "lte") {
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    return { column, op, value: number };
  }
  if (op === "between") return { column, op: "between", start: value, end };
  if (op === "eq" || op === "neq" || op === "contains") return { column, op, value };
  return null;
}

function filterEditor(filters: Filter[], addLabel: string): HTMLElement {
  const form = document.createElement("form");
  form.className = "filters";
  filters.forEach((filter, index) => {
    const row = document.createElement("span");
    row.textContent = filterLabel(filter);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.className = "edit";
    remove.addEventListener("click", () => {
      remember();
      filters.splice(index, 1);
      persist();
      render();
    });
    form.append(row, remove);
  });
  const names = columnChoices();
  if (names.length === 0 || shared) return form;
  const column = select(names, "", "Column");
  const op = document.createElement("select");
  for (const value of ["eq", "neq", "contains", "gt", "gte", "lt", "lte", "between"]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    op.append(option);
  }
  const value = document.createElement("input");
  value.placeholder = "Value";
  const end = document.createElement("input");
  end.placeholder = "End";
  const add = document.createElement("button");
  add.type = "button";
  add.textContent = addLabel;
  add.addEventListener("click", () => {
    const name = column.value;
    if (!name) return;
    const filter = readFilter(name, op.value, value.value, end.value);
    if (!filter) return;
    remember();
    filters.push(filter);
    persist();
    render();
  });
  form.append(column, op, value, end, add);
  return form;
}

function renderPageFilters() {
  pageForm.replaceChildren();
  const title = document.createElement("strong");
  title.textContent = "Page filters";
  pageForm.append(title, filterEditor(report.pageFilters, "Add page filter"));
}

function renderModel() {
  modelEl.replaceChildren();
  const tables = document.createElement("div");
  tables.className = "model-card";
  const heading = document.createElement("strong");
  heading.textContent = "Tables";
  tables.append(heading);
  for (const meta of report.tables) {
    const data = opened.get(meta.id);
    const label = document.createElement("span");
    label.textContent = `${meta.name}: ${data ? `${data.rows.length} rows` : `open ${meta.sourceName || "file"}`}`;
    const url = document.createElement("input");
    url.placeholder = "https://…/file.csv";
    url.value = meta.sourceUrl;
    url.className = "edit";
    url.addEventListener("change", () => {
      meta.sourceUrl = url.value.trim();
      persist();
    });
    tables.append(label, url);
  }
  const link = document.createElement("div");
  link.className = "model-card edit";
  const linkHelp = document.createElement("p");
  linkHelp.className = "note";
  linkHelp.textContent = "Connect a column on the chart's table to the matching column on the second file.";
  link.append(linkHelp);
  const fromTable = select(report.tables.map((table) => table.name), "", "From table");
  const fromColumn = select([], "", "From column");
  const toTable = select(report.tables.map((table) => table.name), "", "To table");
  const toColumn = select([], "", "To column");
  const fillColumns = (tableName: string, target: HTMLSelectElement) => {
    const meta = report.tables.find((table) => table.name === tableName);
    const data = meta ? opened.get(meta.id) : undefined;
    const names = data?.columns.map((column) => column.name) ?? [];
    const current = target.value;
    target.replaceChildren();
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = target === fromColumn ? "From column" : "To column";
    target.append(blank);
    for (const name of names) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      target.append(option);
    }
    target.value = names.includes(current) ? current : "";
  };
  fromTable.addEventListener("change", () => fillColumns(fromTable.value, fromColumn));
  toTable.addEventListener("change", () => fillColumns(toTable.value, toColumn));
  fillColumns(fromTable.value, fromColumn);
  fillColumns(toTable.value, toColumn);
  const addLink = document.createElement("button");
  addLink.type = "button";
  addLink.textContent = "Add relationship";
  addLink.addEventListener("click", () => {
    const from = report.tables.find((table) => table.name === fromTable.value);
    const to = report.tables.find((table) => table.name === toTable.value);
    if (!from || !to || !fromColumn.value || !toColumn.value) {
      renderStatus("Choose both tables and both columns.");
      return;
    }
    const relationship: Relationship = { id: uid(), fromTable: from.id, fromColumn: fromColumn.value, toTable: to.id, toColumn: toColumn.value };
    report.relationships.push(relationship);
    persist();
    render();
  });
  for (const relationship of report.relationships) {
    const from = metaById(relationship.fromTable);
    const to = metaById(relationship.toTable);
    const row = document.createElement("span");
    row.textContent = `${from?.name ?? "?"}.${relationship.fromColumn} → ${to?.name ?? "?"}.${relationship.toColumn}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      report.relationships = report.relationships.filter((item) => item.id !== relationship.id);
      persist();
      render();
    });
    link.append(row, remove);
  }
  link.append(fromTable, fromColumn, toTable, toColumn, addLink);

  const measures = document.createElement("div");
  measures.className = "model-card edit";
  const measureName = document.createElement("input");
  measureName.placeholder = "Measure name";
  const measureTable = select(report.tables.map((table) => table.name), "", "Table");
  const measureColumn = select([], "", "Column");
  const fillMeasureColumns = () => {
    const meta = report.tables.find((table) => table.name === measureTable.value);
    const names = meta ? opened.get(meta.id)?.columns.map((column) => column.name) ?? [] : [];
    const current = measureColumn.value;
    measureColumn.replaceChildren();
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = "Column";
    measureColumn.append(blank);
    for (const name of names) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      measureColumn.append(option);
    }
    measureColumn.value = names.includes(current) ? current : "";
  };
  measureTable.addEventListener("change", fillMeasureColumns);
  fillMeasureColumns();
  const measureAgg = document.createElement("select");
  for (const value of ["sum", "count", "avg", "min", "max"]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    measureAgg.append(option);
  }
  const addMeasure = document.createElement("button");
  addMeasure.type = "button";
  addMeasure.textContent = "Add measure";
  addMeasure.addEventListener("click", () => {
    const owner = report.tables.find((table) => table.name === measureTable.value);
    if (!owner || !measureName.value || !measureColumn.value) return;
    const measure: Measure = { id: uid(), name: measureName.value, table: owner.id, column: measureColumn.value, agg: measureAgg.value as Agg };
    report.measures.push(measure);
    persist();
    render();
  });
  for (const measure of report.measures) {
    const owner = metaById(measure.table);
    const row = document.createElement("span");
    row.textContent = `${measure.name} = ${measure.agg}(${owner?.name ?? "?"}.${measure.column})`;
    measures.append(row);
  }
  measures.append(measureName, measureTable, measureColumn, measureAgg, addMeasure);
  modelEl.append(tables, link, measures);
}

function renderAddForm() {
  addForm.replaceChildren();
  if (shared) return;
  const kind = document.createElement("select");
  for (const value of ["table", "kpi", "bar", "line"]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    kind.append(option);
  }
  const title = document.createElement("input");
  title.placeholder = "Title";
  title.required = true;
  const tablePick = select(report.tables.map((table) => table.name), report.tables[0]?.name ?? "", "Table");
  const ownerId = () => report.tables.find((table) => table.name === tablePick.value)?.id ?? report.tables[0]?.id ?? "";
  const group = select(columnsFor(ownerId()));
  const measure = select([...report.measures.map((item) => item.name), ...columnsFor(ownerId())]);
  const refill = () => {
    const names = columnsFor(ownerId());
    for (const [target, extra] of [[group, []], [measure, report.measures.map((item) => item.name)]] as const) {
      const current = target.value;
      const options = [...extra, ...names];
      target.replaceChildren();
      const blank = document.createElement("option");
      blank.value = "";
      blank.textContent = "None";
      target.append(blank);
      for (const option of options) {
        const item = document.createElement("option");
        item.value = option;
        item.textContent = option;
        target.append(item);
      }
      target.value = options.includes(current) ? current : "";
    }
  };
  tablePick.addEventListener("change", refill);
  refill();
  const agg = document.createElement("select");
  for (const value of ["sum", "count", "avg", "min", "max"]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    agg.append(option);
  }
  const button = document.createElement("button");
  button.type = "submit";
  button.textContent = "Add tile";
  addForm.append(field("Tile", kind), field("Title", title), field("Table", tablePick), field("Group by", group), field("Measure", measure), field("Agg", agg), button);
  addForm.onsubmit = (event) => {
    event.preventDefault();
    const owner = report.tables.find((table) => table.name === tablePick.value) ?? report.tables[0];
    const saved = report.measures.find((item) => item.name === measure.value);
    const reason = tileReason(kind.value, group.value, measure.value, group.value ? groupTypeOf(group.value) : null);
    tileHint.textContent = reason ?? "";
    if (reason || !owner) {
      if (!owner) tileHint.textContent = "Open a CSV or Excel file.";
      return;
    }
    remember();
    const query: Query = {
      table: owner.id,
      groupBy: group.value ? [group.value] : [],
      measure: measure.value ? { column: saved ? saved.name : measure.value, agg: saved?.agg ?? (agg.value as Agg) } : null,
      filters: [],
    };
    report.tiles.push({ id: uid(), kind: kind.value as Tile["kind"], title: title.value, query });
    title.value = "";
    persist();
    render();
  };
}

function field(label: string, control: HTMLElement): HTMLLabelElement {
  const wrap = document.createElement("label");
  wrap.append(document.createTextNode(label), control);
  return wrap;
}

function bare(column: string): string {
  const split = column.split(".");
  return split.length > 1 ? split.slice(1).join(".") : column;
}

function renderTile(tile: Tile) {
  const article = document.createElement("article");
  article.className = "tile";
  const header = document.createElement("header");
  const heading = document.createElement("h2");
  heading.textContent = tile.title;
  const controls = document.createElement("div");
  controls.className = "edit";
  const up = document.createElement("button");
  up.type = "button";
  up.textContent = "Up";
  const down = document.createElement("button");
  down.type = "button";
  down.textContent = "Down";
  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "Remove";
  up.addEventListener("click", () => move(tile.id, -1));
  down.addEventListener("click", () => move(tile.id, 1));
  remove.addEventListener("click", () => {
    remember();
    report.tiles = report.tiles.filter((item) => item.id !== tile.id);
    persist();
    render();
  });
  controls.append(up, down, remove);
  header.append(heading, controls);
  article.append(header, filterEditor(tile.query.filters, "Add tile filter"));
  const view = prepared(tile.query);
  if (view.error) {
    const note = document.createElement("p");
    note.className = view.error.startsWith("Open") ? "note" : "err";
    note.textContent = view.error;
    article.append(note);
    return article;
  }
  const result = runQuery(view.table, view.pageFilters, view.query);
  if (result.error) {
    const note = document.createElement("p");
    note.className = "err";
    note.textContent = result.error;
    article.append(note);
    return article;
  }
  if (tile.kind === "line") {
    const grouped = view.query.groupBy[0];
    const type = view.table.columns.find((column) => column.name === grouped)?.type;
    if (type !== "date") {
      const warn = document.createElement("p");
      warn.className = "warn";
      warn.textContent = "This line is not grouped by a date.";
      article.append(warn);
    }
  }
  article.append(draw(tile, result.rows, result.columns.map((column) => column)));
  return article;
}

function draw(tile: Tile, rows: Record<string, string | number | null>[], columns: string[]): HTMLElement {
  if (tile.kind === "kpi") {
    const paragraph = document.createElement("p");
    paragraph.className = "kpi";
    const value = rows[0] ? Object.values(rows[0])[0] : null;
    paragraph.textContent = typeof value === "number" ? formatNumber(value) : "—";
    return paragraph;
  }
  if (tile.kind === "table") {
    const shown = rows.slice(0, 200);
    const tableEl = document.createElement("table");
    const head = document.createElement("tr");
    for (const column of columns) {
      const cell = document.createElement("th");
      cell.textContent = bare(column);
      head.append(cell);
    }
    tableEl.append(head);
    for (const row of shown) {
      const line = document.createElement("tr");
      for (const column of columns) {
        const cell = document.createElement("td");
        const value = row[column];
        cell.textContent = typeof value === "number" ? formatNumber(value) : value ?? "";
        line.append(cell);
      }
      tableEl.append(line);
    }
    const wrap = document.createElement("div");
    wrap.append(tableEl);
    if (rows.length > shown.length) {
      const note = document.createElement("p");
      note.className = "note";
      note.textContent = `Showing 200 of ${rows.length} rows.`;
      wrap.append(note);
    }
    return wrap;
  }
  const group = columns[0];
  const measure = columns[1];
  let data = rows.map((row) => ({ group: String(row[group] ?? ""), value: typeof row[measure] === "number" ? row[measure] : 0 }));
  if (tile.kind === "bar") data = data.sort((a, b) => b.value - a.value).slice(0, 20);
  const plot = Plot.plot({
    marks: [tile.kind === "bar" ? Plot.barX(data, { y: "group", x: "value" }) : Plot.lineY(data, { x: "group", y: "value" })],
    marginLeft: 80,
    height: 240,
    width: 480,
  });
  const host = document.createElement("div");
  host.append(plot);
  return host;
}

function move(id: string, direction: number) {
  const index = report.tiles.findIndex((tile) => tile.id === id);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= report.tiles.length) return;
  remember();
  const [tile] = report.tiles.splice(index, 1);
  report.tiles.splice(next, 0, tile);
  persist();
  render();
}

function render() {
  document.body.classList.toggle("readonly", shared);
  keepButton.hidden = !shared;
  nameEl.textContent = report.name || "Untitled";
  renderReportList();
  renderModel();
  renderColumns();
  renderPageFilters();
  renderAddForm();
  canvas.replaceChildren(...report.tiles.map(renderTile));
}

function renderReportList() {
  reportsSelect.replaceChildren();
  for (const saved of library.reports) {
    const option = document.createElement("option");
    option.value = saved.id;
    option.textContent = saved.name || saved.report.name || "Untitled";
    option.selected = saved.id === library.activeId;
    reportsSelect.append(option);
  }
}

async function persist() {
  if (shared) return;
  const saved = library.reports.find((item) => item.id === library.activeId);
  if (saved) {
    saved.report = report;
    saved.name = report.name || "Untitled";
  }
  const outcome = await saveLibrary(library);
  if (outcome === "unavailable") renderStatus("This browser will not keep the report.");
}

async function bindFile(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const loaded = loadFile(file.name, bytes);
  if (!loaded.ok) {
    renderStatus(`Refused ${file.name}: ${loaded.refuseReason.replaceAll("_", " ")}.`);
    return;
  }
  const existing = report.tables.find((table) => table.sourceName === file.name || table.name === stem(file.name));
  if (existing) {
    opened.set(existing.id, loaded);
    existing.sourceName = file.name;
    renderStatus(`${existing.name}: ${loaded.rows.length} rows.`);
  } else if (shared) {
    renderStatus(`This link expects ${report.tables.map((table) => table.sourceName || table.name).join(", ")}.`);
    return;
  } else {
    const meta: TableMeta = { id: uid(), name: uniqueName(stem(file.name)), sourceName: file.name, sourceUrl: "" };
    report.tables.push(meta);
    opened.set(meta.id, loaded);
    if (!report.name || report.name === "Untitled") report.name = file.name;
    renderStatus(`${meta.name}: ${loaded.rows.length} rows, ${loaded.columns.length} columns.`);
  }
  await persist();
  render();
}

async function reloadUrls() {
  const pending: { id: string; loaded: LoadedTable }[] = [];
  let refreshed = 0;
  for (const meta of report.tables) {
    if (!meta.sourceUrl) continue;
    try {
      const response = await fetch(meta.sourceUrl);
      if (!response.ok) throw new Error(`${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const fileName = meta.sourceName || `${meta.name}.csv`;
      const loaded = loadFile(fileName, bytes);
      if (!loaded.ok) {
        renderStatus(`Refused ${meta.sourceUrl}: ${loaded.refuseReason.replaceAll("_", " ")}.`);
        return;
      }
      const current = opened.get(meta.id);
      const drift = columnDrift(
        current?.columns.map((column) => column.name) ?? [],
        loaded.columns.map((column) => column.name),
        columnsUsedBy(meta.name),
      );
      if (drift.length) {
        const lines = drift.map((item) => `${item.title}: ${item.missing.join(", ")}`).join("\n");
        const ok = await askConfirm(`These tiles use columns the new file does not have:\n${lines}`);
        if (!ok) {
          renderStatus("Reload cancelled. The current rows are unchanged.");
          return;
        }
      }
      pending.push({ id: meta.id, loaded });
      refreshed += 1;
    } catch {
      renderStatus(`Could not reload ${meta.name}. The URL must allow this page to fetch it.`);
      return;
    }
  }
  for (const item of pending) opened.set(item.id, item.loaded);
  renderStatus(refreshed ? `Reloaded ${refreshed} table${refreshed === 1 ? "" : "s"}.` : "Add a URL on a table first.");
  render();
}

document.querySelector<HTMLInputElement>("#file")!.addEventListener("change", async (event) => {
  const input = event.target as HTMLInputElement;
  for (const file of input.files ?? []) await bindFile(file);
  input.value = "";
});

document.body.addEventListener("dragover", (event) => {
  event.preventDefault();
});
document.body.addEventListener("drop", async (event) => {
  event.preventDefault();
  if (shared) return;
  for (const file of event.dataTransfer?.files ?? []) await bindFile(file);
});

document.querySelector<HTMLButtonElement>("#reload")!.addEventListener("click", () => void reloadUrls());

document.querySelector<HTMLButtonElement>("#share")!.addEventListener("click", async () => {
  const url = `${location.origin}${location.pathname}${encodeReport(report)}`;
  try {
    await navigator.clipboard.writeText(url);
    renderStatus("Link copied. It holds the report, not the rows. The reader opens the same files or URLs.");
  } catch {
    renderStatus(url);
  }
});

keepButton.addEventListener("click", async () => {
  shared = false;
  history.replaceState(null, "", location.pathname);
  await persist();
  renderStatus("Saved a copy in this browser.");
  render();
});

document.querySelector<HTMLButtonElement>("#export")!.addEventListener("click", () => {
  const sheets = report.tiles.map((tile) => {
    const view = prepared(tile.query);
    if (view.error) return { name: tile.title, rows: [{ note: view.error }] };
    const result = runQuery(view.table, view.pageFilters, view.query);
    if (result.error) return { name: tile.title, rows: [{ note: result.error }] };
    return { name: tile.title, rows: result.rows };
  });
  const bytes = workbookBytes(sheets);
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  const blob = new Blob([copy], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${report.name || "boardlite"}.xlsx`;
  link.click();
  URL.revokeObjectURL(link.href);
  renderStatus(sheets.length ? "Excel file downloaded. Each tile is a sheet." : "Excel file downloaded. Add a tile to include results.");
});

document.querySelector<HTMLInputElement>("#import")!.addEventListener("change", async (event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  const parsed = reportFromJson(await file.text());
  if (!parsed) {
    renderStatus("That JSON is not a report.");
    return;
  }
  const ok = await askConfirm("Replace the current report with this file?");
  if (!ok) return;
  report = parsed;
  opened.clear();
  renderStatus(report.tables.length ? `Open ${report.tables.map((table) => table.sourceName || table.name).join(", ")}.` : "Report imported.");
  await persist();
  render();
});

document.querySelector<HTMLButtonElement>("#undo")!.addEventListener("click", () => undo());

document.querySelector<HTMLButtonElement>("#new-report")!.addEventListener("click", async () => {
  if (report.name === "Untitled" && report.tiles.length === 0 && report.tables.length === 0) return;
  await persist();
  const id = uid();
  const created = emptyReport();
  library.reports.push({ id, name: created.name, report: created });
  library.activeId = id;
  report = created;
  opened.clear();
  undoStack.length = 0;
  await persist();
  render();
});

reportsSelect.addEventListener("change", async () => {
  const next = library.reports.find((item) => item.id === reportsSelect.value);
  if (!next || next.id === library.activeId) return;
  await persist();
  library.activeId = next.id;
  report = next.report;
  opened.clear();
  undoStack.length = 0;
  await persist();
  render();
  if (report.tables.length) renderStatus(`Open ${report.tables.map((table) => table.sourceName || table.name).join(", ")}.`);
});

const fromHash = decodeReport(location.hash);
if (fromHash) {
  report = fromHash;
  shared = true;
} else {
  try {
    library = await loadLibrary();
  } catch {
    library = { version: 1, activeId: "untitled", reports: [{ id: "untitled", name: "Untitled", report: emptyReport() }] };
  }
  report = library.reports.find((item) => item.id === library.activeId)?.report ?? library.reports[0].report;
  library.activeId = library.reports.find((item) => item.report === report)?.id ?? library.reports[0].id;
}
render();
if (report.tables.length) renderStatus(`Open ${report.tables.map((table) => table.sourceName || table.name).join(", ")}.`);
