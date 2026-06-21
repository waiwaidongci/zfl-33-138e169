import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import http from "node:http";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(__dirname);
const testDir = join(projectRoot, "tests", "tmp-experiment-review");
const testDataDir = join(testDir, "data");
const testDbPath = join(testDataDir, "ash-glaze.json");
const testBackupDir = join(testDataDir, "backups");

process.env.ASH_GLAZE_DATA_DIR = testDataDir;
process.env.ASH_GLAZE_DB_PATH = testDbPath;
process.env.ASH_GLAZE_BACKUP_DIR = testBackupDir;

const port = Number(process.env.TEST_PORT || 3199);

function fileUrl(p) {
  return pathToFileURL(resolve(p)).href;
}

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

function assertHas(obj, path, msg) {
  const parts = path.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined) {
      failed++;
      failures.push(`${msg}: 路径 ${path} 在 ${p} 处为 null/undefined`);
      console.log(`  ✗ ${msg}: 路径 ${path} 在 ${p} 处为 null/undefined`);
      return;
    }
    cur = cur[p];
  }
  if (cur !== undefined) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    failures.push(`${msg}: 路径 ${path} 不存在`);
    console.log(`  ✗ ${msg}: 路径 ${path} 不存在`);
  }
}

function buildFullTestDb() {
  const today = "2026-06-15";
  const tiles = [
    {
      id: "AG-LS-001",
      body: "粗陶坯",
      recipe: "松灰50 长石30 石英15 红土5",
      ashSource: "南山松灰",
      glazeThickness: "1.2mm",
      kiln: "K-2",
      firingCurve: [
        { temp: 25, minutes: 0 },
        { temp: 600, minutes: 120 },
        { temp: 900, minutes: 240 },
        { temp: 1280, minutes: 440 },
        { temp: 1280, minutes: 490 }
      ],
      peakTemp: 1280,
      color: "暗褐",
      defects: "严重流釉，大面积针孔",
      defectTags: [
        { name: "流釉", severity: "severe", note: "大面积" },
        { name: "针孔", severity: "medium", note: "" }
      ],
      score: 52,
      observations: [{ at: today, note: "峰值温度偏高，流釉严重" }],
      recipeVersionId: null,
      status: "archived",
      statusHistory: [],
      batchId: null,
      inventoryDeducted: false
    },
    {
      id: "AG-HS-001",
      body: "粗陶坯",
      recipe: "松灰40 长石38 石英18 红土4",
      ashSource: "南山松灰",
      glazeThickness: "0.8mm",
      kiln: "K-2",
      firingCurve: [
        { temp: 25, minutes: 0 },
        { temp: 600, minutes: 180 },
        { temp: 900, minutes: 300 },
        { temp: 1240, minutes: 510 },
        { temp: 1240, minutes: 545 }
      ],
      peakTemp: 1240,
      color: "青灰带油滴",
      defects: "边缘轻微流釉",
      defectTags: [{ name: "流釉", severity: "mild", note: "边缘" }],
      score: 85,
      observations: [{ at: today, note: "配方调整有效，流釉改善明显" }],
      recipeVersionId: null,
      status: "archived",
      statusHistory: [],
      batchId: null,
      inventoryDeducted: false
    },
    {
      id: "AG-HS-002",
      body: "粗陶坯",
      recipe: "松灰42 长石35 石英20 红土3",
      ashSource: "南山松灰",
      glazeThickness: "0.9mm",
      kiln: "K-2",
      firingCurve: [
        { temp: 25, minutes: 0 },
        { temp: 600, minutes: 160 },
        { temp: 900, minutes: 320 },
        { temp: 1235, minutes: 520 },
        { temp: 1235, minutes: 560 }
      ],
      peakTemp: 1235,
      color: "青灰",
      defects: "",
      defectTags: [],
      score: 90,
      observations: [{ at: today, note: "釉面均匀，无明显缺陷" }],
      recipeVersionId: null,
      status: "archived",
      statusHistory: [],
      batchId: null,
      inventoryDeducted: false
    },
    {
      id: "AG-HS-003",
      body: "细瓷坯",
      recipe: "稻灰40 长石40 石英18 红土2",
      ashSource: "东北稻灰",
      glazeThickness: "0.6mm",
      kiln: "K-1",
      firingCurve: [],
      peakTemp: 1260,
      color: "月白",
      defects: "",
      defectTags: [],
      score: 88,
      observations: [{ at: today, note: "光泽度好" }],
      recipeVersionId: null,
      status: "archived",
      statusHistory: [],
      batchId: null,
      inventoryDeducted: false
    },
    {
      id: "AG-LS-002",
      body: "粗陶坯",
      recipe: "竹灰48 长石25 石英22 高岭5",
      ashSource: "莫干山竹灰",
      glazeThickness: "1.0mm",
      kiln: "K-2",
      firingCurve: [],
      peakTemp: 1220,
      color: "灰黄无光",
      defects: "无光，橘皮严重",
      defectTags: [
        { name: "无光", severity: "medium", note: "" },
        { name: "橘皮", severity: "medium", note: "" }
      ],
      score: 58,
      observations: [{ at: today, note: "温度偏低，釉面未熔好" }],
      recipeVersionId: null,
      status: "pending_review",
      statusHistory: [],
      batchId: null,
      inventoryDeducted: false
    },
    {
      id: "AG-HS-004",
      body: "粗陶坯",
      recipe: "竹灰42 长石35 石英18 高岭5",
      ashSource: "莫干山竹灰",
      glazeThickness: "0.9mm",
      kiln: "K-2",
      firingCurve: [],
      peakTemp: 1245,
      color: "灰青温润",
      defects: "",
      defectTags: [],
      score: 86,
      observations: [{ at: today, note: "竹灰釉色温润" }],
      recipeVersionId: null,
      status: "archived",
      statusHistory: [],
      batchId: null,
      inventoryDeducted: false
    },
    {
      id: "AG-HS-005",
      body: "细瓷坯",
      recipe: "木灰52 长石28 石英18 高岭2",
      ashSource: "果木灰",
      glazeThickness: "0.7mm",
      kiln: "K-1",
      firingCurve: [],
      peakTemp: 1250,
      color: "乳白",
      defects: "",
      defectTags: [],
      score: 91,
      observations: [],
      recipeVersionId: null,
      status: "archived",
      statusHistory: [],
      batchId: null,
      inventoryDeducted: false
    },
    {
      id: "AG-LS-003",
      body: "粗陶坯",
      recipe: "松灰46 长石32 石英17 红土5",
      ashSource: "北山松灰",
      glazeThickness: "0.8mm",
      kiln: "K-3",
      firingCurve: [],
      peakTemp: 1260,
      color: "酱褐",
      defects: "缩釉开裂",
      defectTags: [
        { name: "缩釉", severity: "medium", note: "" },
        { name: "开裂", severity: "severe", note: "坯裂" }
      ],
      score: 48,
      observations: [{ at: today, note: "柴窑气氛波动大" }],
      recipeVersionId: null,
      status: "pending_review",
      statusHistory: [],
      batchId: null,
      inventoryDeducted: false
    },
    {
      id: "AG-MX-001",
      body: "粗陶坯",
      recipe: "松灰44 长石36 石英16 红土4",
      ashSource: "南山松灰",
      glazeThickness: "0.85mm",
      kiln: "K-2",
      firingCurve: [],
      peakTemp: 1240,
      color: "青灰带斑点",
      defects: "少量斑点",
      defectTags: [{ name: "斑点", severity: "mild", note: "" }],
      score: 72,
      observations: [],
      recipeVersionId: null,
      status: "archived",
      statusHistory: [],
      batchId: null,
      inventoryDeducted: false
    },
    {
      id: "AG-MX-002",
      body: "细瓷坯",
      recipe: "稻灰38 长石42 石英18 高岭2",
      ashSource: "东北稻灰",
      glazeThickness: "0.65mm",
      kiln: "K-1",
      firingCurve: [],
      peakTemp: 1260,
      color: "月白微开片",
      defects: "轻微开片",
      defectTags: [{ name: "开片", severity: "mild", note: "" }],
      score: 78,
      observations: [],
      recipeVersionId: null,
      status: "archived",
      statusHistory: [],
      batchId: null,
      inventoryDeducted: false
    }
  ];

  return {
    schemaVersion: 4,
    migrations: [
      { version: 1, name: "introduce-schema-version", appliedAt: "2026-06-01T00:00:00.000Z" },
      { version: 2, name: "add-tile-status-fields", appliedAt: "2026-06-02T00:00:00.000Z" },
      { version: 3, name: "add-inventory-reservation", appliedAt: "2026-06-03T00:00:00.000Z" },
      { version: 4, name: "add-business-events", appliedAt: "2026-06-04T00:00:00.000Z" }
    ],
    collections: {
      tiles,
      firingPlans: [],
      recipes: [],
      recipeVersions: [],
      batches: [],
      materialStocks: [],
      inventoryTransactions: [],
      businessEvents: []
    }
  };
}

