import { mkdir, readFile, writeFile, copyFile, unlink, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(__dirname);

function resolvePaths() {
  const envDataDir = process.env.ASH_GLAZE_DATA_DIR;
  const envDbPath = process.env.ASH_GLAZE_DB_PATH;
  const envBackupDir = process.env.ASH_GLAZE_BACKUP_DIR;

  const baseDataDir = envDataDir || join(projectRoot, "data");
  return {
    dataDir: baseDataDir,
    dbPath: envDbPath || join(baseDataDir, "ash-glaze.json"),
    backupDir: envBackupDir || join(baseDataDir, "backups")
  };
}

const resolved = resolvePaths();
const dataDir = resolved.dataDir;
const dbPath = resolved.dbPath;
const backupDir = resolved.backupDir;

const CURRENT_SCHEMA_VERSION = 2;

const KNOWN_COLLECTIONS = [
  "tiles",
  "firingPlans",
  "recipes",
  "recipeVersions",
  "batches",
  "materialStocks"
];

const seedLegacy = {
  tiles: [
    {
      id: "AG-001",
      body: "粗陶坯",
      recipe: "松灰42 长石35 石英18 红土5",
      recipeVersionId: null,
      ashSource: "南山松灰",
      glazeThickness: "0.8mm",
      kiln: "K-2",
      firingCurve: [{ temp: 25, minutes: 0 }, { temp: 600, minutes: 180 }, { temp: 900, minutes: 300 }, { temp: 1240, minutes: 510 }, { temp: 1240, minutes: 545 }],
      peakTemp: 1240,
      color: "青灰带油滴",
      defects: "边缘流釉",
      defectTags: [{ name: "流釉", severity: "mild", note: "边缘" }],
      score: 82,
      observations: [{ at: "2026-06-10", note: "还原气氛后半段偏强" }]
    }
  ],
  firingPlans: [],
  recipes: [],
  recipeVersions: [],
  batches: [],
  materialStocks: [
    { id: "MAT-001", name: "松灰", batchNo: "SG-2026-001", quantity: 50, unit: "kg", entryDate: "2026-05-15", supplier: "南山灰场", reorderThreshold: 10, notes: "当年春采集", createdAt: "2026-05-15", updatedAt: "2026-05-15" },
    { id: "MAT-002", name: "长石", batchNo: "CS-2026-001", quantity: 80, unit: "kg", entryDate: "2026-05-20", supplier: "景德镇矿物站", reorderThreshold: 15, notes: "钾长石", createdAt: "2026-05-20", updatedAt: "2026-05-20" },
    { id: "MAT-003", name: "石英", batchNo: "SY-2026-001", quantity: 60, unit: "kg", entryDate: "2026-05-22", supplier: "景德镇矿物站", reorderThreshold: 10, notes: "200目石英粉", createdAt: "2026-05-22", updatedAt: "2026-05-22" },
    { id: "MAT-004", name: "红土", batchNo: "HT-2026-001", quantity: 30, unit: "kg", entryDate: "2026-06-01", supplier: "本地采集", reorderThreshold: 5, notes: "含铁量较高", createdAt: "2026-06-01", updatedAt: "2026-06-01" }
  ]
};

export function getDbPath() {
  return dbPath;
}

export function getDataDir() {
  return dataDir;
}

export function getBackupDir() {
  return backupDir;
}

export function getCurrentSchemaVersion() {
  return CURRENT_SCHEMA_VERSION;
}

function isNewFormat(db) {
  return typeof db === "object"
    && db !== null
    && typeof db.schemaVersion === "number"
    && "collections" in db;
}

export function getSchemaVersion(db) {
  if (isNewFormat(db)) return db.schemaVersion;
  return 0;
}

function createEmptyCollections() {
  const out = {};
  for (const name of KNOWN_COLLECTIONS) out[name] = [];
  return out;
}

export function toNewFormat(legacyDb) {
  const collections = createEmptyCollections();
  for (const name of KNOWN_COLLECTIONS) {
    if (Array.isArray(legacyDb[name])) {
      collections[name] = legacyDb[name];
    }
  }
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    migrations: [],
    collections
  };
}

export function toLegacyFormat(newDb) {
  const out = {};
  if (newDb && newDb.collections) {
    for (const name of KNOWN_COLLECTIONS) {
      if (Array.isArray(newDb.collections[name])) {
        out[name] = newDb.collections[name];
      }
    }
  }
  return out;
}

export function getCollections(db) {
  if (isNewFormat(db)) return db.collections;
  for (const name of KNOWN_COLLECTIONS) {
    if (!Array.isArray(db[name])) db[name] = [];
  }
  return db;
}

export function getMigrations(db) {
  if (isNewFormat(db)) return db.migrations || [];
  return [];
}

export function setSchemaVersion(db, version) {
  if (isNewFormat(db)) {
    db.schemaVersion = version;
  }
}

