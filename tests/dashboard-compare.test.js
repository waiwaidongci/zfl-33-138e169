import { mkdir, writeFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(__dirname);
const testDir = join(projectRoot, "tests", "tmp-compare");
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

function makeDb(tiles) {
  return {
    schemaVersion: 1,
    collections: {
      tiles,
      firingPlans: [],
      recipes: [],
      recipeVersions: [],
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

const sampleTilesFull = [
  {
    id: "AG-001",
    body: "粗陶坯",
    recipe: "松灰45 长石30 石英20 高岭5",
    ashSource: "南山松灰",
    kiln: "K-1",
    peakTemp: 1210,
    color: "青灰",
    score: 82,
    defects: "轻微针孔",
    defectTags: [{ name: "针孔", severity: "mild" }]
  },
  {
    id: "AG-002",
    body: "粗陶坯",
    recipe: "松灰45 长石30 石英20 高岭5",
    ashSource: "南山松灰",
    kiln: "K-1",
    peakTemp: 1215,
    color: "灰青",
    score: 78,
    defects: "针孔 流釉",
    defectTags: [
      { name: "针孔", severity: "medium" },
      { name: "流釉", severity: "mild" }
    ]
  },
  {
    id: "AG-003",
    body: "细瓷坯",
    recipe: "松灰45 长石30 石英20 高岭5",
    ashSource: "南山松灰",
    kiln: "K-1",
    peakTemp: 1205,
    color: "月白",
    score: 55,
    defects: "严重开裂 针孔密集",
    defectTags: [
      { name: "开裂", severity: "severe" },
      { name: "针孔", severity: "severe" }
    ]
  },
  {
    id: "AG-004",
    body: "粗陶坯",
    recipe: "稻灰50 长石30 石英15 高岭5",
    ashSource: "东北稻灰",
    kiln: "K-2",
    peakTemp: 1245,
    color: "乳白",
    score: 88,
    defects: "",
    defectTags: []
  },
  {
    id: "AG-005",
    body: "细瓷坯",
    recipe: "稻灰50 长石30 石英15 高岭5",
    ashSource: "东北稻灰",
    kiln: "K-2",
    peakTemp: 1255,
    color: "青白",
    score: 90,
    defects: "轻微气泡",
    defectTags: [{ name: "气泡", severity: "mild" }]
  },
  {
    id: "AG-006",
    body: "粗陶坯",
    recipe: "稻灰50 长石30 石英15 高岭5",
    ashSource: "东北稻灰",
    kiln: "K-2",
    peakTemp: 1250,
    color: "灰白",
    score: 70,
    defects: "流釉 针孔",
    defectTags: [
      { name: "流釉", severity: "medium" },
      { name: "针孔", severity: "medium" }
    ]
  },
  {
    id: "AG-007",
    body: "粗陶坯",
    recipe: "竹灰42 长石35 石英18 红土5",
    ashSource: "莫干山竹灰",
    kiln: "K-3",
    peakTemp: 1270,
    color: "灰绿",
    score: 85,
    defects: "",
    defectTags: []
  },
  {
    id: "AG-008",
    body: "细瓷坯",
    recipe: "竹灰42 长石35 石英18 红土5",
    ashSource: "莫干山竹灰",
    kiln: "K-3",
    peakTemp: 1280,
    color: "墨绿",
    score: 65,
    defects: "缩釉 黑点",
    defectTags: [
      { name: "缩釉", severity: "severe" },
      { name: "黑点", severity: "medium" }
    ]
  }
];

const sampleTilesOneSidedNoScore = [
  {
    id: "AG-101",
    body: "粗陶坯",
    recipe: "松灰45",
    ashSource: "南山松灰",
    kiln: "K-1",
    peakTemp: 1230,
    score: 0,
    defectTags: [{ name: "针孔", severity: "mild" }]
  },
  {
    id: "AG-102",
    body: "粗陶坯",
    recipe: "松灰45",
    ashSource: "南山松灰",
    kiln: "K-1",
    peakTemp: 1240,
    score: 0,
    defectTags: []
  },
  {
    id: "AG-103",
    body: "细瓷坯",
    recipe: "稻灰50",
    ashSource: "东北稻灰",
    kiln: "K-2",
    peakTemp: 1250,
    score: 85,
    defectTags: []
  },
  {
    id: "AG-104",
    body: "细瓷坯",
    recipe: "稻灰50",
    ashSource: "东北稻灰",
    kiln: "K-2",
    peakTemp: 1260,
    score: 88,
    defectTags: [{ name: "气泡", severity: "mild" }]
  }
];

const sampleTilesMissingDefectTags = [
  {
    id: "AG-201",
    body: "粗陶坯",
    recipe: "松灰45",
    ashSource: "南山松灰",
    kiln: "K-1",
    peakTemp: 1230,
    score: 80,
    defects: "有针孔但没打标签",
  },
  {
    id: "AG-202",
    body: "粗陶坯",
    recipe: "松灰45",
    ashSource: "南山松灰",
    kiln: "K-1",
    peakTemp: 1240,
    score: 75,
    defects: "有问题",
    defectTags: null
  },
  {
    id: "AG-203",
    body: "细瓷坯",
    recipe: "稻灰50",
    ashSource: "东北稻灰",
    kiln: "K-2",
    peakTemp: 1250,
    score: 70,
    defectTags: [{ name: "针孔", severity: "mild" }]
  },
  {
    id: "AG-204",
    body: "细瓷坯",
    recipe: "稻灰50",
    ashSource: "东北稻灰",
    kiln: "K-2",
    peakTemp: 1260,
    score: 92
  }
];

async function test1_compareAshSource() {
  console.log("\nTest 1: 按灰源对比 - 南山松灰 vs 东北稻灰");

  const { buildCompareAnalysis } = await import("../lib/dashboard-service.js");
  const db = makeDb(sampleTilesFull);

  const result = buildCompareAnalysis(db, {
    baseline: { type: "ashSource", value: "南山松灰" },
    target: { type: "ashSource", value: "东北稻灰" },
    lowScoreThreshold: 75
  });

  assert(result.generatedAt, "有 generatedAt 时间戳");
  assertEq(result.scope.baseline.type, "ashSource", "baseline type 正确");
  assertEq(result.scope.baseline.value, "南山松灰", "baseline value 正确");
  assertEq(result.scope.baseline.tileCount, 3, "baseline 试片数正确");
  assertEq(result.scope.target.type, "ashSource", "target type 正确");
  assertEq(result.scope.target.value, "东北稻灰", "target value 正确");
  assertEq(result.scope.target.tileCount, 3, "target 试片数正确");

  assertEq(result.baseline.tileCount, 3, "baseline tileCount=3");
  assertEq(result.baseline.scoredCount, 3, "baseline scoredCount=3");
  assertApprox(result.baseline.averageScore, 71.7, "baseline 平均分正确（(82+78+55)/3 保留1位=71.7）");
  assertEq(result.baseline.tilesWithDefects, 3, "baseline 全部有缺陷");
  assertEq(result.baseline.topDefects.length > 0, true, "baseline 有高频缺陷");
  assert(result.baseline.topDefects.some(d => d.name === "针孔"), "baseline 高频缺陷含针孔");

  assertEq(result.target.tileCount, 3, "target tileCount=3");
  assertEq(result.target.scoredCount, 3, "target scoredCount=3");
  assertApprox(result.target.averageScore, 82.7, "target 平均分正确（(88+90+70)/3 保留1位=82.7）");

  const avgScoreDelta = result.delta.averageScore.delta;
  const expectedDelta = Number(((88 + 90 + 70) / 3 - (82 + 78 + 55) / 3).toFixed(1));
  assertApprox(avgScoreDelta, expectedDelta, "平均分 delta 正确");
  assert(result.delta.averageScore.deltaPct !== null, "平均分有 deltaPct");

  assert(result.delta.topDefectsDelta.length > 0, "有 topDefectsDelta");
  const needleDefect = result.delta.topDefectsDelta.find(d => d.name === "针孔");
  assert(needleDefect, "针孔出现在差异中");
  assertEq(needleDefect.baseline >= 1, true, "baseline 针孔数 >= 1");

  assert("commonCount" in result.delta.lowScoreTilesDiff, "低分样砖有 commonCount");
  assert("onlyInBaseline" in result.delta.lowScoreTilesDiff, "低分样砖有 onlyInBaseline");
  assert("onlyInTarget" in result.delta.lowScoreTilesDiff, "低分样砖有 onlyInTarget");
  assert(result.delta.lowScoreTilesDiff.onlyInBaseline.some(t => t.id === "AG-003"), "AG-003 仅在 baseline 低分中");

  assert(result.delta.severityDelta.length > 0, "有严重度差异");
  const severeRow = result.delta.severityDelta.find(s => s.key === "severe");
  assert(severeRow, "有 severe 严重度行");
  assertEq(severeRow.baseline >= 1, true, "baseline severe >= 1");
}

async function test2_compareKiln() {
  console.log("\nTest 2: 按窑炉对比 - K-1 vs K-2");

  const { buildCompareAnalysis } = await import("../lib/dashboard-service.js");
  const db = makeDb(sampleTilesFull);

  const result = buildCompareAnalysis(db, {
    baseline: { type: "kiln", value: "K-1" },
    target: { type: "kiln", value: "K-2" }
  });

  assertEq(result.scope.baseline.tileCount, 3, "K-1 有 3 片");
  assertEq(result.scope.target.tileCount, 3, "K-2 有 3 片");
  assertEq(result.baseline.kiln, undefined, "baseline 不额外带 kiln 字段");

  const tileCountDelta = result.delta.tileCount;
  assertEq(tileCountDelta.baseline, 3, "tileCount delta.baseline=3");
  assertEq(tileCountDelta.target, 3, "tileCount delta.target=3");
  assertEq(tileCountDelta.delta, 0, "tileCount delta=0");
}

async function test3_compareTempRange() {
  console.log("\nTest 3: 按温度区间对比 - 1200-1220 vs 1240-1260");

  const { buildCompareAnalysis } = await import("../lib/dashboard-service.js");
  const db = makeDb(sampleTilesFull);

  const result = buildCompareAnalysis(db, {
    baseline: { type: "tempRange", value: "1200-1220°C" },
    target: { type: "tempRange", value: "1240-1260°C" }
  });

  assertEq(result.scope.baseline.tileCount, 3, "1200-1220区间 3 片（AG-001,AG-002,AG-003）");
  assertEq(result.scope.target.tileCount, 3, "1240-1260区间 3 片（AG-004,AG-005,AG-006）");
  assert(result.delta.defectRate !== undefined, "有 defectRate delta");
}

async function test4_emptyData() {
  console.log("\nTest 4: 空数据 - 数据库为空");

  const { buildCompareAnalysis } = await import("../lib/dashboard-service.js");
  const db = makeDb([]);

  const result = buildCompareAnalysis(db, {
    baseline: { type: "ashSource", value: "南山松灰" },
    target: { type: "ashSource", value: "东北稻灰" }
  });

  assertEq(result.baseline.tileCount, 0, "baseline tileCount=0");
  assertEq(result.target.tileCount, 0, "target tileCount=0");
  assertEq(result.baseline.scoredCount, 0, "baseline scoredCount=0");
  assertEq(result.target.scoredCount, 0, "target scoredCount=0");
  assertEq(result.baseline.averageScore, null, "baseline averageScore=null");
  assertEq(result.target.averageScore, null, "target averageScore=null");
  assertEq(result.baseline.topDefects.length, 0, "baseline 无高频缺陷");
  assertEq(result.target.topDefects.length, 0, "target 无高频缺陷");
  assertEq(result.baseline.lowScoreTileCount, 0, "baseline 无低分");
  assertEq(result.target.lowScoreTileCount, 0, "target 无低分");

  assertEq(result.delta.tileCount.delta, 0, "delta tileCount=0-0=0");
  assertEq(result.delta.averageScore.delta, null, "delta averageScore=null（两边都null）");
  assertEq(result.delta.averageScore.deltaPct, null, "delta averageScore.deltaPct=null");
  assertEq(result.delta.defectRate.delta, 0, "delta defectRate=0-0=0");
  assertEq(result.delta.topDefectsDelta.length, 0, "topDefectsDelta 为空");
  assertEq(result.delta.lowScoreTilesDiff.commonCount, 0, "低分 commonCount=0");
  assertEq(result.delta.lowScoreTilesDiff.onlyInBaseline.length, 0, "onlyInBaseline 空");
  assertEq(result.delta.lowScoreTilesDiff.onlyInTarget.length, 0, "onlyInTarget 空");
}

async function test5_emptyScope() {
  console.log("\nTest 5: scope 无匹配数据 - 只查不存在的灰源");

  const { buildCompareAnalysis } = await import("../lib/dashboard-service.js");
  const db = makeDb(sampleTilesFull);

  const result = buildCompareAnalysis(db, {
    baseline: { type: "ashSource", value: "不存在的灰源" },
    target: { type: "ashSource", value: "莫干山竹灰" }
  });

  assertEq(result.scope.baseline.tileCount, 0, "baseline scope 匹配 0 条");
  assertEq(result.scope.target.tileCount, 2, "target scope 匹配 2 条（莫干山竹灰）");
  assertEq(result.baseline.averageScore, null, "baseline 平均分 null");
  assert(result.target.averageScore !== null, "target 平均分非 null");
  assertEq(result.delta.averageScore.baseline, null, "delta baseline avg=null");
  assert(result.delta.averageScore.target !== null, "delta target avg 有值");
  assertEq(result.delta.averageScore.deltaPct, null, "baseline 为 null 时 deltaPct=null");
}

async function test6_oneSidedNoScore() {
  console.log("\nTest 6: 单边无评分 - baseline 所有试片 score=0");

  const { buildCompareAnalysis } = await import("../lib/dashboard-service.js");
  const db = makeDb(sampleTilesOneSidedNoScore);

  const result = buildCompareAnalysis(db, {
    baseline: { type: "ashSource", value: "南山松灰" },
    target: { type: "ashSource", value: "东北稻灰" }
  });

  assertEq(result.baseline.tileCount, 2, "baseline 2 片");
  assertEq(result.baseline.scoredCount, 0, "baseline 0 个有评分");
  assertEq(result.baseline.unscoredCount, 2, "baseline 2 个未评分");
  assertEq(result.baseline.averageScore, null, "baseline 平均分 null");

  assertEq(result.target.tileCount, 2, "target 2 片");
  assertEq(result.target.scoredCount, 2, "target 全部有评分");
  assertApprox(result.target.averageScore, (85 + 88) / 2, "target 平均分 86.5");

  const avgDelta = result.delta.averageScore;
  assertEq(avgDelta.baseline, null, "avg baseline=null");
  assertApprox(avgDelta.target, 86.5, "avg target=86.5");
  assertEq(avgDelta.deltaPct, null, "baseline 无评分时 deltaPct=null");

  const scoreDist = result.delta.scoreDistribution;
  assertEq(scoreDist.baseline.unscored, 2, "baseline scoreDist 有 unscored=2");
  const totalScoredDist = (scoreDist.target.excellent || 0)
    + (scoreDist.target.good || 0)
    + (scoreDist.target.pass || 0)
    + (scoreDist.target.low || 0);
  assert(totalScoredDist === 2, "target scoreDist 有评分分布（共2个已评分片");
}

async function test7_missingDefectTags() {
  console.log("\nTest 7: 缺陷标签缺失 - 部分试片 defectTags=null/undefined");

  const { buildCompareAnalysis } = await import("../lib/dashboard-service.js");
  const db = makeDb(sampleTilesMissingDefectTags);

  const result = buildCompareAnalysis(db, {
    baseline: { type: "ashSource", value: "南山松灰" },
    target: { type: "ashSource", value: "东北稻灰" }
  });

  assertEq(result.baseline.tileCount, 2, "baseline 2 片");
  assertEq(result.baseline.tilesWithDefects, 0, "baseline 因 defectTags 缺失 0 片统计为有缺陷");
  assertEq(result.baseline.totalDefectCount, 0, "baseline 缺陷标签总数 0");
  assertEq(result.baseline.topDefects.length, 0, "baseline 高频缺陷为空（无合法tag）");

  assertEq(result.target.tileCount, 2, "target 2 片");
  assertEq(result.target.tilesWithDefects, 1, "target 1 片有缺陷标签");
  assertEq(result.target.totalDefectCount, 1, "target 缺陷标签总数 1");

  const defectDelta = result.delta.topDefectsDelta;
  const needle = defectDelta.find(d => d.name === "针孔");
  if (needle) {
    assertEq(needle.baseline, 0, "针孔 baseline=0");
    assertEq(needle.target, 1, "针孔 target=1");
    assertEq(needle.delta, 1, "针孔 delta=+1");
  }

  const sevDelta = result.delta.severityDelta;
  const mildRow = sevDelta.find(s => s.key === "mild");
  if (mildRow) {
    assertEq(mildRow.baseline, 0, "mild baseline=0");
    assertEq(mildRow.target, 1, "mild target=1");
  }
}

async function test8_validationErrors() {
  console.log("\nTest 8: 参数校验错误");

  const { buildCompareAnalysis } = await import("../lib/dashboard-service.js");
  const db = makeDb(sampleTilesFull);

  let threw = false;
  try {
    buildCompareAnalysis(db, {
      baseline: null,
      target: { type: "ashSource", value: "东北稻灰" }
    });
  } catch (e) {
    threw = true;
    assert(e.message.includes("baseline"), "错误提示提到 baseline");
  }
  assert(threw, "缺少 baseline 时抛错");

  threw = false;
  try {
    buildCompareAnalysis(db, {
      baseline: { type: "ashSource", value: "南山松灰" },
      target: { type: "invalid", value: "x" }
    });
  } catch (e) {
    threw = true;
    assert(e.message.includes("target.type"), "错误提示提到 target.type");
  }
  assert(threw, "target.type 非法时抛错");

  threw = false;
  try {
    buildCompareAnalysis(db, {
      baseline: { type: "ashSource" },
      target: { type: "kiln", value: "K-1" }
    });
  } catch (e) {
    threw = true;
    assert(e.message.includes("value"), "错误提示提到 value");
  }
  assert(threw, "baseline 缺少 value 时抛错");
}

async function test9_crossTypeCompare() {
  console.log("\nTest 9: 跨维度对比 - 灰源 vs 窑炉");

  const { buildCompareAnalysis } = await import("../lib/dashboard-service.js");
  const db = makeDb(sampleTilesFull);

  const result = buildCompareAnalysis(db, {
    baseline: { type: "ashSource", value: "南山松灰" },
    target: { type: "kiln", value: "K-3" }
  });

  assertEq(result.scope.baseline.type, "ashSource", "baseline type=ashSource");
  assertEq(result.scope.target.type, "kiln", "target type=kiln");
  assertEq(result.scope.baseline.tileCount, 3, "baseline 灰源匹配 3 片");
  assertEq(result.scope.target.tileCount, 2, "target 窑炉 K-3 匹配 2 片");
  assert(result.delta.topDefectsDelta.length >= 0, "缺陷差异可正常计算");
  assert(result.delta.tileCount.delta === -1, "3-2=-1 片差");
}

async function test10_routeHandler() {
  console.log("\nTest 10: 路由处理器 handleGetDashboardCompare");

  const { handleGetDashboardCompare } = await import("../lib/dashboard-routes.js");
  const { loadDb } = await import("../lib/db.js");

  await writeFile(testDbPath, JSON.stringify(makeDb(sampleTilesFull), null, 2));
  const db = await loadDb();

  const url1 = new URL("http://localhost/dashboard/compare?baselineType=ashSource&baselineValue=%E5%8D%97%E5%B1%B1%E6%9D%BE%E7%81%B0&targetType=ashSource&targetValue=%E4%B8%9C%E5%8C%97%E7%A8%BB%E7%81%B0");
  const r1 = await handleGetDashboardCompare(url1, db);
  assertEq(r1.status, 200, "正常请求返回 200");
  assert(r1.data.scope, "返回有 scope 元信息");
  assert(r1.data.baseline, "返回有 baseline");
  assert(r1.data.target, "返回有 target");
  assert(r1.data.delta, "返回有 delta");

  const url2 = new URL("http://localhost/dashboard/compare?baselineType=ashSource");
  const r2 = await handleGetDashboardCompare(url2, db);
  assertEq(r2.status, 400, "缺少参数返回 400");
  assertEq(r2.data.error, "missing_required", "错误码 missing_required");
  assert(r2.data.required.length > 0, "有 required 说明");

  const url3 = new URL("http://localhost/dashboard/compare?baselineType=bad&baselineValue=x&targetType=ashSource&targetValue=y");
  const r3 = await handleGetDashboardCompare(url3, db);
  assertEq(r3.status, 400, "非法 baselineType 返回 400");
  assertEq(r3.data.error, "invalid_baseline_type", "错误码 invalid_baseline_type");

  const url4 = new URL("http://localhost/dashboard/compare?baselineType=ashSource&baselineValue=x&targetType=bad&targetValue=y");
  const r4 = await handleGetDashboardCompare(url4, db);
  assertEq(r4.status, 400, "非法 targetType 返回 400");
  assertEq(r4.data.error, "invalid_target_type", "错误码 invalid_target_type");

  const url5 = new URL("http://localhost/dashboard/compare?baselineType=ashSource&baselineValue=x&targetType=kiln&targetValue=y&lowScoreThreshold=60");
  const r5 = await handleGetDashboardCompare(url5, db);
  assertEq(r5.status, 200, "带 lowScoreThreshold 返回 200");
  assertEq(r5.data.scope.lowScoreThreshold, 60, "lowScoreThreshold=60 生效");
}

async function run() {
  await setupTestEnv();
  try {
    await test1_compareAshSource();
    await test2_compareKiln();
    await test3_compareTempRange();
    await test4_emptyData();
    await test5_emptyScope();
    await test6_oneSidedNoScore();
    await test7_missingDefectTags();
    await test8_validationErrors();
    await test9_crossTypeCompare();
    await test10_routeHandler();
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
