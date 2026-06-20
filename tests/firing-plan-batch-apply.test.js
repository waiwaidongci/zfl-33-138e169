import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(__dirname);
const testDir = join(projectRoot, "tests", "tmp-batch-apply");
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

const testData = {
  schemaVersion: 2,
  migrations: [
    { version: 1, name: "introduce-schema-version", appliedAt: "2026-06-20T13:00:13.852Z" },
    { version: 2, name: "add-tile-status-fields", appliedAt: "2026-06-20T13:00:13.852Z" }
  ],
  collections: {
    tiles: [
      {
        id: "AG-EXISTING-001",
        body: "细瓷坯",
        recipe: "松灰40 长石40 石英18 红土2",
        ashSource: "南山松灰",
        glazeThickness: "0.6mm",
        kiln: "",
        firingCurve: [],
        peakTemp: 1260,
        color: "",
        defects: "",
        defectTags: [],
        score: 0,
        observations: [],
        recipeVersionId: null,
        status: "draft",
        statusHistory: [{ from: null, to: "draft", operator: "migration", note: "数据迁移，初始状态推断为 '草稿'", at: "2026-06-20T13:00:13.852Z" }],
        batchId: null,
        inventoryDeducted: false
      },
      {
        id: "AG-EXISTING-002",
        body: "粗陶坯",
        recipe: "松灰42 长石35 石英18 红土5",
        ashSource: "南山松灰",
        glazeThickness: "0.8mm",
        kiln: "K-2",
        firingCurve: [{ temp: 25, minutes: 0 }, { temp: 1240, minutes: 540 }],
        peakTemp: 1240,
        color: "青灰",
        defects: "",
        defectTags: [],
        score: 0,
        observations: [],
        recipeVersionId: null,
        status: "pending_firing",
        statusHistory: [{ from: null, to: "pending_firing", operator: "migration", note: "数据迁移", at: "2026-06-20T13:00:13.852Z" }],
        batchId: null,
        inventoryDeducted: false
      },
      {
        id: "AG-EXISTING-003",
        body: "粗陶坯",
        recipe: "竹灰42 长石35 石英18 红土5",
        ashSource: "莫干山竹灰",
        glazeThickness: "0.7mm",
        kiln: "",
        firingCurve: [],
        peakTemp: 1250,
        color: "",
        defects: "",
        defectTags: [],
        score: 0,
        observations: [],
        recipeVersionId: null,
        status: "draft",
        statusHistory: [{ from: null, to: "draft", operator: "migration", note: "数据迁移", at: "2026-06-20T13:00:13.852Z" }],
        batchId: "BATCH-EXISTING",
        inventoryDeducted: false
      }
    ],
    firingPlans: [
      {
        id: "FP-TEST-BATCH-001",
        name: "K-2标准1240℃松灰釉",
        status: "draft",
        kiln: "K-2",
        peakTemp: 1240,
        holdMinutes: 35,
        heatingStages: [],
        firingCurve: [
          { temp: 25, minutes: 0 },
          { temp: 600, minutes: 192 },
          { temp: 900, minutes: 312 },
          { temp: 1100, minutes: 412 },
          { temp: 1240, minutes: 496 },
          { temp: 1240, minutes: 531 }
        ],
        totalDurationMinutes: 531,
        heatingRates: [
          { from: 25, to: 600, rateCelsiusPerHour: 180 },
          { from: 600, to: 900, rateCelsiusPerHour: 150 },
          { from: 900, to: 1100, rateCelsiusPerHour: 120 },
          { from: 1100, to: 1240, rateCelsiusPerHour: 100 }
        ],
        risks: [
          { level: "warning", code: "INITIAL_HEATING_FAST", message: "低温阶段升温速率 180℃/h 偏快" },
          { level: "info", code: "USING_DEFAULT_STAGES", message: "使用默认三段升温曲线" }
        ],
        riskCount: { danger: 0, warning: 1, info: 1 },
        similarCurves: [],
        notes: "测试用标准曲线",
        createdAt: "2026-06-20",
        updatedAt: "2026-06-20",
        appliedTileId: null
      },
      {
        id: "FP-TEST-BATCH-002",
        name: "K-3高温1280℃实验",
        status: "applied",
        kiln: "K-3",
        peakTemp: 1280,
        holdMinutes: 40,
        heatingStages: [],
        firingCurve: [{ temp: 25, minutes: 0 }, { temp: 1280, minutes: 600 }],
        totalDurationMinutes: 600,
        heatingRates: [],
        risks: [],
        riskCount: { danger: 0, warning: 0, info: 0 },
        similarCurves: [],
        notes: "已应用的规划",
        createdAt: "2026-06-19",
        updatedAt: "2026-06-19",
        appliedBatchId: "BATCH-APPLIED",
        appliedTileIds: ["AG-001"]
      }
    ],
    recipes: [],
    recipeVersions: [],
    batches: [
      {
        id: "BATCH-EXISTING",
        name: "已存在的批次",
        kiln: "K-1",
        plannedDate: "2026-06-18",
        targetAtmosphere: "氧化",
        tileIds: ["AG-EXISTING-003"],
        status: "planned",
        observations: [],
        createdAt: "2026-06-18",
        updatedAt: "2026-06-18"
      }
    ],
    materialStocks: [
      { id: "MAT-001", name: "松灰", batchNo: "SG-2026-001", quantity: 50, unit: "kg", entryDate: "2026-05-15", reorderThreshold: 10 },
      { id: "MAT-002", name: "长石", batchNo: "CS-2026-001", quantity: 80, unit: "kg", entryDate: "2026-05-20", reorderThreshold: 10 },
      { id: "MAT-003", name: "石英", batchNo: "SY-2026-001", quantity: 60, unit: "kg", entryDate: "2026-05-22", reorderThreshold: 10 },
      { id: "MAT-004", name: "红土", batchNo: "HT-2026-001", quantity: 30, unit: "kg", entryDate: "2026-06-01", reorderThreshold: 10 },
      { id: "MAT-005", name: "稻灰", batchNo: "DG-2026-001", quantity: 0.5, unit: "kg", entryDate: "2026-06-10", reorderThreshold: 10 }
    ]
  }
};