function buildSparseTestDb() {
  return {
    schemaVersion: 4,
    migrations: [
      { version: 1, name: "introduce-schema-version", appliedAt: "2026-06-01T00:00:00.000Z" },
      { version: 2, name: "add-tile-status-fields", appliedAt: "2026-06-02T00:00:00.000Z" },
      { version: 3, name: "add-inventory-reservation", appliedAt: "2026-06-03T00:00:00.000Z" },
      { version: 4, name: "add-business-events", appliedAt: "2026-06-04T00:00:00.000Z" }
    ],
    collections: {
      tiles: [
        {
          id: "AG-SPARSE-001",
          body: "粗陶坯",
          recipe: "松灰45 长石35 石英15 红土5",
          ashSource: "",
          kiln: "",
          peakTemp: 0,
          color: "",
          defects: "流釉",
          defectTags: [{ name: "流釉", severity: "medium", note: "" }],
          score: 55,
          observations: [],
          recipeVersionId: null,
          status: "pending_review",
          statusHistory: [],
          batchId: null,
          inventoryDeducted: false
        },
        {
          id: "AG-SPARSE-002",
          body: "细瓷坯",
          recipe: "",
          ashSource: "",
          kiln: "",
          peakTemp: 0,
          color: "",
          defects: "",
          defectTags: [],
          score: 0,
          observations: [],
          recipeVersionId: null,
          status: "draft",
          statusHistory: [],
          batchId: null,
          inventoryDeducted: false
        }
      ],
      firingPlans: [],
      recipes: [],
      recipeVersions: [],
      batches: [],
      materialStocks: [],
      inventoryTransactions: [],
      businessEvents: []
    }
  };
}

