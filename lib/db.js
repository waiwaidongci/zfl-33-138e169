import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(__dirname);
const dbPath = join(projectRoot, "data", "ash-glaze.json");

const seed = {
  tiles: [
    {
      id: "AG-001",
      body: "粗陶坯",
      recipe: "松灰42 长石35 石英18 红土5",
      ashSource: "南山松灰",
      glazeThickness: "0.8mm",
      kiln: "K-2",
      firingCurve: [{ temp: 900, minutes: 60 }, { temp: 1240, minutes: 35 }],
      peakTemp: 1240,
      color: "青灰带油滴",
      defects: "边缘流釉",
      score: 82,
      observations: [{ at: "2026-06-10", note: "还原气氛后半段偏强" }]
    }
  ],
  firingPlans: []
};

export async function loadDb() {
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    await writeFile(dbPath, JSON.stringify(seed, null, 2));
  }
  return JSON.parse(await readFile(dbPath, "utf8"));
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