async function setupTestEnv() {
  await rm(testDir, { recursive: true, force: true });
  await mkdir(testBackupDir, { recursive: true });
  delete process.env.ASH_GLAZE_MIGRATIONS_DIR;
}

async function setupTestDb() {
  await writeFile(testDbPath, JSON.stringify(testData, null, 2));
}

async function cleanupTestEnv() {
  await rm(testDir, { recursive: true, force: true });
}

async function test1_batch_apply_create_new_tiles() {
  console.log("\nTest 1: 一键生成批次 - 创建新试片");

  await setupTestDb();
  const { loadDb, getCollections } = await import("../lib/db.js");
  const { handleApplyPlan } = await import("../lib/routes.js");
  const { TILE_STATUSES } = await import("../lib/tile-status-machine.js");

  const db = await loadDb();
  const coll = getCollections(db);

  const initialStockSG = coll.materialStocks.find(s => s.batchNo === "SG-2026-001").quantity;
  const initialStockCS = coll.materialStocks.find(s => s.batchNo === "CS-2026-001").quantity;
  const initialStockSY = coll.materialStocks.find(s => s.batchNo === "SY-2026-001").quantity;
  const initialStockHT = coll.materialStocks.find(s => s.batchNo === "HT-2026-001").quantity;

  const result = await handleApplyPlan("FP-TEST-BATCH-001", {
    applyMode: "batch",
    batchName: "测试批次-新建试片",
    plannedDate: "2026-06-25",
    targetAtmosphere: "还原",
    operator: "test_user",
    tiles: [
      {
        id: "AG-BATCH-NEW-001",
        body: "粗陶坯",
        recipe: "松灰42 长石35 石英18 红土5",
        ashSource: "南山松灰",
        glazeThickness: "0.8mm",
        materialBatchRefs: [
          { ingredientName: "松灰", batchNo: "SG-2026-001" },
          { ingredientName: "长石", batchNo: "CS-2026-001" },
          { ingredientName: "石英", batchNo: "SY-2026-001" },
          { ingredientName: "红土", batchNo: "HT-2026-001" }
        ],
        batchWeight: 10
      },
      {
        id: "AG-BATCH-NEW-002",
        body: "细瓷坯",
        recipe: "松灰50 长石30 石英20",
        ashSource: "南山松灰",
        glazeThickness: "0.6mm",
        materialBatchRefs: [
          { ingredientName: "松灰", batchNo: "SG-2026-001" },
          { ingredientName: "长石", batchNo: "CS-2026-001" },
          { ingredientName: "石英", batchNo: "SY-2026-001" }
        ],
        batchWeight: 5
      }
    ]
  }, db);

  assertEq(result.status, 201, "批次创建成功，返回 201");
  assert(result.data.batch !== undefined, "返回批次信息");
  assertEq(result.data.batch.name, "测试批次-新建试片", "批次名称正确");
  assertEq(result.data.batch.plannedDate, "2026-06-25", "计划日期正确");
  assertEq(result.data.batch.targetAtmosphere, "还原", "目标气氛正确");
  assertEq(result.data.batch.kiln, "K-2", "窑炉编号来自规划");
  assertEq(result.data.batch.status, "planned", "批次状态为 planned");
  assertEq(result.data.batch.tileIds.length, 2, "批次包含 2 个试片");
  assert(result.data.batch.tileIds.includes("AG-BATCH-NEW-001"), "批次包含 AG-BATCH-NEW-001");
  assert(result.data.batch.tileIds.includes("AG-BATCH-NEW-002"), "批次包含 AG-BATCH-NEW-002");

  assertEq(result.data.tiles.length, 2, "返回 2 个试片");

  const tile1 = result.data.tiles.find(t => t.id === "AG-BATCH-NEW-001");
  assert(tile1 !== undefined, "AG-BATCH-NEW-001 存在");
  assertEq(tile1.status, TILE_STATUSES.PENDING_FIRING, "试片1状态为待烧成");
  assertEq(tile1.batchId, result.data.batch.id, "试片1关联正确的批次");
  assert(tile1.inventoryDeducted === true, "试片1库存已扣减");
  assertEq(tile1.fromPlanId, "FP-TEST-BATCH-001", "试片1关联规划");
  assertEq(tile1.firingCurve.length, 6, "试片1有完整的烧成曲线");
  assertEq(tile1.peakTemp, 1240, "试片1峰值温度来自规划");

  const tile2 = result.data.tiles.find(t => t.id === "AG-BATCH-NEW-002");
  assert(tile2 !== undefined, "AG-BATCH-NEW-002 存在");
  assertEq(tile2.status, TILE_STATUSES.PENDING_FIRING, "试片2状态为待烧成");

  const plan = coll.firingPlans.find(p => p.id === "FP-TEST-BATCH-001");
  assertEq(plan.status, "applied", "规划状态更新为 applied");
  assertEq(plan.appliedBatchId, result.data.batch.id, "规划记录 appliedBatchId");
  assertEq(plan.appliedTileIds.length, 2, "规划记录 appliedTileIds");

  const finalStockSG = coll.materialStocks.find(s => s.batchNo === "SG-2026-001").quantity;
  const finalStockCS = coll.materialStocks.find(s => s.batchNo === "CS-2026-001").quantity;
  const finalStockSY = coll.materialStocks.find(s => s.batchNo === "SY-2026-001").quantity;
  const finalStockHT = coll.materialStocks.find(s => s.batchNo === "HT-2026-001").quantity;

  assertEq(finalStockSG, Number((initialStockSG - 4.2 - 2.5).toFixed(2)), "松灰库存扣减正确：10kg×42% + 5kg×50% = 4.2+2.5=6.7");
  assertEq(finalStockCS, Number((initialStockCS - 3.5 - 1.5).toFixed(2)), "长石库存扣减正确：10kg×35% + 5kg×30% = 3.5+1.5=5.0");
  assertEq(finalStockSY, Number((initialStockSY - 1.8 - 1.0).toFixed(2)), "石英库存扣减正确：10kg×18% + 5kg×20% = 1.8+1.0=2.8");
  assertEq(finalStockHT, Number((initialStockHT - 0.5).toFixed(2)), "红土库存扣减正确：10kg×5% = 0.5");

  assert(result.data.transitions.length === 2, "有 2 个状态转换记录");
  for (const trans of result.data.transitions) {
    assertEq(trans.from, TILE_STATUSES.DRAFT, "转换起点为草稿");
    assertEq(trans.to, TILE_STATUSES.PENDING_FIRING, "转换终点为待烧成");
    assert(trans.statusRecord.operator === "test_user", "操作人正确");
  }
}