export function addMigrationRecord(db, record) {
  if (isNewFormat(db)) {
    if (!Array.isArray(db.migrations)) db.migrations = [];
    db.migrations.push(record);
  }
}

export function removeMigrationRecord(db, version) {
  if (isNewFormat(db) && Array.isArray(db.migrations)) {
    db.migrations = db.migrations.filter(m => m.version !== version);
  }
}

export function getLatestMigration(db) {
  const list = getMigrations(db);
  if (list.length === 0) return null;
  return list.reduce((a, b) => (a.appliedAt > b.appliedAt ? a : b));
}

export async function ensureDataDirs() {
  await mkdir(dataDir, { recursive: true });
  await mkdir(backupDir, { recursive: true });
}

export async function readRawDb() {
  if (!existsSync(dbPath)) return null;
  const raw = await readFile(dbPath, "utf8");
  return JSON.parse(raw);
}

export async function writeRawDb(db) {
  await ensureDataDirs();
  await writeFile(dbPath, JSON.stringify(db, null, 2));
}

function timestampForFilename() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export async function createBackup(label = "") {
  await ensureDataDirs();
  if (!existsSync(dbPath)) return null;
  const ts = timestampForFilename();
  const safeLabel = label ? `_${label.replace(/[^a-zA-Z0-9_-]/g, "")}` : "";
  const backupFile = join(backupDir, `ash-glaze${safeLabel}_${ts}.bak.json`);
  await copyFile(dbPath, backupFile);
  return backupFile;
}

export async function restoreFromBackup(backupPath) {
  if (!existsSync(backupPath)) {
    throw new Error(`Backup file not found: ${backupPath}`);
  }
  await ensureDataDirs();
  await copyFile(backupPath, dbPath);
}

export async function listBackups() {
  if (!existsSync(backupDir)) return [];
  const files = await readdir(backupDir);
  const results = [];
  for (const f of files) {
    if (!f.endsWith(".bak.json")) continue;
    const fullPath = join(backupDir, f);
    const s = await stat(fullPath);
    results.push({ file: f, path: fullPath, size: s.size, createdAt: s.birthtime || s.mtime });
  }
  results.sort((a, b) => b.createdAt - a.createdAt);
  return results;
}

export async function getLatestBackup() {
  const list = await listBackups();
  return list.length > 0 ? list[0] : null;
}

export async function deleteBackup(backupPath) {
  if (existsSync(backupPath)) {
    await unlink(backupPath);
  }
}

export async function loadDb() {
  await ensureDataDirs();
  if (!existsSync(dbPath)) {
    const seed = toNewFormat(seedLegacy);
    await writeFile(dbPath, JSON.stringify(seed, null, 2));
    return seed;
  }
  const raw = JSON.parse(await readFile(dbPath, "utf8"));
  if (!isNewFormat(raw)) {
    return raw;
  }
  if (!raw.collections) raw.collections = createEmptyCollections();
  if (!raw.migrations) raw.migrations = [];
  for (const name of KNOWN_COLLECTIONS) {
    if (!Array.isArray(raw.collections[name])) {
      raw.collections[name] = [];
    }
  }
  return raw;
}

export async function saveDb(db) {
  await ensureDataDirs();
  await writeFile(dbPath, JSON.stringify(db, null, 2));
}

export function getExistingIds(db) {
  const coll = getCollections(db);
  return new Set(coll.tiles.map(t => t.id));
}

export function insertTiles(db, tiles) {
  const coll = getCollections(db);
  const existing = getExistingIds(db);
  const inserted = [];
  const skipped = [];
  for (const t of tiles) {
    if (existing.has(t.id)) { skipped.push(t); continue; }
    if (t.status === undefined) t.status = "draft";
    if (!t.statusHistory || !Array.isArray(t.statusHistory)) t.statusHistory = [];
    if (t.batchId === undefined) t.batchId = null;
    if (t.inventoryDeducted === undefined) t.inventoryDeducted = false;
    coll.tiles.push(t);
    existing.add(t.id);
    inserted.push(t);
  }
  return { inserted, skipped };
}

export function getPlanIds(db) {
  const coll = getCollections(db);
  return new Set((coll.firingPlans || []).map(p => p.id));
}

export function insertPlan(db, plan) {
  const coll = getCollections(db);
  if (!coll.firingPlans) coll.firingPlans = [];
  coll.firingPlans.push(plan);
  return plan;
}

export function updatePlan(db, id, updates) {
  const coll = getCollections(db);
  if (!coll.firingPlans) coll.firingPlans = [];
  const idx = coll.firingPlans.findIndex(p => p.id === id);
  if (idx < 0) return null;
  coll.firingPlans[idx] = { ...coll.firingPlans[idx], ...updates };
  return coll.firingPlans[idx];
}

export function deletePlan(db, id) {
  const coll = getCollections(db);
  if (!coll.firingPlans) return false;
  const idx = coll.firingPlans.findIndex(p => p.id === id);
  if (idx < 0) return false;
  coll.firingPlans.splice(idx, 1);
  return true;
}
