import { saveDb } from "./db.js";
import {
  ensureRecipeCollections,
  getRecipeVersionByText,
  insertRecipe,
  insertRecipeVersion,
  generateRecipeId,
  generateRecipeVersionId,
  parseIngredients
} from "./recipe-repository.js";

export function needsMigration(db) {
  ensureRecipeCollections(db);
  if (!db.tiles) return false;
  const hasUnmigratedTiles = db.tiles.some(t => !t.recipeVersionId && t.recipe);
  return hasUnmigratedTiles || (db.recipes.length === 0 && db.tiles.length > 0);
}

function deduceRecipeName(recipeText, tile) {
  if (tile.ashSource) {
    return `${tile.ashSource}配方`;
  }
  const ingredients = parseIngredients(recipeText);
  if (ingredients.length > 0) {
    const top = ingredients.slice(0, 2).map(i => i.name).join("+");
    return `${top}配方`;
  }
  return "未命名配方";
}

export function runMigration(db) {
  ensureRecipeCollections(db);
  if (!db.tiles || db.tiles.length === 0) {
    return { migrated: false, recipeCount: 0, versionCount: 0, tileCount: 0 };
  }

  const stats = { migrated: false, recipeCount: 0, versionCount: 0, tileCount: 0 };
  const today = new Date().toISOString().slice(0, 10);

  for (const tile of db.tiles) {
    if (!tile.recipe) continue;

    let version = getRecipeVersionByText(db, tile.recipe);

    if (!version) {
      const recipeId = generateRecipeId(db);
      const recipe = {
        id: recipeId,
        name: deduceRecipeName(tile.recipe, tile),
        description: "从历史试片数据自动迁移生成",
        createdAt: today,
        updatedAt: today,
        migratedFromTiles: true
      };
      insertRecipe(db, recipe);
      stats.recipeCount++;

      const versionId = generateRecipeVersionId(db);
      version = {
        id: versionId,
        recipeId: recipeId,
        version: 1,
        text: tile.recipe,
        ingredients: parseIngredients(tile.recipe),
        note: "初始版本，从历史试片数据迁移生成",
        createdAt: today,
        parentVersionId: null
      };
      insertRecipeVersion(db, version);
      stats.versionCount++;
    }

    if (!tile.recipeVersionId) {
      tile.recipeVersionId = version.id;
      stats.tileCount++;
    }
  }

  stats.migrated = stats.tileCount > 0 || stats.recipeCount > 0;
  return stats;
}

export async function migrateIfNeeded(db) {
  if (needsMigration(db)) {
    const stats = runMigration(db);
    if (stats.migrated) {
      await saveDb(db);
    }
    return stats;
  }
  return { migrated: false, recipeCount: 0, versionCount: 0, tileCount: 0 };
}