async function test2_batch_apply_associate_existing_tiles() {
  console.log("\nTest 2: 一键生成批次 - 关联现有试片");

  await setupTestDb();
  const { loadDb, getCollections } = await import("../lib/db.js");
  const { handleApplyPlan } = await import("../lib/routes.js");
  const { TILE_STATUSES } = await import("../lib/tile-status-machine.js");

  const db = await loadDb();

  const result = await handleApplyPlan("FP-TEST-BATCH-001", {
    applyMode: "batch",
    batchName: "测试批次-关联试片",
    plannedDate: "2026-06-26",
    targetAtmosphere: "氧化",
    operator: "test_user",
    tiles: [
      {
        tileId: "AG-EXISTING-001",
        materialBatchRefs: [
          { ingredientName: "松灰", batchNo: "SG-2026-001" },
          { ingredientName: "长石", batchNo: "CS-2026-001" },
          { ingredientName: "石英", batchNo: "SY-2026-001" },
          { ingredientName: "红土", batchNo: "HT-2026-001" }
        ],
        batchWeight: 10
      }
    ]
  }, db);

  assertEq(result.status, 201, "关联现有试片成功，返回 201");
  assertEq(result.data.batch.tileIds.length, 1, "批次包含 1 个试片");
  assert(result.data.batch.tileIds.includes("AG-EXISTING-001"), "批次包含 AG-EXISTING-001");

  const tile = result.data.tiles.find(t => t.id === "AG-EXISTING-001");
  assert(tile !== undefined, "AG-EXISTING-001 存在");
  assertEq(tile.status, TILE_STATUSES.PENDING_FIRING, "现有试片状态推进到待烧成");
  assertEq(tile.batchId, result.data.batch.id, "现有试片关联批次");
  assert(tile.inventoryDeducted === true, "现有试片库存已扣减");
  assertEq(tile.firingCurve.length, 6, "现有试片获得规划的烧成曲线");
  assertEq(tile.peakTemp, 1240, "现有试片峰值温度更新为规划值");
  assertEq(tile.kiln, "K-2", "现有试片窑炉更新为规划值");
}

