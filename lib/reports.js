import {
  ensureRecipeCollections,
  listRecipes,
  listRecipeVersions,
  getRecipe,
  getRecipeVersion
} from "./recipe-repository.js";
import { ensureInventoryCollection } from "./inventory-repository.js";

export function buildTilesByVersionIndex(db) {
  const index = {};
  if (!db.tiles) return index;
  for (const tile of db.tiles) {
    const key = tile.recipeVersionId || tile.recipe || "__unassigned__";
    index[key] ||= [];
    index[key].push(tile);
  }
  return index;
}

function summarizeTiles(tiles) {
  if (!tiles || tiles.length === 0) {
    return {
      count: 0,
      totalScore: 0,
      averageScore: 0,
      maxScore: 0,
      minScore: 0,
      ashSources: [],
      bodies: []
    };
  }
  const scores = tiles.map(t => Number(t.score || 0)).filter(s => s > 0);
  const ashSources = [...new Set(tiles.map(t => t.ashSource).filter(Boolean))];
  const bodies = [...new Set(tiles.map(t => t.body).filter(Boolean))];
  const totalScore = scores.reduce((a, b) => a + b, 0);
  return {
    count: tiles.length,
    totalScore,
    averageScore: scores.length > 0 ? Number((totalScore / scores.length).toFixed(1)) : 0,
    maxScore: scores.length > 0 ? Math.max(...scores) : 0,
    minScore: scores.length > 0 ? Math.min(...scores) : 0,
    ashSources,
    bodies
  };
}

export function getRecipeVersionReport(db) {
  ensureRecipeCollections(db);
  const tilesByVersion = buildTilesByVersionIndex(db);
  const recipes = listRecipes(db);

  return recipes.map(recipe => {
    const versions = listRecipeVersions(db, recipe.id);
    const versionStats = versions.map(version => {
      const tiles = tilesByVersion[version.id] || [];
      return {
        versionId: version.id,
        version: version.version,
        text: version.text,
        note: version.note,
        createdAt: version.createdAt,
        ...summarizeTiles(tiles)
      };
    });

    const allTilesForRecipe = versions.flatMap(v => tilesByVersion[v.id] || []);
    return {
      recipeId: recipe.id,
      recipeName: recipe.name,
      description: recipe.description,
      createdAt: recipe.createdAt,
      updatedAt: recipe.updatedAt,
      versionCount: versions.length,
      latestVersion: versions.length > 0 ? versions[versions.length - 1].version : 0,
      ...summarizeTiles(allTilesForRecipe),
      versions: versionStats
    };
  });
}

export function getSingleRecipeReport(db, recipeId) {
  ensureRecipeCollections(db);
  const recipe = getRecipe(db, recipeId);
  if (!recipe) return null;

  const tilesByVersion = buildTilesByVersionIndex(db);
  const versions = listRecipeVersions(db, recipeId);

  const versionStats = versions.map(version => {
    const tiles = tilesByVersion[version.id] || [];
    return {
      versionId: version.id,
      version: version.version,
      text: version.text,
      note: version.note,
      createdAt: version.createdAt,
      ...summarizeTiles(tiles)
    };
  });

  const allTiles = versions.flatMap(v => tilesByVersion[v.id] || []);
  return {
    recipeId: recipe.id,
    recipeName: recipe.name,
    description: recipe.description,
    createdAt: recipe.createdAt,
    updatedAt: recipe.updatedAt,
    versionCount: versions.length,
    latestVersion: versions.length > 0 ? versions[versions.length - 1].version : 0,
    ...summarizeTiles(allTiles),
    versions: versionStats
  };
}

export function getSingleVersionReport(db, versionId) {
  ensureRecipeCollections(db);
  ensureInventoryCollection(db);
  const version = getRecipeVersion(db, versionId);
  if (!version) return null;

  const recipe = getRecipe(db, version.recipeId);
  const tilesByVersion = buildTilesByVersionIndex(db);
  const tiles = tilesByVersion[versionId] || [];

  const materialBatchUsage = {};
  for (const tile of tiles) {
    if (Array.isArray(tile.materialBatchRefs)) {
      for (const ref of tile.materialBatchRefs) {
        const key = ref.batchNo;
        if (!materialBatchUsage[key]) {
          materialBatchUsage[key] = { batchNo: ref.batchNo, ingredientName: ref.ingredientName, tileIds: [], totalDeducted: 0, unit: ref.unit || "" };
        }
        materialBatchUsage[key].tileIds.push(tile.id);
        materialBatchUsage[key].totalDeducted = Number((materialBatchUsage[key].totalDeducted + (ref.deducted || 0)).toFixed(2));
      }
    }
  }

  return {
    recipeId: version.recipeId,
    recipeName: recipe ? recipe.name : null,
    versionId: version.id,
    version: version.version,
    text: version.text,
    note: version.note,
    ingredients: version.ingredients,
    createdAt: version.createdAt,
    parentVersionId: version.parentVersionId,
    ...summarizeTiles(tiles),
    materialBatchUsage: Object.values(materialBatchUsage),
    tiles: tiles.map(t => ({
      id: t.id,
      body: t.body,
      ashSource: t.ashSource,
      peakTemp: t.peakTemp,
      color: t.color,
      defects: t.defects,
      score: t.score,
      batchWeight: t.batchWeight || null,
      materialBatchRefs: t.materialBatchRefs || []
    }))
  };
}
