import { saveDb } from "./db.js";
import {
  getDefectCatalog,
  validateDefectTags,
  validateDefectTag,
  normalizeDefectName,
  normalizeSeverity,
  SEVERITY_LABELS
} from "./defect-validate.js";
import {
  getOverallStats,
  groupByKiln,
  groupByAshSource,
  getHighFrequencyDefects,
  collectAllTileDefects,
  countByDefectName,
  countBySeverity
} from "./defect-statistics.js";
import { runDefectMigration, needsDefectMigration } from "./defect-migration.js";

export function handleGetDefectCatalog() {
  return {
    status: 200,
    data: {
      defects: getDefectCatalog(),
      severityLevels: SEVERITY_LABELS
    }
  };
}

export async function handleGetOverallDefectStats(db) {
  return { status: 200, data: getOverallStats(db) };
}

export async function handleGetDefectStatsByKiln(url, db) {
  if (!db || !db.tiles) {
    return { status: 200, data: [] };
  }
  const kiln = url.searchParams.get("kiln");
  let tiles = db.tiles;
  if (kiln) {
    tiles = tiles.filter(t => t.kiln === kiln);
  }
  return { status: 200, data: groupByKiln(tiles) };
}

export async function handleGetDefectStatsByAshSource(url, db) {
  if (!db || !db.tiles) {
    return { status: 200, data: [] };
  }
  const ashSource = url.searchParams.get("ashSource");
  let tiles = db.tiles;
  if (ashSource) {
    tiles = tiles.filter(t => (t.ashSource || "").includes(ashSource));
  }
  return { status: 200, data: groupByAshSource(tiles) };
}

export async function handleGetTileDefectTags(tileId, db) {
  if (!db || !db.tiles) {
    return { status: 404, data: { error: "tile_not_found" } };
  }
  const tile = db.tiles.find(t => t.id === tileId);
  if (!tile) return { status: 404, data: { error: "tile_not_found" } };
  return {
    status: 200,
    data: {
      tileId: tile.id,
      defects: tile.defects || "",
      defectTags: tile.defectTags || []
    }
  };
}

export async function handleUpdateTileDefectTags(tileId, input, db) {
  if (!db || !db.tiles) {
    return { status: 404, data: { error: "tile_not_found" } };
  }
  const tile = db.tiles.find(t => t.id === tileId);
  if (!tile) return { status: 404, data: { error: "tile_not_found" } };

  const result = validateDefectTags(input.defectTags);
  if (!result.valid) {
    return { status: 400, data: { error: "invalid_defect_tags", errors: result.errors } };
  }

  tile.defectTags = result.normalized;

  if (input.defects !== undefined) {
    tile.defects = String(input.defects || "");
  } else if (result.normalized.length > 0 && !tile.defects) {
    tile.defects = result.normalized.map(t =>
      t.severity === "mild" ? `轻微${t.name}` :
      t.severity === "severe" ? `严重${t.name}` : t.name
    ).join("、");
  }

  await saveDb(db);
  return {
    status: 200,
    data: {
      tileId: tile.id,
      defects: tile.defects || "",
      defectTags: tile.defectTags
    }
  };
}

export async function handleAddDefectTag(tileId, input, db) {
  if (!db || !db.tiles) {
    return { status: 404, data: { error: "tile_not_found" } };
  }
  const tile = db.tiles.find(t => t.id === tileId);
  if (!tile) return { status: 404, data: { error: "tile_not_found" } };

  const result = validateDefectTag(input);
  if (!result.valid) {
    return { status: 400, data: { error: "invalid_defect_tag", errors: result.errors } };
  }

  if (!tile.defectTags) tile.defectTags = [];

  const normalizedName = normalizeDefectName(input.name);
  const existing = tile.defectTags.findIndex(t => t.name === normalizedName);
  if (existing >= 0) {
    tile.defectTags[existing] = {
      name: normalizedName,
      severity: normalizeSeverity(input.severity),
      note: input.note || tile.defectTags[existing].note || ""
    };
  } else {
    tile.defectTags.push({
      name: normalizedName,
      severity: normalizeSeverity(input.severity),
      note: input.note || ""
    });
  }

  if (!tile.defects) {
    tile.defects = tile.defectTags.map(t =>
      t.severity === "mild" ? `轻微${t.name}` :
      t.severity === "severe" ? `严重${t.name}` : t.name
    ).join("、");
  }

  await saveDb(db);
  return {
    status: 200,
    data: {
      tileId: tile.id,
      defects: tile.defects || "",
      defectTags: tile.defectTags
    }
  };
}