async function test3_batch_apply_insufficient_stock() {
  console.log("\nTest 3: 库存不足的错误处理");

  await setupTestDb();
  const { loadDb, getCollections } = await import("../lib/db.js");
  const { handleApplyPlan } = await import("../lib/routes.js");

  const db = await loadDb();
  const coll = getCollections(db);

  coll.materialStocks.find(s => s.batchNo === "SG-2026-001").quantity = 1;

  const result = await handleApplyPlan("FP-TEST-BATCH-001", {
    applyMode: "batch",
    batchName: "测试库存不足",
    plannedDate: "2026-06-25",
    targetAtmosphere: "氧化",
    tiles: [
      {
        body: "粗陶坯",
        recipe: "松灰42 长石35 石英18 红土5",
        materialBatchRefs: [
          { ingredientName: "松灰", batchNo: "SG-2026-001" },
          { ingredientName: "长石", batchNo: "CS-2026-001" },
          { ingredientName: "石英", batchNo: "SY-2026-001" },
          { ingredientName: "红土", batchNo: "HT-2026-001" }
        ],
        batchWeight: 10
      }
    ]
  }, db);

  assertEq(result.status, 400, "库存不足返回 400");
  assertEq(result.data.error, "tile_validation_failed", "错误类型正确");
  assert(result.data.errors.length > 0, "返回错误详情");
  assert(result.data.errors[0].error === "insufficient_stock", "错误类型为库存不足");
  assert(result.data.errors[0].message.includes("库存不足"), "错误消息包含库存不足");
}

async function test4_batch_apply_duplicate_plan() {
  console.log("\nTest 4: 重复应用规划的错误处理");

  await setupTestDb();
  const { loadDb } = await import("../lib/db.js");
  const { handleApplyPlan } = await import("../lib/routes.js");

  const db = await loadDb();

  const result = await handleApplyPlan("FP-TEST-BATCH-002", {
    applyMode: "batch",
    batchName: "测试重复应用",
    plannedDate: "2026-06-25",
    targetAtmosphere: "氧化",
    tiles: [
      { body: "粗陶坯", recipe: "松灰42 长石35 石英18 红土5" }
    ]
  }, db);

  assertEq(result.status, 409, "重复应用返回 409");
  assertEq(result.data.error, "plan_already_applied", "错误类型正确");
  assert(result.data.message.includes("不可重复应用"), "错误消息正确");
  assertEq(result.data.appliedBatchId, "BATCH-APPLIED", "返回已应用的批次 ID");
}

