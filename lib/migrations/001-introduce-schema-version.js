export const version = 1;
export const name = "introduce-schema-version";
export const description = "将单一 JSON 数据文件迁移为带 schemaVersion 的多集合数据格式，引入 collections 和 migrations 元数据字段";

export function up(db) {
  const { toNewFormat, getCollections } = db._helpers;
  const coll = getCollections(db);

  const tiles = Array.isArray(coll.tiles) ? coll.tiles : [];
  const firingPlans = Array.isArray(coll.firingPlans) ? coll.firingPlans : [];
  const recipes = Array.isArray(coll.recipes) ? coll.recipes : [];
  const recipeVersions = Array.isArray(coll.recipeVersions) ? coll.recipeVersions : [];
  const batches = Array.isArray(coll.batches) ? coll.batches : [];
  const materialStocks = Array.isArray(coll.materialStocks) ? coll.materialStocks : [];

  const legacy = {
    tiles,
    firingPlans,
    recipes,
    recipeVersions,
    batches,
    materialStocks
  };

  const result = toNewFormat(legacy);

  return {
    migrated: true,
    fromLegacy: !db._helpers.isNewFormat(db),
    collectionsCount: {
      tiles: result.collections.tiles.length,
      firingPlans: result.collections.firingPlans.length,
      recipes: result.collections.recipes.length,
      recipeVersions: result.collections.recipeVersions.length,
      batches: result.collections.batches.length,
      materialStocks: result.collections.materialStocks.length
    },
    result
  };
}

export function down(db) {
  const { toLegacyFormat, getCollections } = db._helpers;
  const result = toLegacyFormat(db);
  return {
    rolledBack: true,
    collectionsCount: {
      tiles: Array.isArray(result.tiles) ? result.tiles.length : 0,
      firingPlans: Array.isArray(result.firingPlans) ? result.firingPlans.length : 0,
      recipes: Array.isArray(result.recipes) ? result.recipes.length : 0,
      recipeVersions: Array.isArray(result.recipeVersions) ? result.recipeVersions.length : 0,
      batches: Array.isArray(result.batches) ? result.batches.length : 0,
      materialStocks: Array.isArray(result.materialStocks) ? result.materialStocks.length : 0
    },
    result
  };
}

export function validate(db) {
  const { getCollections, getSchemaVersion } = db._helpers;
  const errors = [];

  if (getSchemaVersion(db) !== 1) {
    errors.push("schemaVersion must be 1");
  }

  const coll = getCollections(db);
  const required = ["tiles", "firingPlans", "recipes", "recipeVersions", "batches", "materialStocks"];
  for (const key of required) {
    if (!Array.isArray(coll[key])) {
      errors.push(`collection '${key}' must be an array`);
    }
  }

  return { valid: errors.length === 0, errors };
}
