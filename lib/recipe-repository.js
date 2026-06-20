export function ensureRecipeCollections(db) {
  if (!db.recipes) db.recipes = [];
  if (!db.recipeVersions) db.recipeVersions = [];
}

export function getRecipeIds(db) {
  ensureRecipeCollections(db);
  return new Set(db.recipes.map(r => r.id));
}

export function getRecipeVersionIds(db) {
  ensureRecipeCollections(db);
  return new Set(db.recipeVersions.map(v => v.id));
}

export function listRecipes(db) {
  ensureRecipeCollections(db);
  return db.recipes.slice().sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

export function getRecipe(db, id) {
  ensureRecipeCollections(db);
  return db.recipes.find(r => r.id === id) || null;
}

export function insertRecipe(db, recipe) {
  ensureRecipeCollections(db);
  db.recipes.push(recipe);
  return recipe;
}

export function updateRecipe(db, id, updates) {
  ensureRecipeCollections(db);
  const idx = db.recipes.findIndex(r => r.id === id);
  if (idx < 0) return null;
  db.recipes[idx] = { ...db.recipes[idx], ...updates, updatedAt: new Date().toISOString().slice(0, 10) };
  return db.recipes[idx];
}

export function deleteRecipe(db, id) {
  ensureRecipeCollections(db);
  const idx = db.recipes.findIndex(r => r.id === id);
  if (idx < 0) return false;
  db.recipes.splice(idx, 1);
  db.recipeVersions = db.recipeVersions.filter(v => v.recipeId !== id);
  return true;
}

export function listRecipeVersions(db, recipeId) {
  ensureRecipeCollections(db);
  return db.recipeVersions
    .filter(v => v.recipeId === recipeId)
    .sort((a, b) => a.version - b.version);
}

export function getRecipeVersion(db, versionId) {
  ensureRecipeCollections(db);
  return db.recipeVersions.find(v => v.id === versionId) || null;
}

export function getRecipeVersionByText(db, text) {
  ensureRecipeCollections(db);
  const normalized = String(text || "").trim();
  return db.recipeVersions.find(v => String(v.text || "").trim() === normalized) || null;
}

export function getLatestVersion(db, recipeId) {
  const versions = listRecipeVersions(db, recipeId);
  return versions.length > 0 ? versions[versions.length - 1] : null;
}

export function getNextVersionNumber(db, recipeId) {
  const versions = listRecipeVersions(db, recipeId);
  return versions.length > 0 ? versions[versions.length - 1].version + 1 : 1;
}

export function insertRecipeVersion(db, version) {
  ensureRecipeCollections(db);
  db.recipeVersions.push(version);
  return version;
}

export function parseIngredients(recipeText) {
  if (!recipeText || typeof recipeText !== "string") return [];
  const parts = recipeText.trim().split(/\s+/);
  const ingredients = [];
  for (const part of parts) {
    const match = part.match(/^([^\d]+?)(\d+(?:\.\d+)?)$/);
    if (match) {
      ingredients.push({
        name: match[1].trim(),
        percentage: Number(match[2])
      });
    }
  }
  return ingredients;
}

export function generateRecipeId(db) {
  ensureRecipeCollections(db);
  let counter = db.recipes.length + 1;
  let id;
  const existing = getRecipeIds(db);
  do {
    id = `RC-${String(counter).padStart(3, "0")}`;
    counter++;
  } while (existing.has(id));
  return id;
}

export function generateRecipeVersionId(db) {
  ensureRecipeCollections(db);
  let counter = db.recipeVersions.length + 1;
  let id;
  const existing = getRecipeVersionIds(db);
  do {
    id = `RCV-${String(counter).padStart(4, "0")}`;
    counter++;
  } while (existing.has(id));
  return id;
}