async function test5_batch_apply_invalid_tile_status() {
  console.log("\nTest 5: 试片状态不允许变更的错误处理");

  await setupTestDb();
  const { loadDb } = await import("../lib/db.js");
  const { handleApplyPlan } = await import("../lib/routes.js");

  const db = await loadDb();

  const result = await handleApplyPlan("FP-TEST-BATCH-001", {
    applyMode: "batch",
    batchName: "测试状态错误",
    plannedDate: "2026-06-25",
    targetAtmosphere: "氧化",
    tiles: [
      { tileId: "AG-EXISTING-002" }
    ]
  }, db);

  assertEq(result.status, 400, "状态不允许返回 400");
  assertEq(result.data.error, "tile_validation_failed", "错误类型正确");
  assert(result.data.errors[0].error === "invalid_tile_status", "错误类型为状态无效");
  assert(result.data.errors[0].message.includes("仅草稿状态可加入批次"), "错误消息正确");
  assertEq(result.data.errors[0].currentStatus, "pending_firing", "返回当前状态");
}

async function test6_batch_apply_tile_already_in_batch() {
  console.log("\nTest 6: 试片已属于其他批次的错误处理");

  await setupTestDb();
  const { loadDb } = await import("../lib/db.js");
  const { handleApplyPlan } = await import("../lib/routes.js");

  const db = await loadDb();

  const result = await handleApplyPlan("FP-TEST-BATCH-001", {
    applyMode: "batch",
    batchName: "测试批次重复",
    plannedDate: "2026-06-25",
    targetAtmosphere: "氧化",
    tiles: [
      { tileId: "AG-EXISTING-003" }
    ]
  }, db);

  assertEq(result.status, 400, "试片已属于其他批次返回 400");
  assertEq(result.data.error, "tile_validation_failed", "错误类型正确");
  assert(result.data.errors[0].error === "tile_already_in_batch", "错误类型为已在批次中");
  assertEq(result.data.errors[0].existingBatchId, "BATCH-EXISTING", "返回现有批次 ID");
}

async function test7_batch_apply_missing_fields() {
  console.log("\nTest 7: 缺少必填字段的错误处理");

  await setupTestDb();
  const { loadDb } = await import("../lib/db.js");
  const { handleApplyPlan } = await import("../lib/routes.js");

  const db = await loadDb();

  const result1 = await handleApplyPlan("FP-TEST-BATCH-001", {
    applyMode: "batch",
    plannedDate: "2026-06-25",
    targetAtmosphere: "氧化",
    tiles: [{ body: "粗陶坯", recipe: "松灰42 长石35" }]
  }, db);

  assertEq(result1.status, 400, "缺少 batchName 返回 400");
  assertEq(result1.data.error, "missing_required", "错误类型正确");
  assert(result1.data.message.includes("batchName"), "错误消息包含 batchName");

  const result2 = await handleApplyPlan("FP-TEST-BATCH-001", {
    applyMode: "batch",
    batchName: "测试",
    targetAtmosphere: "氧化",
    tiles: [{ body: "粗陶坯", recipe: "松灰42 长石35" }]
  }, db);

  assertEq(result2.status, 400, "缺少 plannedDate 返回 400");
  assert(result2.data.message.includes("plannedDate"), "错误消息包含 plannedDate");

  const result3 = await handleApplyPlan("FP-TEST-BATCH-001", {
    applyMode: "batch",
    batchName: "测试",
    plannedDate: "2026-06-25",
    tiles: [{ body: "粗陶坯", recipe: "松灰42 长石35" }]
  }, db);

  assertEq(result3.status, 400, "缺少 targetAtmosphere 返回 400");
  assert(result3.data.message.includes("targetAtmosphere"), "错误消息包含 targetAtmosphere");

  const result4 = await handleApplyPlan("FP-TEST-BATCH-001", {
    applyMode: "batch",
    batchName: "测试",
    plannedDate: "2026-06-25",
    targetAtmosphere: "氧化",
    tiles: []
  }, db);

  assertEq(result4.status, 400, "空 tiles 数组返回 400");
  assert(result4.data.message.includes("tiles"), "错误消息包含 tiles");

  const result5 = await handleApplyPlan("FP-TEST-BATCH-001", {
    applyMode: "batch",
    batchName: "测试",
    plannedDate: "2026-06-25",
    targetAtmosphere: "氧化",
    tiles: [{ body: "粗陶坯" }]
  }, db);

  assertEq(result5.status, 400, "新试片缺少 recipe 返回 400");
  assert(result5.data.errors[0].message.includes("缺少 body 或 recipe"), "错误消息正确");
}

