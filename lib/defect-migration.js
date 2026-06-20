import { saveDb } from "./db.js";
import { tryParseDefectText } from "./defect-validate.js";

export function needsDefectMigration(db) {
  if (!db || !db.tiles) return false;
  return db.tiles.some(t => t.defectTags === undefined);
}

export function runDefectMigration(db) {
  const stats = {
    migrated: false,
    tilesChecked: 0,
    tilesInitialized: 0,
    tilesMigrated: 0,
    tagsCreated: 0,
    tilesWithDefects: 0,
    tilesWithNoDefects: 0
  };

  if (!db || !db.tiles || db.tiles.length === 0) {
    return stats;
  }

  for (const tile of db.tiles) {
    stats.tilesChecked++;

    if (tile.defectTags === undefined) {
      tile.defectTags = [];
      stats.tilesInitialized++;
    }

    if (tile.defects && tile.defects.trim() !== "") {
      stats.tilesWithDefects++;
      if (tile.defectTags.length === 0) {
        const parsedTags = tryParseDefectText(tile.defects);
        if (parsedTags.length > 0) {
          tile.defectTags = parsedTags;
          stats.tagsCreated += parsedTags.length;
          stats.tilesMigrated++;
        }
      }
    } else {
      stats.tilesWithNoDefects++;
    }
  }

  stats.migrated = stats.tilesInitialized > 0 || stats.tilesMigrated > 0;
  return stats;
}

export async function migrateDefectsIfNeeded(db) {
  if (needsDefectMigration(db)) {
    const stats = runDefectMigration(db);
    if (stats.migrated) {
      await saveDb(db);
    }
    return stats;
  }
  return {
    migrated: false,
    tilesChecked: 0,
    tilesInitialized: 0,
    tilesMigrated: 0,
    tagsCreated: 0,
    tilesWithDefects: 0,
    tilesWithNoDefects: 0
  };
}
