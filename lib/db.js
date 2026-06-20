import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrateIfNeeded } from "./migration.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(__dirname);
const dbPath = join(projectRoot, "data", "ash-glaze.json");

const seed = {
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

export async function loadDb() {
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    await writeFile(dbPath, JSON.stringify(seed, null, 2));
  }
  const db = JSON.parse(await readFile(dbPath, "utf8"));
  if (!db.firingPlans) db.firingPlans = [];
  if (!db.recipes) db.recipes = [];
  if (!db.recipeVersions) db.recipeVersions = [];
  if (!db.batches) db.batches = [];
  if (!db.materialStocks) db.materialStocks = [];
  await migrateIfNeeded(db);
  return db;
}

export async function saveDb(db) {
  await writeFile(dbPath, JSON.stringify(db, null, 2));
}

export function getExistingIds(db) {
  return new Set(db.tiles.map(t => t.id));
}

export function insertTiles(db, tiles) {
  const existing = getExistingIds(db);
  const inserted = [];
  const skipped = [];
  for (const t of tiles) {
    if (existing.has(t.id)) { skipped.push(t); continue; }
    db.tiles.push(t);
    existing.add(t.id);
    inserted.push(t);
  }
  return { inserted, skipped };
}

export function getPlanIds(db) {
  return new Set((db.firingPlans || []).map(p => p.id));
}

export function insertPlan(db, plan) {
  if (!db.firingPlans) db.firingPlans = [];
  db.firingPlans.push(plan);
  return plan;
}

export function updatePlan(db, id, updates) {
  const idx = (db.firingPlans || []).findIndex(p => p.id === id);
  if (idx < 0) return null;
  db.firingPlans[idx] = { ...db.firingPlans[idx], ...updates };
  return db.firingPlans[idx];
}

export function deletePlan(db, id) {
  if (!db.firingPlans) return false;
  const idx = db.firingPlans.findIndex(p => p.id === id);
  if (idx < 0) return false;
  db.firingPlans.splice(idx, 1);
  return true;
}