async function test8_batch_apply_mixed_new_and_existing() {
  console.log("\nTest 8: 混合新建和关联现有试片");

  await setupTestDb();
  const { loadDb, getCollections } = await import("../lib/db.js");
  const { handleApplyPlan } = await import("../lib/routes.js");
  const { TILE_STATUSES } = await import("../lib/tile-status-machine.js");

  const db = await loadDb();

  const result = await handleApplyPlan("FP-TEST-BATCH-001", {
    applyMode: "batch",
    batchName: "测试混合模式",
    plannedDate: "2026-06-27",
    targetAtmosphere: "还原",
    operator: "test_user",
    tiles: [
      {
        id: "AG-MIXED-NEW",
        body: "粗陶坯",
        recipe: "松灰42 长石35 石英18 红土5",
        ashSource: "南山松灰",
        glazeThickness: "0.8mm",
        materialBatchRefs: [
          { ingredientName: "松灰", batchNo: "SG-2026-001" },
          { ingredientName: "长石", batchNo: "CS-2026-001" },
          { ingredientName: "石英", batchNo: "SY-2026-001" },
          { ingredientName: "红土", batchNo: "HT-2026-001" }
        ],
        batchWeight: 10
      },
      {
        tileId: "AG-EXISTING-001",
        materialBatchRefs: [
          { ingredientName: "松灰", batchNo: "SG-2026-001" },
          { ingredientName: "长石", batchNo: "CS-2026-001" },
          { ingredientName: "石英", batchNo: "SY-2026-001" },
          { ingredientName: "红土", batchNo: "HT-2026-001" }
        ],
        batchWeight: 10
      }
    ]
  }, db);

  assertEq(result.status, 201, "混合模式成功，返回 201");
  assertEq(result.data.batch.tileIds.length, 2, "批次包含 2 个试片");
  assert(result.data.batch.tileIds.includes("AG-MIXED-NEW"), "包含新建试片");
  assert(result.data.batch.tileIds.includes("AG-EXISTING-001"), "包含现有试片");

  const newTile = result.data.tiles.find(t => t.id === "AG-MIXED-NEW");
  const existingTile = result.data.tiles.find(t => t.id === "AG-EXISTING-001");

  assertEq(newTile.status, TILE_STATUSES.PENDING_FIRING, "新建试片状态正确");
  assertEq(existingTile.status, TILE_STATUSES.PENDING_FIRING, "现有试片状态正确");
  assertEq(newTile.batchId, result.data.batch.id, "新建试片批次关联正确");
  assertEq(existingTile.batchId, result.data.batch.id, "现有试片批次关联正确");

  const coll = getCollections(db);
  const plan = coll.firingPlans.find(p => p.id === "FP-TEST-BATCH-001");
  assertEq(plan.status, "applied", "规划状态更新");
  assertEq(plan.appliedTileIds.length, 2, "规划记录 2 个试片");
}

async function test9_single_tile_apply_still_works() {
  console.log("\nTest 9: 原有单试片应用功能正常工作（向后兼容）");

  await setupTestDb();
  const { loadDb, getCollections } = await import("../lib/db.js");
  const { handleApplyPlan } = await import("../lib/routes.js");
  const { TILE_STATUSES } = await import("../lib/tile-status-machine.js");

  const db = await loadDb();

  const result = await handleApplyPlan("FP-TEST-BATCH-001", {
    id: "AG-SINGLE-TEST",
    body: "粗陶坯",
    recipe: "松灰42 长石35 石英18 红土5",
    ashSource: "南山松灰",
    glazeThickness: "0.8mm"
  }, db);

  assertEq(result.status, 201, "单试片应用成功，返回 201");
  assert(result.data.tile !== undefined, "返回试片信息");
  assertEq(result.data.tile.id, "AG-SINGLE-TEST", "试片 ID 正确");
  assertEq(result.data.tile.status, TILE_STATUSES.DRAFT, "单试片应用状态为草稿（原有行为）");
  assertEq(result.data.tile.fromPlanId, "FP-TEST-BATCH-001", "关联规划");
  assertEq(result.data.planId, "FP-TEST-BATCH-001", "返回规划 ID");

  const coll = getCollections(db);
  const plan = coll.firingPlans.find(p => p.id === "FP-TEST-BATCH-001");
  assertEq(plan.status, "applied", "规划状态更新为 applied");
  assertEq(plan.appliedTileId, "AG-SINGLE-TEST", "记录 appliedTileId");
}