function buildUnparseableRecipeDb() {
  return {
    schemaVersion: 4,
    migrations: [
      { version: 1, name: "introduce-schema-version", appliedAt: "2026-06-01T00:00:00.000Z" },
      { version: 2, name: "add-tile-status-fields", appliedAt: "2026-06-02T00:00:00.000Z" },
      { version: 3, name: "add-inventory-reservation", appliedAt: "2026-06-03T00:00:00.000Z" },
      { version: 4, name: "add-business-events", appliedAt: "2026-06-04T00:00:00.000Z" }
    ],
    collections: {
      tiles: [
        {
          id: "AG-UP-001",
          body: "粗陶坯",
          recipe: "松灰 长石 石英 红土",
          ashSource: "南山松灰",
          kiln: "K-2",
          peakTemp: 1250,
          color: "灰褐",
          defects: "针孔较多",
          defectTags: [{ name: "针孔", severity: "medium", note: "" }],
          score: 60,
          observations: [],
          recipeVersionId: null,
          status: "pending_review",
          statusHistory: [],
          batchId: null,
          inventoryDeducted: false
        },
        {
          id: "AG-UP-002",
          body: "粗陶坯",
          recipe: "松灰42 长石35 石英18 红土5",
          ashSource: "南山松灰",
          kiln: "K-2",
          peakTemp: 1240,
          color: "青灰",
          defects: "",
          defectTags: [],
          score: 84,
          observations: [],
          recipeVersionId: null,
          status: "archived",
          statusHistory: [],
          batchId: null,
          inventoryDeducted: false
        }
      ],
      firingPlans: [],
      recipes: [],
      recipeVersions: [],
      batches: [],
      materialStocks: [],
      inventoryTransactions: [],
      businessEvents: []
    }
  };
}

async function setupTestDb(dbData) {
  await mkdir(testDataDir, { recursive: true });
  await mkdir(testBackupDir, { recursive: true });
  await writeFile(testDbPath, JSON.stringify(dbData, null, 2));
  deleteCacheKeys();
}

function deleteCacheKeys() {
  delete process.env.__db_cache;
}

async function cleanupTestDir() {
  try {
    await rm(testDir, { recursive: true, force: true });
  } catch (_) {}
}