export async function handleRemoveDefectTag(tileId, input, db) {
  if (!db || !db.tiles) {
    return { status: 404, data: { error: "tile_not_found" } };
  }
  const tile = db.tiles.find(t => t.id === tileId);
  if (!tile) return { status: 404, data: { error: "tile_not_found" } };

  if (!tile.defectTags || tile.defectTags.length === 0) {
    return { status: 200, data: { tileId: tile.id, defectTags: [], defects: tile.defects || "" } };
  }

  const nameToRemove = normalizeDefectName(input.name);
  if (!nameToRemove) {
    return { status: 400, data: { error: "invalid_defect_name", message: `无法识别的缺陷类型: ${input.name}` } };
  }

  tile.defectTags = tile.defectTags.filter(t => t.name !== nameToRemove);

  await saveDb(db);
  return {
    status: 200,
    data: {
      tileId: tile.id,
      defects: tile.defects || "",
      defectTags: tile.defectTags
    }
  };
}

export async function handleRunDefectMigration(db) {
  const needed = needsDefectMigration(db);
  const stats = runDefectMigration(db);
  if (stats.migrated) {
    await saveDb(db);
  }
  return {
    status: 200,
    data: {
      migrationNeeded: needed,
      ...stats
    }
  };
}

export async function handleQueryTilesByDefect(url, db) {
  if (!db || !db.tiles) {
    return { status: 200, data: [] };
  }
  const defectName = url.searchParams.get("name");
  const severity = url.searchParams.get("severity");
  const kiln = url.searchParams.get("kiln");
  const ashSource = url.searchParams.get("ashSource");

  let tiles = db.tiles;
  if (defectName) {
    const normalized = normalizeDefectName(defectName);
    if (normalized) {
      tiles = tiles.filter(t =>
        (t.defectTags || []).some(tag => tag.name === normalized)
      );
    }
  }
  if (severity) {
    const s = normalizeSeverity(severity);
    tiles = tiles.filter(t =>
      (t.defectTags || []).some(tag => tag.severity === s)
    );
  }
  if (kiln) {
    tiles = tiles.filter(t => t.kiln === kiln);
  }
  if (ashSource) {
    tiles = tiles.filter(t => (t.ashSource || "").includes(ashSource));
  }

  return {
    status: 200,
    data: tiles.map(t => ({
      id: t.id,
      body: t.body,
      recipe: t.recipe,
      recipeVersionId: t.recipeVersionId,
      ashSource: t.ashSource,
      kiln: t.kiln,
      peakTemp: t.peakTemp,
      color: t.color,
      defects: t.defects,
      defectTags: t.defectTags || [],
      score: t.score
    }))
  };
}

export async function handleGetHighFrequencyDefects(url, db) {
  if (!db || !db.tiles) {
    return { status: 200, data: [] };
  }
  const topN = Math.max(1, Math.min(20, Number(url.searchParams.get("topN") || 5)));
  const kiln = url.searchParams.get("kiln");
  const ashSource = url.searchParams.get("ashSource");

  let tiles = db.tiles;
  if (kiln) tiles = tiles.filter(t => t.kiln === kiln);
  if (ashSource) tiles = tiles.filter(t => (t.ashSource || "").includes(ashSource));

  return {
    status: 200,
    data: {
      topN,
      scope: { kiln: kiln || null, ashSource: ashSource || null },
      tileCount: tiles.length,
      defects: getHighFrequencyDefects(tiles, topN)
    }
  };
}