async function test10_batch_apply_plan_not_found() {
  console.log("\nTest 10: 规划不存在的错误处理");

  await setupTestDb();
  const { loadDb } = await import("../lib/db.js");
  const { handleApplyPlan } = await import("../lib/routes.js");

  const db = await loadDb();

  const result = await handleApplyPlan("FP-NON-EXISTENT", {
    applyMode: "batch",
    batchName: "测试",
    plannedDate: "2026-06-25",
    targetAtmosphere: "氧化",
    tiles: [{ body: "粗陶坯", recipe: "松灰42 长石35" }]
  }, db);

  assertEq(result.status, 404, "规划不存在返回 404");
  assertEq(result.data.error, "plan_not_found", "错误类型正确");
}

async function test11_batch_apply_inventory_deduction_rollback() {
  console.log("\nTest 11: 部分试片验证失败时不扣减库存（原子性）");

  await setupTestDb();
  const { loadDb, getCollections } = await import("../lib/db.js");
  const { handleApplyPlan } = await import("../lib/routes.js");

  const db = await loadDb();
  const coll = getCollections(db);

  const initialStockSG = coll.materialStocks.find(s => s.batchNo === "SG-2026-001").quantity;
  const initialStockCS = coll.materialStocks.find(s => s.batchNo === "CS-2026-001").quantity;

  const result = await handleApplyPlan("FP-TEST-BATCH-001", {
    applyMode: "batch",
    batchName: "测试原子性",
    plannedDate: "2026-06-25",
    targetAtmosphere: "氧化",
    tiles: [
      {
        body: "粗陶坯",
        recipe: "松灰42 长石35 石英18 红土5",
        materialBatchRefs: [
          { ingredientName: "松灰", batchNo: "SG-2026-001" },
          { ingredientName: "长石", batchNo: "CS-2026-001" },
          { ingredientName: "石英", batchNo: "SY-2026-001" },
          { ingredientName: "红土", batchNo: "HT-2026-001" }
        ],
        batchWeight: 10
      },
      {
        tileId: "AG-EXISTING-002"
      }
    ]
  }, db);

  assertEq(result.status, 400, "验证失败返回 400");

  const finalStockSG = coll.materialStocks.find(s => s.batchNo === "SG-2026-001").quantity;
  const finalStockCS = coll.materialStocks.find(s => s.batchNo === "CS-2026-001").quantity;

  assertEq(finalStockSG, initialStockSG, "验证失败时松灰库存未扣减");
  assertEq(finalStockCS, initialStockCS, "验证失败时长石库存未扣减");

  const batchCount = coll.batches.filter(b => b.name === "测试原子性").length;
  assertEq(batchCount, 0, "验证失败时未创建批次");
}

async function main() {
  console.log("=== 烧成规划一键生成实验批次 回归测试 ===");

  try {
    await setupTestEnv();

    await test1_batch_apply_create_new_tiles();
    await test2_batch_apply_associate_existing_tiles();
    await test3_batch_apply_insufficient_stock();
    await test4_batch_apply_duplicate_plan();
    await test5_batch_apply_invalid_tile_status();
    await test6_batch_apply_tile_already_in_batch();
    await test7_batch_apply_missing_fields();
    await test8_batch_apply_mixed_new_and_existing();
    await test9_single_tile_apply_still_works();
    await test10_batch_apply_plan_not_found();
    await test11_batch_apply_inventory_deduction_rollback();

  } catch (err) {
    console.error("\n测试执行出错:", err);
    failed++;
    failures.push(err.message);
  } finally {
    await cleanupTestEnv();
  }

  console.log(`\n=== 测试结果: ${passed} 通过, ${failed} 失败 ===`);

  if (failures.length > 0) {
    console.log("\n失败详情:");
    failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
    process.exit(1);
  } else {
    console.log("\n所有测试通过!");
    process.exit(0);
  }
}

main().catch(err => {
  console.error("测试运行失败:", err);
  process.exit(1);
});
