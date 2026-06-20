import { saveDb } from "./db.js";
import {
  listRecipes,
  getRecipe,
  insertRecipe,
  updateRecipe,
  deleteRecipe,
  listRecipeVersions,
  getRecipeVersion,
  getLatestVersion,
  getNextVersionNumber,
  insertRecipeVersion,
  parseIngredients,
  generateRecipeId,
  generateRecipeVersionId,
  ensureRecipeCollections
} from "./recipe-repository.js";
import {
  getRecipeVersionReport,
  getSingleRecipeReport,
  getSingleVersionReport
} from "./reports.js";

export async function handleListRecipes(url, db) {
  ensureRecipeCollections(db);
  const includeStats = url.searchParams.get("includeStats") === "true";
  if (includeStats) {
    return { status: 200, data: getRecipeVersionReport(db) };
  }
  const data = listRecipes(db).map(r => {
    const latest = getLatestVersion(db, r.id);
    return {
      ...r,
      latestVersion: latest ? {
        id: latest.id,
        version: latest.version,
        text: latest.text
      } : null,
      versionCount: listRecipeVersions(db, r.id).length
    };
  });
  return { status: 200, data };
}

export async function handleCreateRecipe(input, db) {
  if (!input.name || !input.text) {
    return { status: 400, data: { error: "invalid_input", message: "name 和 text 为必填字段" } };
  }

  ensureRecipeCollections(db);
  const today = new Date().toISOString().slice(0, 10);
  const recipeId = input.id || generateRecipeId(db);
  const versionId = input.versionId || generateRecipeVersionId(db);

  const recipe = {
    id: recipeId,
    name: input.name,
    description: input.description || "",
    createdAt: today,
    updatedAt: today
  };
  insertRecipe(db, recipe);

  const version = {
    id: versionId,
    recipeId: recipeId,
    version: 1,
    text: input.text,
    ingredients: parseIngredients(input.text),
    note: input.note || "初始版本",
    createdAt: today,
    parentVersionId: null
  };
  insertRecipeVersion(db, version);

  await saveDb(db);
  return { status: 201, data: { recipe, version } };
}

export async function handleGetRecipe(id, db) {
  const recipe = getRecipe(db, id);
  if (!recipe) return { status: 404, data: { error: "recipe_not_found" } };

  const versions = listRecipeVersions(db, id);
  return {
    status: 200,
    data: {
      ...recipe,
      versions: versions,
      latestVersion: versions.length > 0 ? versions[versions.length - 1] : null
    }
  };
}

export async function handleUpdateRecipe(id, input, db) {
  const updates = {};
  if (input.name !== undefined) updates.name = input.name;
  if (input.description !== undefined) updates.description = input.description;

  if (Object.keys(updates).length === 0) {
    return { status: 400, data: { error: "invalid_input", message: "至少需要提供 name 或 description 字段" } };
  }

  const recipe = updateRecipe(db, id, updates);
  if (!recipe) return { status: 404, data: { error: "recipe_not_found" } };

  await saveDb(db);
  return { status: 200, data: recipe };
}

export async function handleDeleteRecipe(id, db) {
  const ok = deleteRecipe(db, id);
  if (!ok) return { status: 404, data: { error: "recipe_not_found" } };

  await saveDb(db);
  return { status: 200, data: { deleted: true, id } };
}

export async function handleListVersions(recipeId, db) {
  const recipe = getRecipe(db, recipeId);
  if (!recipe) return { status: 404, data: { error: "recipe_not_found" } };

  return { status: 200, data: listRecipeVersions(db, recipeId) };
}

export async function handleCreateVersion(recipeId, input, db) {
  const recipe = getRecipe(db, recipeId);
  if (!recipe) return { status: 404, data: { error: "recipe_not_found" } };

  if (!input.text && !input.fromVersionId) {
    return { status: 400, data: { error: "invalid_input", message: "需要提供 text 或 fromVersionId 字段" } };
  }

  const today = new Date().toISOString().slice(0, 10);
  let parentVersionId = null;
  let newText = input.text;
  let newIngredients = input.text ? parseIngredients(input.text) : [];

  if (input.fromVersionId) {
    const sourceVersion = getRecipeVersion(db, input.fromVersionId);
    if (!sourceVersion || sourceVersion.recipeId !== recipeId) {
      return { status: 400, data: { error: "invalid_from_version", message: "源版本不存在或不属于当前配方" } };
    }
    parentVersionId = sourceVersion.id;
    if (!newText) {
      newText = sourceVersion.text;
      newIngredients = sourceVersion.ingredients;
    }
  }

  const versionId = input.id || generateRecipeVersionId(db);
  const versionNumber = input.version || getNextVersionNumber(db, recipeId);

  const version = {
    id: versionId,
    recipeId: recipeId,
    version: versionNumber,
    text: newText,
    ingredients: newIngredients,
    note: input.note || (parentVersionId ? "基于历史版本复制" : "新版本"),
    createdAt: today,
    parentVersionId
  };
  insertRecipeVersion(db, version);

  updateRecipe(db, recipeId, { updatedAt: today });
  await saveDb(db);
  return { status: 201, data: version };
}

export async function handleGetVersion(recipeId, versionId, db) {
  const recipe = getRecipe(db, recipeId);
  if (!recipe) return { status: 404, data: { error: "recipe_not_found" } };

  const version = getRecipeVersion(db, versionId);
  if (!version || version.recipeId !== recipeId) {
    return { status: 404, data: { error: "version_not_found" } };
  }

  return { status: 200, data: version };
}

export async function handleCopyVersion(recipeId, versionId, input, db) {
  const recipe = getRecipe(db, recipeId);
  if (!recipe) return { status: 404, data: { error: "recipe_not_found" } };

  const sourceVersion = getRecipeVersion(db, versionId);
  if (!sourceVersion || sourceVersion.recipeId !== recipeId) {
    return { status: 404, data: { error: "version_not_found" } };
  }

  const today = new Date().toISOString().slice(0, 10);
  const newVersionId = input?.id || generateRecipeVersionId(db);
  const newVersionNumber = getNextVersionNumber(db, recipeId);

  const newVersion = {
    id: newVersionId,
    recipeId: recipeId,
    version: newVersionNumber,
    text: input?.text || sourceVersion.text,
    ingredients: input?.text ? parseIngredients(input.text) : sourceVersion.ingredients,
    note: input?.note || `从 v${sourceVersion.version} 复制创建`,
    createdAt: today,
    parentVersionId: sourceVersion.id
  };
  insertRecipeVersion(db, newVersion);

  updateRecipe(db, recipeId, { updatedAt: today });
  await saveDb(db);
  return { status: 201, data: newVersion };
}

export async function handleGetRecipeReport(id, db) {
  const data = getSingleRecipeReport(db, id);
  if (!data) return { status: 404, data: { error: "recipe_not_found" } };
  return { status: 200, data };
}

export async function handleGetVersionReport(recipeId, versionId, db) {
  const recipe = getRecipe(db, recipeId);
  if (!recipe) return { status: 404, data: { error: "recipe_not_found" } };

  const data = getSingleVersionReport(db, versionId);
  if (!data || data.recipeId !== recipeId) {
    return { status: 404, data: { error: "version_not_found" } };
  }
  return { status: 200, data };
}

export async function handleRecipesReportV2(db) {
  return { status: 200, data: getRecipeVersionReport(db) };
}