function httpRequest(method, path, body, usePort) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: "localhost",
      port: usePort || port,
      path,
      method,
      headers: data ? {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data)
      } : {}
    };
    const req = http.request(options, (res) => {
      let chunks = "";
      res.setEncoding("utf8");
      res.on("data", (c) => chunks += c);
      res.on("end", () => {
        try {
          const parsed = chunks ? JSON.parse(chunks) : {};
          resolve({ status: res.statusCode, body: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, body: chunks });
        }
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function importModuleFresh(path) {
  return import(path + "?t=" + Date.now());
}

let httpSeq = 0;
function nextPort() {
  httpSeq += 1;
  return 3200 + httpSeq;
}

// ========== 测试 ==========

console.log("\n=== 实验复盘推荐 端到端测试 ===\n");

// ---- 单元级直接调用测试 ----
console.log("【单元测试：generateExperimentReview 直接调用】\n");

await (async function testDirectReviewWithFullDb() {
  console.log("场景1: 低分多缺陷试片（流釉+针孔），完整历史数据");
  const db = buildFullTestDb();
  const { generateExperimentReview } = await import(
    fileUrl("lib/experiment-review.js") + "?t=direct1"
  );
  const result = generateExperimentReview(db, "AG-LS-001");
  assert(!result.error, "生成推荐不应报错");
  assertHas(result, "meta.generatedAt", "包含生成时间 meta.generatedAt");
  assertHas(result, "meta.tileId", "包含 meta.tileId");
  assertEq(result.meta.tileId, "AG-LS-001", "meta.tileId 匹配目标试片 ID");
  assert(result.meta.dataQuality.totalHistoryTiles === 10, `历史数据量为 10 (实际 ${result.meta.dataQuality.totalHistoryTiles})`);
  assert(result.meta.dataQuality.hasScore === true, "目标试片有评分");
  assert(result.meta.dataQuality.hasRecipe === true, "目标试片有配方");
  assert(result.meta.dataQuality.hasPeakTemp === true, "目标试片有峰值温度");
  assert(result.meta.dataQuality.hasDefects === true, "目标试片有缺陷标签");
  assert(result.meta.dataQuality.recipeParseable === true, "目标试片配方可解析");
  assertHas(result, "targetTile.parsedIngredients", "目标试片有解析后的原料成分");
  assert(Array.isArray(result.targetTile.parsedIngredients), "parsedIngredients 是数组");
  assert(result.targetTile.parsedIngredients.length === 4, `解析出 4 种原料 (实际 ${result.targetTile.parsedIngredients.length})`);
  assertHas(result, "overallSummary.scoreLevel", "包含评分等级");
  assertEq(result.overallSummary.scoreLevel, "fail", "52 分属于 fail 等级");
  assert(Array.isArray(result.overallSummary.keyPoints), "keyPoints 是数组");
  assert(result.overallSummary.keyPoints.length > 0, "keyPoints 非空");
  assert(Array.isArray(result.overallSummary.priorityActions), "priorityActions 是数组");
  assertHas(result, "similarSuccessfulTiles.count", "包含相似样片计数");
  assert(result.similarSuccessfulTiles.count > 0, `至少找到 1 个相似样片 (实际 ${result.similarSuccessfulTiles.count})`);
  const topTile = result.similarSuccessfulTiles.tiles[0];
  assert(topTile && Number(topTile.tile.score) >= 75, `最高分相似样片评分 ≥ 75 (实际 ${topTile?.tile.score})`);
  assert(topTile && typeof topTile.similarityScore === "number", "相似样片有相似度分数");
  assert(Array.isArray(topTile.reasons) && topTile.reasons.length > 0, "相似样片有匹配原因说明");
  assertHas(result, "riskFactors.risks", "包含风险因素列表");
  assert(result.riskFactors.risks.length > 0, "风险因素列表非空");
  const hasDanger = result.riskFactors.risks.some(r => r.level === "danger");
  const hasWarning = result.riskFactors.risks.some(r => r.level === "warning");
  assert(hasDanger || hasWarning, "至少存在 1 项高/中风险因素");
  const firingRisks = result.riskFactors.risks.filter(r => r.category === "firing");
  assert(firingRisks.length > 0, `识别到烧成风险 (峰值温度1280偏高) (实际 ${firingRisks.length})`);
  assertHas(result, "recipeRecommendations", "包含配方推荐");
  assert(result.recipeRecommendations.count > 0, "有配方调整建议 (流釉→长石减/石英增，针孔→高岭增/长石减)");
  const feldsparRec = result.recipeRecommendations.recommendations.find(
    r => r.ingredient === "长石" && r.direction === "decrease"
  );
  assert(feldsparRec, "包含降低长石比例的建议（针对流釉缺陷）");
  const silicaRec = result.recipeRecommendations.recommendations.find(
    r => r.ingredient === "石英" && r.direction === "increase"
  );
  assert(silicaRec, "包含提升石英比例的建议（针对流釉缺陷）");
  assertHas(result, "firingRecommendations", "包含烧成推荐");
  assert(result.firingRecommendations.count > 0, "有烧成参数调整建议");
  const peakTempRec = result.firingRecommendations.recommendations.find(
    r => r.param === "peakTemp" && r.direction === "decrease"
  );
  assert(peakTempRec, "包含降低峰值温度的建议（针对流釉）");
  assert(peakTempRec && peakTempRec.defectRelated === "流釉", "峰值温度建议关联到流釉缺陷");
  assertHas(result, "defectPatterns.currentDefects", "包含缺陷模式分析");
  assert(result.defectPatterns.currentDefects.length === 2, "分析到 2 种缺陷：流釉、针孔");
  const defectNames = result.defectPatterns.currentDefects.map(d => d.name);
  assert(defectNames.includes("流釉"), "包含流釉缺陷");
  assert(defectNames.includes("针孔"), "包含针孔缺陷");
  assert(Array.isArray(result.defectPatterns.cooccurrenceRisk), "有共现风险分析");
  assert(Array.isArray(result.allEvidence), "allEvidence 为数组");
  assert(result.allEvidence.length > 0, "有完整的依据溯源记录");
  const defectRuleEvidence = result.allEvidence.find(e => e.rule && e.rule.startsWith("DEFECT_REMEDY_RULES"));
  assert(defectRuleEvidence, "能追踪到缺陷整改知识库依据");
  console.log("");
})();

await (async function testDirectReviewWithSparseDb() {
  console.log("场景2: 数据稀疏 - 仅2片历史，灰源/窑炉/峰值温度/配方多缺失");
  const db = buildSparseTestDb();
  const modulePath = fileUrl("lib/experiment-review.js");
  const mod = await import(modulePath + "?t=sparse1");
  const generateExperimentReview = mod.generateExperimentReview;
  const result = generateExperimentReview(db, "AG-SPARSE-001");
  assert(!result.error, "稀疏数据下生成推荐不报错");
  assert(result.meta.dataQuality.totalHistoryTiles === 2, `历史数据量=2 (实际 ${result.meta.dataQuality.totalHistoryTiles})`);
  assert(result.meta.dataQuality.hasAshSource === false, "检测到灰源缺失");
  assert(result.meta.dataQuality.hasKiln === false, "检测到窑炉缺失");
  assert(result.meta.dataQuality.hasPeakTemp === false, "检测到峰值温度缺失");
  assert(result.meta.dataQuality.warnings.length >= 3, `至少3条数据质量警告 (实际 ${result.meta.dataQuality.warnings.length})`);
  const historyWarn = result.meta.dataQuality.warnings.find(w => w.includes("数据量较小"));
  assert(historyWarn, "包含数据稀疏警告");
  const ashWarn = result.meta.dataQuality.warnings.find(w => w.includes("灰源信息缺失"));
  assert(ashWarn, "包含灰源缺失警告");
  const peakWarn = result.meta.dataQuality.warnings.find(w => w.includes("峰值温度缺失"));
  assert(peakWarn, "包含峰值温度缺失警告");
  const firingRecs = result.firingRecommendations.recommendations;
  const metaFiring = firingRecs.find(r => r.action === "meta");
  assert(metaFiring, "峰值缺失时烧成建议返回 meta 信息提示补充数据");
  const recipeRecs = result.recipeRecommendations.recommendations;
  const hasDefectRule = recipeRecs.some(r => r.defectRelated === "流釉");
  assert(hasDefectRule, "有缺陷仍能基于知识库给出配方整改建议");
  assert(result.similarSuccessfulTiles.count === 0, "稀疏数据下相似成功样片数为0（无高分）");
  const notes = result.similarSuccessfulTiles.notes;
  assert(Array.isArray(notes) && notes.length > 0, "给出了数据稀疏备注说明");
  console.log("");
})();

await (async function testDirectReviewUnparseableRecipe() {
  console.log("场景3: 配方文本无法解析（原料无百分比）");
  const db = buildUnparseableRecipeDb();
  const modulePath = fileUrl("lib/experiment-review.js");
  const mod = await import(modulePath + "?t=up1");
  const generateExperimentReview = mod.generateExperimentReview;
  const result = generateExperimentReview(db, "AG-UP-001");
  assert(!result.error, "配方不解析仍不报错");
  assert(result.meta.dataQuality.recipeParseable === false, "正确检测到配方不可解析");
  const parseWarn = result.meta.dataQuality.warnings.find(w => w.includes("配方文本格式不规范"));
  assert(parseWarn, "包含配方格式不规范警告");
  const recipeRisks = result.riskFactors.risks.filter(r => r.category === "recipe");
  assert(recipeRisks.length > 0, "识别到配方解析风险");
  const recipeRecs = result.recipeRecommendations.recommendations;
  const metaRecipe = recipeRecs.find(r => r.action === "meta");
  assert(metaRecipe, "配方不可解析时给出 meta 建议提示补充标准格式");
  assert(result.firingRecommendations.count > 0, "配方不可解析仍可给出烧成建议（缺陷: 针孔）");
  assert(result.defectPatterns.currentDefects.length === 1, "缺陷模式分析正常运行");
  console.log("");
})();

await (async function testDirectReviewNotFound() {
  console.log("场景4: 试片不存在时的错误处理");
  const db = buildFullTestDb();
  const modulePath = fileUrl("lib/experiment-review.js");
  const mod = await import(modulePath + "?t=nf1");
  const generateExperimentReview = mod.generateExperimentReview;
  const result = generateExperimentReview(db, "AG-NOT-EXIST");
  assert(result.error === "tile_not_found", "返回 tile_not_found 错误");
  assert(typeof result.message === "string" && result.message.length > 0, "有错误描述信息");
  console.log("");
})();

await (async function testDirectReviewByTileObject() {
  console.log("场景5: 直接传入试片对象（非ID）生成推荐");
  const db = buildFullTestDb();
  const modulePath = fileUrl("lib/experiment-review.js");
  const mod = await import(modulePath + "?t=obj1");
  const generateExperimentReview = mod.generateExperimentReview;
  const virtualTile = {
    id: "VIRTUAL-001",
    body: "粗陶坯",
    recipe: "松灰48 长石32 石英16 红土4",
    ashSource: "南山松灰",
    kiln: "K-2",
    peakTemp: 1275,
    color: "暗褐",
    defects: "明显气泡 釉面不平",
    defectTags: [
      { name: "气泡", severity: "medium", note: "" },
      { name: "橘皮", severity: "medium", note: "" }
    ],
    score: 55
  };
  const result = generateExperimentReview(db, virtualTile);
  assert(!result.error, "传入对象方式不报错");
  assertEq(result.targetTile.id, "VIRTUAL-001", "目标试片ID匹配");
  assert(result.similarSuccessfulTiles.count > 0, "传入对象时可找到相似高分样片");
  const bubbleRec = result.recipeRecommendations.recommendations.find(r => r.defectRelated === "气泡");
  assert(bubbleRec, "针对气泡缺陷给出配方建议");
  const orangePeelRec = result.firingRecommendations.recommendations.find(r => r.defectRelated === "橘皮");
  assert(orangePeelRec, "针对橘皮缺陷给出烧成建议");
  const defectNames = result.defectPatterns.currentDefects.map(d => d.name);
  assert(defectNames.includes("气泡") && defectNames.includes("橘皮"), "识别到气泡和橘皮两种缺陷");
  console.log("");
})();

// ---- HTTP API 级集成测试 ----

console.log("【HTTP API 集成测试】\n");

await (async function testHttpGetReview() {
  console.log("HTTP 场景1: GET /tiles/:id/review 完整功能");
  const ctx = await startServerWrap(buildFullTestDb());
  try {
    const res = await httpRequest("GET", "/tiles/AG-LS-001/review?topSimilar=6&minSimilarity=20", undefined, ctx.port);
    assertEq(res.status, 200, "HTTP 状态码 200");
    assert(res.body.meta && res.body.meta.tileId === "AG-LS-001", "响应 meta.tileId 正确");
    assert(res.body.similarSuccessfulTiles && res.body.similarSuccessfulTiles.count > 0, "返回相似样片");
    assert(res.body.recipeRecommendations && res.body.recipeRecommendations.count > 0, "返回配方建议");
    assert(res.body.firingRecommendations && res.body.firingRecommendations.count > 0, "返回烧成建议");
    assert(res.body.allEvidence && Array.isArray(res.body.allEvidence), "返回完整依据");
  } finally {
    ctx.stop();
    await cleanupTestDir();
  }
  console.log("");
})();

await (async function testHttpGetReviewNotFound() {
  console.log("HTTP 场景2: GET /tiles/:id/review 试片不存在");
  const ctx = await startServerWrap(buildFullTestDb());
  try {
    const res = await httpRequest("GET", "/tiles/AG-NOT-EXIST/review", undefined, ctx.port);
    assertEq(res.status, 404, "HTTP 状态码 404");
    assert(res.body.error === "tile_not_found", "返回 tile_not_found 错误");
  } finally {
    ctx.stop();
    await cleanupTestDir();
  }
  console.log("");
})();

await (async function testHttpPostReviewByTileId() {
  console.log("HTTP 场景3: POST /tiles/review 通过 tileId");
  const ctx = await startServerWrap(buildFullTestDb());
  try {
    const res = await httpRequest("POST", "/tiles/review", {
      tileId: "AG-LS-002",
      topSimilar: 5,
      minSimilarity: 25
    }, ctx.port);
    assertEq(res.status, 200, "POST tileId 状态码 200");
    assert(res.body.targetTile && res.body.targetTile.id === "AG-LS-002", "目标试片 ID 正确 (低分无光试片)");
    assert(res.body.targetTile.defectNames.length >= 2, "识别到无光、橘皮至少2种缺陷");
    const noLightRec = resultBodyNoLight(res.body);
    assert(noLightRec, "无光缺陷有配方建议：增加长石和灰量");
  } finally {
    ctx.stop();
    await cleanupTestDir();
  }
  console.log("");
})();

await (async function testHttpPostReviewByTileObject() {
  console.log("HTTP 场景4: POST /tiles/review 通过 tile 对象（含开裂/缩釉缺陷）");
  const ctx = await startServerWrap(buildFullTestDb());
  try {
    const res = await httpRequest("POST", "/tiles/review", {
      tile: {
        id: "ONLINE-001",
        body: "粗陶坯",
        recipe: "松灰46 长石30 石英18 红土6",
        ashSource: "北山松灰",
        kiln: "K-3",
        peakTemp: 1265,
        color: "酱褐",
        defects: "缩釉，坯体开裂",
        defectTags: [
          { name: "缩釉", severity: "medium", note: "" },
          { name: "开裂", severity: "severe", note: "坯裂" }
        ],
        score: 48
      },
      topSimilar: 3
    }, ctx.port);
    assertEq(res.status, 200, "POST tile 对象状态码 200");
    const crackRec = res.body.recipeRecommendations.recommendations.find(
      r => r.defectRelated === "开裂" && r.ingredient === "红土"
    );
    assert(crackRec, "针对开裂给出红土减量建议");
    const crawlRec = res.body.recipeRecommendations.recommendations.find(
      r => r.defectRelated === "缩釉" && r.ingredient === "高岭"
    );
    assert(crawlRec, "针对缩釉给出高岭增量建议");
    const heatingRateRec = res.body.firingRecommendations.recommendations.find(
      r => r.defectRelated === "开裂" && r.param === "heatingRate"
    );
    assert(heatingRateRec, "针对开裂给出低温放慢升温速率建议");
    assert(res.body.overallSummary.urgentActions.length > 0, "严重缺陷触发紧急行动建议");
  } finally {
    ctx.stop();
    await cleanupTestDir();
  }
  console.log("");
})();

await (async function testHttpPostReviewMissingInput() {
  console.log("HTTP 场景5: POST /tiles/review 输入校验（缺失字段）");
  const ctx = await startServerWrap(buildFullTestDb());
  try {
    const res = await httpRequest("POST", "/tiles/review", {}, ctx.port);
    assertEq(res.status, 400, "空输入返回 400");
    assert(res.body.error === "missing_input", "返回 missing_input 错误");
    const res2 = await httpRequest("POST", "/tiles/review", { tile: { score: 60 } }, ctx.port);
    assertEq(res2.status, 400, "tile对象缺少 body/recipe 返回 400");
    assert(res2.body.error === "invalid_tile", "返回 invalid_tile 错误");
  } finally {
    ctx.stop();
    await cleanupTestDir();
  }
  console.log("");
})();

await (async function testHttpSparseDataEndpoints() {
  console.log("HTTP 场景6: 稀疏数据场景 - GET + POST 端点均正常");
  const ctx = await startServerWrap(buildSparseTestDb());
  try {
    const getRes = await httpRequest("GET", "/tiles/AG-SPARSE-001/review", undefined, ctx.port);
    assertEq(getRes.status, 200, "GET 稀疏数据状态码 200");
    assert(getRes.body.meta.dataQuality.warnings.length >= 3, "稀疏数据警告齐全");
    const postRes = await httpRequest("POST", "/tiles/review", {
      tile: {
        id: "VIRT-SPARSE",
        body: "粗陶坯",
        recipe: "松灰40 长石35 石英20 红土5",
        defects: "色差明显",
        defectTags: [{ name: "色差", severity: "medium", note: "" }],
        score: 62
      }
    }, ctx.port);
    assertEq(postRes.status, 200, "POST 稀疏DB状态码 200");
    const colorDiffRec = postRes.body.recipeRecommendations.recommendations.find(r => r.defectRelated === "色差");
    assert(colorDiffRec, "在稀疏数据下仍能通过缺陷知识库给出色差整改建议");
  } finally {
    ctx.stop();
    await cleanupTestDir();
  }
  console.log("");
})();

// ---- 核心模块函数测试 ----

console.log("【核心辅助函数测试】\n");

await (async function testDefectRulesCoverage() {
  console.log("缺陷规则库完整性检查");
  const modulePath = fileUrl("lib/experiment-review.js");
  const mod = await import(modulePath + "?t=rules1");
  const DEFECT_REMEDY_RULES = mod.DEFECT_REMEDY_RULES;
  const DEFECT_CATALOG = (await import(
    fileUrl("lib/defect-validate.js") + "?t=cat1"
  )).DEFECT_CATALOG;
  for (const d of DEFECT_CATALOG) {
    const hasRule = !!DEFECT_REMEDY_RULES[d.name];
    assert(hasRule, `缺陷 ${d.name} 有整改规则`);
    if (hasRule) {
      const rule = DEFECT_REMEDY_RULES[d.name];
      assert(typeof rule.note === "string" && rule.note.length > 0, `缺陷 ${d.name} 有提示说明 note`);
      assert(Array.isArray(rule.recipe), `缺陷 ${d.name} recipe 字段为数组`);
      assert(Array.isArray(rule.firing), `缺陷 ${d.name} firing 字段为数组`);
      assert(rule.recipe.length + rule.firing.length > 0, `缺陷 ${d.name} 至少1条整改建议`);
    }
  }
  console.log("");
})();

await (async function testGetTileDefectsNormalize() {
  console.log("缺陷提取标准化测试");
  const modulePath = fileUrl("lib/experiment-review.js");
  const mod = await import(modulePath + "?t=def1");
  const getTileDefects = mod.getTileDefects;
  const r1 = getTileDefects({ defectTags: [{ name: "针孔", severity: "mild" }, { name: "流釉", severity: "severe" }], defects: "" });
  assertEq(r1, ["针孔", "流釉"], "优先使用 defectTags");
  const r2 = getTileDefects({ defectTags: [], defects: "轻微针孔，大面积流釉" });
  assert(r2.includes("针孔"), "defectText 可解析出针孔");
  assert(r2.includes("流釉"), "defectText 可解析出流釉");
  const r3 = getTileDefects({ defectTags: null, defects: undefined });
  assertEq(r3, [], "无缺陷数据返回空数组");
  console.log("");
})();

await (async function testParseFiringInput() {
  console.log("烧成参数从曲线解析测试");
  const modulePath = fileUrl("lib/experiment-review.js");
  const mod = await import(modulePath + "?t=fi1");
  const parseFiringInputFromTile = mod.parseFiringInputFromTile;
  const tile = {
    peakTemp: 1240,
    kiln: "K-2",
    firingCurve: [
      { temp: 25, minutes: 0 },
      { temp: 600, minutes: 180 },
      { temp: 900, minutes: 300 },
      { temp: 1240, minutes: 510 },
      { temp: 1240, minutes: 545 }
    ]
  };
  const r = parseFiringInputFromTile(tile);
  assertEq(r.peakTemp, 1240, "峰值温度正确");
  assertEq(r.kiln, "K-2", "窑炉正确");
  assertEq(r.holdMinutes, 35, "保温时间 545-510 = 35 分钟");
  assert(r.heatingStages.length >= 3, "至少 3 段升温阶段");
  console.log("");
})();

// ---- 汇总输出 ----
console.log("\n==================== 测试汇总 ====================");
console.log(`  通过: ${passed}`);
console.log(`  失败: ${failed}`);
if (failures.length > 0) {
  console.log("\n失败详情:");
  failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  process.exit(1);
} else {
  console.log("\n✅ 全部测试通过！");
  process.exit(0);
}

// ==================== helper 函数 ====================

function resultBodyNoLight(body) {
  if (!body || !body.recipeRecommendations) return false;
  return body.recipeRecommendations.recommendations.some(
    r => r.defectRelated === "无光" && (r.ingredient === "长石" || r.ingredient === "灰")
  );
}

async function startServerWrap(dbData, usePort) {
  const testPort = usePort || nextPort();
  await setupTestDb(dbData);
  process._servers = process._servers || {};
  const key = `srv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  let server;
  const modKey = key;
  const { createServer } = await import("node:http");
  const { loadDb } = await import(fileUrl("lib/db.js") + "?t=db" + modKey);
  const routesMod = await import(fileUrl("lib/routes.js") + "?t=rt" + modKey);
  const appHandler = async function (req, res) {
    const send = (status, data) => {
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(data, null, 2));
    };
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const db = await loadDb();
      if (req.method === "GET" && url.pathname === "/") return send(200, routesMod.routesInfo());
      if (req.method === "POST" && url.pathname === "/tiles/review") {
        const input = await routesMod.readJsonBody(req);
        const r = await routesMod.handlePostExperimentReview(input, db);
        return send(r.status, r.data);
      }
      const tileReviewMatch = url.pathname.match(/^\/tiles\/([^/]+)\/review$/);
      if (tileReviewMatch && req.method === "GET") {
        const r = await routesMod.handleGetExperimentReview(tileReviewMatch[1], url, db);
        return send(r.status, r.data);
      }
      send(404, { error: "not_found", inTests: true, path: url.pathname });
    } catch (err) {
      send(500, { error: "server_error", message: String(err), stack: err.stack });
    }
  };
  await new Promise((resolve) => {
    server = createServer(appHandler);
    server.listen(testPort, () => resolve());
    process._servers[key] = server;
  });
  return {
    port: testPort,
    baseUrl: `http://localhost:${testPort}`,
    stop: () => {
      try { server.close(); } catch (_) {}
      delete process._servers[key];
    },
  };
}
