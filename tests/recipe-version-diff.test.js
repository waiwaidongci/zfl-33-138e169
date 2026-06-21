import { mkdir, writeFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(__dirname);
const testDir = join(projectRoot, "tests", "tmp-recipe-diff");
const testDataDir = join(testDir, "data");
const testDbPath = join(testDataDir, "ash-glaze.json");
const testBackupDir = join(testDataDir, "backups");

process.env.ASH_GLAZE_DATA_DIR = testDataDir;
process.env.ASH_GLAZE_DB_PATH = testDbPath;
process.env.ASH_GLAZE_BACKUP_DIR = testBackupDir;

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    failures.push(msg);
    console.log(`  ✗ ${msg}`);
  }
}

function assertEq(actual, expected, msg) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    failures.push(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    console.log(`  ✗ ${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertApprox(actual, expected, msg, eps = 0.01) {
  const ok = Math.abs(actual - expected) <= eps;
  if (ok) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    failures.push(`${msg}: expected ~${expected}, got ${actual}`);
    console.log(`  ✗ ${msg}: expected ~${expected}, got ${actual}`);
  }
}

function makeDb(tiles, recipes, recipeVersions) {
  return {
    schemaVersion: 2,
    collections: {
      tiles: tiles || [],
      firingPlans: [],
      recipes: recipes || [],
      recipeVersions: recipeVersions || [],
      batches: [],
      materialStocks: []
    }
  };
}

async function setupTestEnv() {
  await rm(testDir, { recursive: true, force: true });
  await mkdir(testBackupDir, { recursive: true });
}

async function cleanupTestEnv() {
  await rm(testDir, { recursive: true, force: true });
}

const sampleRecipes = [
  {
    id: "RC-001",
    name: "南山松灰配方",
    description: "基础松灰釉配方",
    createdAt: "2026-06-20",
    updatedAt: "2026-06-20"
  },
  {
    id: "RC-002",
    name: "东北稻灰配方",
    description: "稻灰釉配方",
    createdAt: "2026-06-20",
    updatedAt: "2026-06-20"
  }
];

const sampleRecipeVersions = [
  {
    id: "RCV-0001",
    recipeId: "RC-001",
    version: 1,
    text: "松灰42 长石35 石英18 红土5",
    ingredients: [
      { name: "松灰", percentage: 42 },
      { name: "长石", percentage: 35 },
      { name: "石英", percentage: 18 },
      { name: "红土", percentage: 5 }
    ],
    note: "初始版本",
    createdAt: "2026-06-20",
    parentVersionId: null
  },
  {
    id: "RCV-0002",
    recipeId: "RC-001",
    version: 2,
    text: "松灰45 长石30 石英20 高岭5",
    ingredients: [
      { name: "松灰", percentage: 45 },
      { name: "长石", percentage: 30 },
      { name: "石英", percentage: 20 },
      { name: "高岭", percentage: 5 }
    ],
    note: "调整比例，用高岭替换红土",
    createdAt: "2026-06-21",
    parentVersionId: "RCV-0001"
  },
  {
    id: "RCV-0003",
    recipeId: "RC-001",
    version: 3,
    text: "松灰42 长石35 石英18 红土5",
    ingredients: [
      { name: "松灰", percentage: 42 },
      { name: "长石", percentage: 35 },
      { name: "石英", percentage: 18 },
      { name: "红土", percentage: 5 }
    ],
    note: "回滚到初始配方",
    createdAt: "2026-06-22",
    parentVersionId: "RCV-0002"
  },
  {
    id: "RCV-0004",
    recipeId: "RC-002",
    version: 1,
    text: "稻灰50 长石30 石英15 高岭5",
    ingredients: [
      { name: "稻灰", percentage: 50 },
      { name: "长石", percentage: 30 },
      { name: "石英", percentage: 15 },
      { name: "高岭", percentage: 5 }
    ],
    note: "稻灰配方初始版本",
    createdAt: "2026-06-20",
    parentVersionId: null
  }
];

const sampleTilesWithScores = [
  {
    id: "AG-001",
    body: "粗陶坯",
    recipe: "松灰42 长石35 石英18 红土5",
    ashSource: "南山松灰",
    kiln: "K-2",
    peakTemp: 1240,
    color: "青灰带油滴",
    score: 82,
    defects: "边缘流釉",
    recipeVersionId: "RCV-0001",
    defectTags: [{ name: "流釉", severity: "mild" }]
  },
  {
    id: "AG-002",
    body: "粗陶坯",
    recipe: "松灰42 长石35 石英18 红土5",
    ashSource: "南山松灰",
    kiln: "K-2",
    peakTemp: 1240,
    color: "青灰",
    score: 78,
    defects: "针孔",
    recipeVersionId: "RCV-0001",
    defectTags: [{ name: "针孔", severity: "medium" }]
  },
  {
    id: "AG-003",
    body: "细瓷坯",
    recipe: "松灰42 长石35 石英18 红土5",
    ashSource: "南山松灰",
    kiln: "K-2",
    peakTemp: 1240,
    color: "月白",
    score: 55,
    defects: "严重开裂 针孔密集",
    recipeVersionId: "RCV-0001",
    defectTags: [
      { name: "开裂", severity: "severe" },
      { name: "针孔", severity: "severe" }
    ]
  },
  {
    id: "AG-004",
    body: "粗陶坯",
    recipe: "松灰45 长石30 石英20 高岭5",
    ashSource: "南山松灰",
    kiln: "K-2",
    peakTemp: 1250,
    color: "乳白",
    score: 88,
    defects: "",
    recipeVersionId: "RCV-0002",
    defectTags: []
  },
  {
    id: "AG-005",
    body: "细瓷坯",
    recipe: "松灰45 长石30 石英20 高岭5",
    ashSource: "南山松灰",
    kiln: "K-2",
    peakTemp: 1255,
    color: "青白",
    score: 90,
    defects: "轻微气泡",
    recipeVersionId: "RCV-0002",
    defectTags: [{ name: "气泡", severity: "mild" }]
  },
  {
    id: "AG-006",
    body: "粗陶坯",
    recipe: "松灰45 长石30 石英20 高岭5",
    ashSource: "南山松灰",
    kiln: "K-2",
    peakTemp: 1250,
    color: "灰白",
    score: 70,
    defects: "针孔",
    recipeVersionId: "RCV-0002",
    defectTags: [{ name: "针孔", severity: "medium" }]
  }
];

const sampleTilesNoDataForV3 = [
  ...sampleTilesWithScores
];

const sampleTilesOneSided = [
  {
    id: "AG-001",
    body: "粗陶坯",
    recipe: "松灰42 长石35 石英18 红土5",
    ashSource: "南山松灰",
    kiln: "K-2",
    peakTemp: 1240,
    color: "青灰",
    score: 82,
    recipeVersionId: "RCV-0001",
    defectTags: []
  },
  {
    id: "AG-002",
    body: "粗陶坯",
    recipe: "松灰42 长石35 石英18 红土5",
    ashSource: "南山松灰",
    kiln: "K-2",
    peakTemp: 1240,
    color: "灰青",
    score: 78,
    recipeVersionId: "RCV-0001",
    defectTags: []
  }
];

async function test1_ingredientDiff() {
  console.log("\nTest 1: 原料成分差异 - 新增/移除/调整比例");

  const { diffIngredients, buildIngredientsSummary } = await import("../lib/recipe-repository.js");

  const v1Ingredients = [
    { name: "松灰", percentage: 42 },
    { name: "长石", percentage: 35 },
    { name: "石英", percentage: 18 },
    { name: "红土", percentage: 5 }
  ];

  const v2Ingredients = [
    { name: "松灰", percentage: 45 },
    { name: "长石", percentage: 30 },
    { name: "石英", percentage: 20 },
    { name: "高岭", percentage: 5 }
  ];

  const diff = diffIngredients(v1Ingredients, v2Ingredients);

  assertEq(diff.added.length, 1, "新增 1 种原料");
  assertEq(diff.added[0].name, "高岭", "新增原料为高岭");
  assertEq(diff.added[0].percentage, 5, "新增原料比例 5%");

  assertEq(diff.removed.length, 1, "移除 1 种原料");
  assertEq(diff.removed[0].name, "红土", "移除原料为红土");

  assertEq(diff.modified.length, 3, "调整 3 种原料比例");

  const songhui = diff.modified.find(i => i.name === "松灰");
  assert(songhui, "松灰比例已调整");
  assertEq(songhui.from, 42, "松灰原比例 42%");
  assertEq(songhui.to, 45, "松灰新比例 45%");
  assertEq(songhui.delta, 3, "松灰比例 +3%");
  assertApprox(songhui.deltaPct, 7.14, "松灰比例变化 +7.14%");

  const changshi = diff.modified.find(i => i.name === "长石");
  assert(changshi, "长石比例已调整");
  assertEq(changshi.delta, -5, "长石比例 -5%");

  const shiying = diff.modified.find(i => i.name === "石英");
  assert(shiying, "石英比例已调整");
  assertEq(shiying.delta, 2, "石英比例 +2%");

  const summary = buildIngredientsSummary(diff);
  assert(summary.length >= 3, "摘要至少 3 条");
  assert(summary.some(s => s.includes("新增原料 1 种")), "摘要包含新增原料");
  assert(summary.some(s => s.includes("移除原料 1 种")), "摘要包含移除原料");
  assert(summary.some(s => s.includes("调整比例 3 种")), "摘要包含调整比例");
}

async function test2_ingredientUnchanged() {
  console.log("\nTest 2: 原料成分无变化 - 相同配方");

  const { diffIngredients, buildIngredientsSummary } = await import("../lib/recipe-repository.js");

  const ingredients = [
    { name: "松灰", percentage: 42 },
    { name: "长石", percentage: 35 }
  ];

  const diff = diffIngredients(ingredients, ingredients);

  assertEq(diff.added.length, 0, "无新增原料");
  assertEq(diff.removed.length, 0, "无移除原料");
  assertEq(diff.modified.length, 0, "无调整比例");
  assertEq(diff.unchanged.length, 2, "2 种原料未变化");

  const summary = buildIngredientsSummary(diff);
  assertEq(summary.length, 1, "摘要 1 条");
  assert(summary[0].includes("原料成分无变化"), "摘要显示无变化");
}

async function test3_fullDiffWithTiles() {
  console.log("\nTest 3: 完整版本差异 - 带试片数据");

  const { getRecipeVersionDiff } = await import("../lib/reports.js");
  const db = makeDb(sampleTilesWithScores, sampleRecipes, sampleRecipeVersions);

  const result = getRecipeVersionDiff(db, "RCV-0001", "RCV-0002");

  assert(!result.error, "没有错误");
  assert(result.meta, "有 meta 信息");
  assertEq(result.meta.recipe.id, "RC-001", "配方 id 正确");
  assertEq(result.meta.baseline.versionId, "RCV-0001", "baseline 版本正确");
  assertEq(result.meta.target.versionId, "RCV-0002", "target 版本正确");

  assert(result.ingredients.diff, "有原料差异");
  assertEq(result.ingredients.diff.added.length, 1, "原料新增 1 种");

  assert(result.tilePerformance.diff, "有试片表现差异");
  assertEq(result.tilePerformance.diff.tileCount.baseline, 3, "baseline 3 片");
  assertEq(result.tilePerformance.diff.tileCount.target, 3, "target 3 片");

  const avgBaseline = Number(((82 + 78 + 55) / 3).toFixed(1));
  const avgTarget = Number(((88 + 90 + 70) / 3).toFixed(1));
  assertApprox(result.tilePerformance.baseline.averageScore, avgBaseline, "baseline 平均分正确");
  assertApprox(result.tilePerformance.target.averageScore, avgTarget, "target 平均分正确");
  assertApprox(result.tilePerformance.diff.averageScore.delta, Number((avgTarget - avgBaseline).toFixed(2)), "平均分 delta 正确");

  assert(result.defects.diff, "有缺陷差异");
  assert(result.defects.diff.topDefectsDelta.length > 0, "有缺陷差异明细");

  assert(result.summary, "有人可读摘要");
  assert(result.summary.ingredients.length > 0, "有原料摘要");
  assert(result.summary.performance.length > 0, "有试片表现摘要");
  assert(result.summary.defects.length > 0, "有缺陷摘要");
  assert(result.summary.overallDirection, "有整体方向判断");
  assert(["improved", "declined", "stable"].includes(result.summary.overallDirection.scoreTrend), "scoreTrend 合法");
  assert(result.summary.overallDirection.recommendation.length > 0, "有建议");

  assert(result.tiles.baseline.length === 3, "baseline 试片列表 3 条");
  assert(result.tiles.target.length === 3, "target 试片列表 3 条");
}

async function test4_missingVersions() {
  console.log("\nTest 4: 缺失版本 - baseline 或 target 不存在");

  const { getRecipeVersionDiff } = await import("../lib/reports.js");
  const db = makeDb([], sampleRecipes, sampleRecipeVersions);

  const result1 = getRecipeVersionDiff(db, "RCV-9999", "RCV-0001");
  assertEq(result1.error, "versions_not_found", "错误码正确");
  assert(result1.missingVersions.includes("RCV-9999"), "missingVersions 包含不存在的版本");

  const result2 = getRecipeVersionDiff(db, "RCV-0001", "RCV-9999");
  assertEq(result2.error, "versions_not_found", "错误码正确");
  assert(result2.missingVersions.includes("RCV-9999"), "missingVersions 包含不存在的版本");

  const result3 = getRecipeVersionDiff(db, "RCV-9998", "RCV-9999");
  assertEq(result3.error, "versions_not_found", "两个都不存在时报错");
  assertEq(result3.missingVersions.length, 2, "两个版本都在 missingVersions 中");
}

async function test5_crossRecipeDiff() {
  console.log("\nTest 5: 跨配方版本对比 - 应该拒绝");

  const { getRecipeVersionDiff } = await import("../lib/reports.js");
  const db = makeDb([], sampleRecipes, sampleRecipeVersions);

  const result = getRecipeVersionDiff(db, "RCV-0001", "RCV-0004");
  assertEq(result.error, "cross_recipe_diff_not_allowed", "错误码正确");
  assertEq(result.recipeIdA, "RC-001", "返回配方A id");
  assertEq(result.recipeIdB, "RC-002", "返回配方B id");
  assert(result.message.includes("同一配方"), "错误消息说明是同一配方");
}

async function test6_noTileData() {
  console.log("\nTest 6: 无试片数据 - 两个版本都没有试片");

  const { getRecipeVersionDiff } = await import("../lib/reports.js");
  const db = makeDb([], sampleRecipes, sampleRecipeVersions);

  const result = getRecipeVersionDiff(db, "RCV-0001", "RCV-0002");

  assert(!result.error, "没有错误");
  assertEq(result.tilePerformance.baseline.count, 0, "baseline 试片数 0");
  assertEq(result.tilePerformance.target.count, 0, "target 试片数 0");
  assertEq(result.tilePerformance.baseline.averageScore, 0, "baseline 平均分 0");
  assertEq(result.tilePerformance.diff.averageScore.delta, null, "平均分 delta 为 null");

  assertEq(result.defects.baseline.summary.defectRate, 0, "baseline 缺陷率 0");
  assertEq(result.defects.target.summary.defectRate, 0, "target 缺陷率 0");
  assertEq(result.defects.diff.defectRate.delta, 0, "缺陷率 delta 为 0");

  assert(result.summary.performance.some(s => s.includes("暂无评分数据")), "摘要说明暂无评分数据");
  assert(result.summary.defects.some(s => s.includes("缺陷率无变化")), "摘要说明缺陷率无变化");
}

async function test7_oneSidedNoTileData() {
  console.log("\nTest 7: 单边无试片数据 - baseline 有试片，target 无试片");

  const { getRecipeVersionDiff } = await import("../lib/reports.js");
  const db = makeDb(sampleTilesOneSided, sampleRecipes, sampleRecipeVersions);

  const result = getRecipeVersionDiff(db, "RCV-0001", "RCV-0002");

  assert(!result.error, "没有错误");
  assertEq(result.tilePerformance.baseline.count, 2, "baseline 2 片");
  assertEq(result.tilePerformance.target.count, 0, "target 0 片");

  assertApprox(result.tilePerformance.baseline.averageScore, 80, "baseline 平均分 80");
  assertEq(result.tilePerformance.target.averageScore, 0, "target 平均分 0");
  assertEq(result.tilePerformance.diff.averageScore.delta, null, "平均分 delta 为 null");

  assert(result.summary.performance.some(s => s.includes("评分数据缺失")), "摘要说明评分数据缺失");
}

async function test8_unchangedVersion() {
  console.log("\nTest 8: 版本回滚 - 配方成分相同但版本不同");

  const { getRecipeVersionDiff } = await import("../lib/reports.js");
  const tiles = [
    {
      id: "AG-010",
      body: "粗陶坯",
      recipe: "松灰42 长石35 石英18 红土5",
      ashSource: "南山松灰",
      kiln: "K-2",
      peakTemp: 1240,
      color: "青灰",
      score: 85,
      recipeVersionId: "RCV-0003",
      defectTags: []
    }
  ];
  const db = makeDb(tiles, sampleRecipes, sampleRecipeVersions);

  const result = getRecipeVersionDiff(db, "RCV-0001", "RCV-0003");

  assert(!result.error, "没有错误");
  assertEq(result.ingredients.diff.added.length, 0, "无新增原料");
  assertEq(result.ingredients.diff.removed.length, 0, "无移除原料");
  assertEq(result.ingredients.diff.modified.length, 0, "无调整比例");
  assertEq(result.ingredients.diff.unchanged.length, 4, "4 种原料未变化");

  assert(result.summary.ingredients.some(s => s.includes("原料成分无变化")), "摘要显示原料无变化");
}

async function test9_defectChanges() {
  console.log("\nTest 9: 缺陷变化 - 新增/消除缺陷类型");

  const { getRecipeVersionDiff } = await import("../lib/reports.js");
  const db = makeDb(sampleTilesWithScores, sampleRecipes, sampleRecipeVersions);

  const result = getRecipeVersionDiff(db, "RCV-0001", "RCV-0002");

  assert(result.defects.diff.resolvedDefects.includes("开裂"), "开裂缺陷已消除");
  assert(result.defects.diff.addedDefects.includes("气泡"), "新增气泡缺陷");

  const needleDefect = result.defects.diff.topDefectsDelta.find(d => d.name === "针孔");
  assert(needleDefect, "针孔出现在差异中");
  assertEq(needleDefect.baseline, 2, "baseline 针孔 2 个");
  assertEq(needleDefect.target, 1, "target 针孔 1 个");
  assertEq(needleDefect.delta, -1, "针孔 delta 为 -1");

  const severeDelta = result.defects.diff.severeDefectCount;
  assertEq(severeDelta.baseline, 2, "baseline 严重缺陷 2 个");
  assertEq(severeDelta.target, 0, "target 严重缺陷 0 个");
  assertEq(severeDelta.delta, -2, "严重缺陷 delta 为 -2");

  assert(result.summary.defects.some(s => s.includes("消除缺陷类型")), "摘要提到消除缺陷");
  assert(result.summary.defects.some(s => s.includes("严重缺陷减少")), "摘要提到严重缺陷减少");
}

async function test10_routeHandler() {
  console.log("\nTest 10: 路由处理器 handleGetRecipeVersionDiff");

  const { handleGetRecipeVersionDiff } = await import("../lib/recipe-routes.js");
  const { loadDb } = await import("../lib/db.js");

  await writeFile(testDbPath, JSON.stringify(makeDb(sampleTilesWithScores, sampleRecipes, sampleRecipeVersions), null, 2));
  const db = await loadDb();

  const url1 = new URL("http://localhost/recipes/RC-001/versions/diff");
  const r1 = await handleGetRecipeVersionDiff("RC-001", "RCV-0001", "RCV-0002", db);
  assertEq(r1.status, 200, "正常请求返回 200");
  assert(r1.data.meta, "返回有 meta");
  assert(r1.data.ingredients, "返回有 ingredients");
  assert(r1.data.summary, "返回有 summary");

  const r2 = await handleGetRecipeVersionDiff("RC-9999", "RCV-0001", "RCV-0002", db);
  assertEq(r2.status, 404, "配方不存在返回 404");
  assertEq(r2.data.error, "recipe_not_found", "错误码 recipe_not_found");

  const r3 = await handleGetRecipeVersionDiff("RC-001", "RCV-9999", "RCV-0002", db);
  assertEq(r3.status, 404, "版本不存在返回 404");
  assertEq(r3.data.error, "versions_not_found", "错误码 versions_not_found");

  const r4 = await handleGetRecipeVersionDiff("RC-001", "RCV-0001", "RCV-0004", db);
  assertEq(r4.status, 400, "跨配方返回 400");
  assertEq(r4.data.error, "cross_recipe_diff_not_allowed", "错误码 cross_recipe_diff_not_allowed");
}

async function test11_serverRouteParams() {
  console.log("\nTest 11: 服务端路由参数校验");

  const { handleGetRecipeVersionDiff } = await import("../lib/recipe-routes.js");
  const { loadDb } = await import("../lib/db.js");

  await writeFile(testDbPath, JSON.stringify(makeDb([], sampleRecipes, sampleRecipeVersions), null, 2));
  const db = await loadDb();

  const r1 = await handleGetRecipeVersionDiff("RC-001", "", "RCV-0002", db);
  assertEq(r1.status, 404, "baseline 为空时版本不存在");

  const r2 = await handleGetRecipeVersionDiff("RC-001", "RCV-0001", "", db);
  assertEq(r2.status, 404, "target 为空时版本不存在");
}

async function run() {
  await setupTestEnv();
  try {
    await test1_ingredientDiff();
    await test2_ingredientUnchanged();
    await test3_fullDiffWithTiles();
    await test4_missingVersions();
    await test5_crossRecipeDiff();
    await test6_noTileData();
    await test7_oneSidedNoTileData();
    await test8_unchangedVersion();
    await test9_defectChanges();
    await test10_routeHandler();
    await test11_serverRouteParams();
  } finally {
    await cleanupTestEnv();
  }

  console.log(`\n======== 结果 ========`);
  console.log(`通过: ${passed}`);
  console.log(`失败: ${failed}`);
  if (failures.length > 0) {
    console.log(`\n失败用例:`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

run().catch(err => {
  console.error("Test crash:", err);
  process.exit(1);
});
