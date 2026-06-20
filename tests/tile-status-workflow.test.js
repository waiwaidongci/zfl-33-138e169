import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(__dirname);
const testDir = join(projectRoot, "tests", "tmp-status");
const testDataDir = join(testDir, "data");
const testDbPath = join(testDataDir, "ash-glaze.json");
const testBackupDir = join(testDataDir, "backups");
const testMigrationsDir = join(testDir, "migrations");

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

const legacySampleWithoutStatus = {
  schemaVersion: 1,
  migrations: [
    {
      version: 1,
      name: "introduce-schema-version",
      appliedAt: "2026-06-20T13:00:13.852Z",
      backupPath: "/tmp/test.bak.json"
    }
  ],
  collections: {
    tiles: [
      {
        id: "AG-LEGACY-001",
        body: "粗陶坯",
        recipe: "松灰42 长石35 石英18 红土5",
        ashSource: "南山松灰",
        glazeThickness: "0.8mm",
        kiln: "K-2",
        firingCurve: [{ temp: 25, minutes: 0 }, { temp: 1240, minutes: 540 }],
        peakTemp: 1240,
        color: "青灰带油滴",
        defects: "边缘流釉",
        defectTags: [{ name: "流釉", severity: "mild", note: "边缘" }],
        score: 82,
        observations: [{ at: "2026-06-10", note: "还原气氛后半段偏强" }],
        recipeVersionId: "RCV-0001"
      },
      {
        id: "AG-LEGACY-002",
        body: "细瓷坯",
        recipe: "稻灰40 长石40 石英18 红土2",
        ashSource: "东北稻灰",
        glazeThickness: "0.6mm",
        kiln: "",
        firingCurve: [],
        peakTemp: 1260,
        color: "",
        defects: "",
        defectTags: [],
        score: 0,
        observations: [],
        recipeVersionId: null
      }
    ],
    firingPlans: [],
    recipes: [],
    recipeVersions: [],
    batches: [],
    materialStocks: [
      { id: "MAT-001", name: "松灰", batchNo: "SG-2026-001", quantity: 50, unit: "kg", entryDate: "2026-05-15" },
      { id: "MAT-002", name: "长石", batchNo: "CS-2026-001", quantity: 80, unit: "kg", entryDate: "2026-05-20" },
      { id: "MAT-003", name: "石英", batchNo: "SY-2026-001", quantity: 60, unit: "kg", entryDate: "2026-05-22" },
      { id: "MAT-004", name: "红土", batchNo: "HT-2026-001", quantity: 30, unit: "kg", entryDate: "2026-06-01" }
    ]
  }
};

async function setupTestEnv() {
  await rm(testDir, { recursive: true, force: true });
  await mkdir(testBackupDir, { recursive: true });
  delete process.env.ASH_GLAZE_MIGRATIONS_DIR;
}

async function setupLegacyDbWithoutStatus() {
  await writeFile(testDbPath, JSON.stringify(legacySampleWithoutStatus, null, 2));
}

async function setupMigratedDb() {
  await setupLegacyDbWithoutStatus();
  const { migrateToLatest } = await import("../lib/schema-migration.js");
  await migrateToLatest({ autoBackup: false });
}

async function cleanupTestEnv() {
  await rm(testDir, { recursive: true, force: true });
}

async function test1_status_machine_validation() {
  console.log("\nTest 1: 状态机核心验证");

  const {
    TILE_STATUSES,
    TILE_STATUS_LABELS,
    isValidStatus,
    isValidTransition,
    canTransitionTo,
    getTransitionError,
    getAvailableTransitions,
    INITIAL_STATUS
  } = await import("../lib/tile-status-machine.js");

  assertEq(INITIAL_STATUS, TILE_STATUSES.DRAFT, "初始状态为草稿");

  assert(isValidStatus(TILE_STATUSES.DRAFT), "草稿是有效状态");
  assert(isValidStatus(TILE_STATUSES.PENDING_FIRING), "待烧成是有效状态");
  assert(isValidStatus(TILE_STATUSES.FIRED), "已是有效状态");
  assert(isValidStatus(TILE_STATUSES.PENDING_REVIEW), "待复盘是有效状态");
  assert(isValidStatus(TILE_STATUSES.ARCHIVED), "已归档是有效状态");
  assert(!isValidStatus("invalid_status"), "无效状态被正确识别");

  assertEq(getAvailableTransitions(TILE_STATUSES.DRAFT), [TILE_STATUSES.PENDING_FIRING], "草稿只能转为待烧成");
  assertEq(getAvailableTransitions(TILE_STATUSES.PENDING_FIRING), [TILE_STATUSES.DRAFT, TILE_STATUSES.FIRED], "待烧成可退回草稿或转为已烧成");
  assertEq(getAvailableTransitions(TILE_STATUSES.FIRED), [TILE_STATUSES.PENDING_REVIEW], "已烧成只能转为待复盘");
  assertEq(getAvailableTransitions(TILE_STATUSES.PENDING_REVIEW), [TILE_STATUSES.FIRED, TILE_STATUSES.ARCHIVED], "待复盘可退回已烧成或转为已归档");
  assertEq(getAvailableTransitions(TILE_STATUSES.ARCHIVED), [], "已归档无后续状态");

  assert(canTransitionTo(TILE_STATUSES.DRAFT, TILE_STATUSES.PENDING_FIRING), "草稿 -> 待烧成 有效");
  assert(!canTransitionTo(TILE_STATUSES.DRAFT, TILE_STATUSES.FIRED), "草稿 -> 已烧成 无效");
  assert(!canTransitionTo(TILE_STATUSES.DRAFT, TILE_STATUSES.ARCHIVED), "草稿 -> 已归档 无效");
  assert(canTransitionTo(TILE_STATUSES.PENDING_FIRING, TILE_STATUSES.DRAFT), "待烧成 -> 草稿 有效");
  assert(canTransitionTo(TILE_STATUSES.PENDING_FIRING, TILE_STATUSES.FIRED), "待烧成 -> 已烧成 有效");
  assert(!canTransitionTo(TILE_STATUSES.ARCHIVED, TILE_STATUSES.DRAFT), "已归档 -> 草稿 无效");
  assert(!canTransitionTo(TILE_STATUSES.FIRED, TILE_STATUSES.DRAFT), "已烧成 -> 草稿 无效");

  const error1 = getTransitionError(TILE_STATUSES.DRAFT, TILE_STATUSES.ARCHIVED);
  assert(error1.includes("草稿") && error1.includes("已归档"), "状态转换错误信息包含中文标签");

  assertEq(Object.keys(TILE_STATUS_LABELS).length, 5, "所有状态都有中文标签");
}

async function test2_permission_rules_validation() {
  console.log("\nTest 2: 权限规则验证");

  const { TILE_STATUSES } = await import("../lib/tile-status-machine.js");
  const {
    getAllowedFields,
    isFieldAllowed,
    validateFieldsForStatus,
    requiresInventoryDeduction,
    requiresInventoryRestore,
    shouldLockBasicInfo
  } = await import("../lib/tile-permission-rules.js");

  const draftAllowed = getAllowedFields(TILE_STATUSES.DRAFT);
  assert(draftAllowed.includes("body"), "草稿状态可编辑 body");
  assert(draftAllowed.includes("recipe"), "草稿状态可编辑 recipe");
  assert(draftAllowed.includes("kiln"), "草稿状态可编辑 kiln");
  assert(draftAllowed.includes("score"), "草稿状态可编辑 score");

  const pendingFiringAllowed = getAllowedFields(TILE_STATUSES.PENDING_FIRING);
  assert(!pendingFiringAllowed.includes("body"), "待烧成状态不可编辑 body");
  assert(!pendingFiringAllowed.includes("recipe"), "待烧成状态不可编辑 recipe");
  assert(pendingFiringAllowed.includes("kiln"), "待烧成状态可编辑 kiln");
  assert(pendingFiringAllowed.includes("observations"), "待烧成状态可添加 observations");

  const firedAllowed = getAllowedFields(TILE_STATUSES.FIRED);
  assert(!firedAllowed.includes("body"), "已烧成状态不可编辑 body");
  assert(!firedAllowed.includes("recipe"), "已烧成状态不可编辑 recipe");
  assert(firedAllowed.includes("color"), "已烧成状态可编辑 color");
  assert(firedAllowed.includes("score"), "已烧成状态可编辑 score");
  assert(firedAllowed.includes("defectTags"), "已烧成状态可编辑 defectTags");

  const reviewAllowed = getAllowedFields(TILE_STATUSES.PENDING_REVIEW);
  assert(!reviewAllowed.includes("color"), "待复盘状态不可编辑 color");
  assert(reviewAllowed.includes("score"), "待复盘状态可编辑 score");
  assert(reviewAllowed.includes("observations"), "待复盘状态可编辑 observations");
  assert(reviewAllowed.includes("defectTags"), "待复盘状态可编辑 defectTags");

  const archivedAllowed = getAllowedFields(TILE_STATUSES.ARCHIVED);
  assertEq(archivedAllowed.length, 0, "已归档状态无字段可编辑");

  assert(isFieldAllowed(TILE_STATUSES.DRAFT, "body"), "草稿可编辑 body");
  assert(!isFieldAllowed(TILE_STATUSES.FIRED, "recipe"), "已烧成不可编辑 recipe");

  const validation = validateFieldsForStatus(TILE_STATUSES.FIRED, ["body", "recipe", "color"]);
  assert(!validation.valid, "已烧成状态编辑 body 和 recipe 验证失败");
  assert(validation.errors.length > 0, "验证失败返回错误信息");
  assert(validation.errors[0].fields.includes("body"), "错误信息包含 body 字段");
  assert(validation.errors[0].fields.includes("recipe"), "错误信息包含 recipe 字段");

  assert(requiresInventoryDeduction(TILE_STATUSES.DRAFT, TILE_STATUSES.PENDING_FIRING), "草稿->待烧成 需要扣减库存");
  assert(requiresInventoryRestore(TILE_STATUSES.PENDING_FIRING, TILE_STATUSES.DRAFT), "待烧成->草稿 需要恢复库存");
  assert(!requiresInventoryDeduction(TILE_STATUSES.FIRED, TILE_STATUSES.PENDING_REVIEW), "已烧成->待复盘 不需要扣减库存");

  assert(shouldLockBasicInfo(TILE_STATUSES.PENDING_FIRING), "待烧成应锁定基础信息");
  assert(shouldLockBasicInfo(TILE_STATUSES.ARCHIVED), "已归档应锁定基础信息");
  assert(!shouldLockBasicInfo(TILE_STATUSES.DRAFT), "草稿不应锁定基础信息");
}

async function test3_data_migration() {
  console.log("\nTest 3: 数据迁移 - 旧数据状态推断");

  await setupLegacyDbWithoutStatus();

  const { migrateToLatest, getMigrationStatus } = await import("../lib/schema-migration.js");
  const { loadDb, getSchemaVersion, getCollections } = await import("../lib/db.js");
  const { TILE_STATUSES } = await import("../lib/tile-status-machine.js");

  const statusBefore = await getMigrationStatus();
  assertEq(statusBefore.current.currentSchemaVersion, 1, "迁移前 schemaVersion 为 1");

  const result = await migrateToLatest({ autoBackup: false });
  assert(result.success, "迁移执行成功");
  assertEq(result.toVersion, 2, "迁移后 schemaVersion 为 2");

  const db = await loadDb();
  assertEq(getSchemaVersion(db), 2, "数据库 schemaVersion 为 2");

  const coll = getCollections(db);
  assertEq(coll.tiles.length, 2, "迁移后 tiles 数量正确");

  const tile1 = coll.tiles.find(t => t.id === "AG-LEGACY-001");
  assert(tile1.status !== undefined, "tile1 有 status 字段");
  assert(tile1.status === TILE_STATUSES.ARCHIVED || tile1.status === TILE_STATUSES.PENDING_REVIEW,
    "有完整数据的 tile1 被推断为已归档或待复盘");
  assert(Array.isArray(tile1.statusHistory), "tile1 有 statusHistory 数组");
  assert(tile1.statusHistory.length >= 1, "tile1 有状态历史记录");
  assert(tile1.batchId === null, "tile1 batchId 默认为 null");
  assert(tile1.inventoryDeducted === false, "tile1 inventoryDeducted 默认为 false");

  const tile2 = coll.tiles.find(t => t.id === "AG-LEGACY-002");
  assert(tile2.status !== undefined, "tile2 有 status 字段");
  assert(tile2.status === TILE_STATUSES.DRAFT || tile2.status === TILE_STATUSES.FIRED,
    "数据不全的 tile2 被推断为草稿或已烧成");
  assert(Array.isArray(tile2.statusHistory), "tile2 有 statusHistory 数组");

  for (const tile of coll.tiles) {
    assert(tile.statusHistory[0].operator === "migration", "状态历史记录 operator 为 migration");
    assert(tile.statusHistory[0].note.includes("数据迁移"), "状态历史记录 note 包含迁移说明");
  }
}

async function test4_status_history_recording() {
  console.log("\nTest 4: 状态历史记录功能");

  await setupMigratedDb();

  const { loadDb, saveDb, getCollections } = await import("../lib/db.js");
  const { TILE_STATUSES } = await import("../lib/tile-status-machine.js");
  const { createStatusRecord, addStatusHistory, getStatusHistory, getStatusProgress, getLastTransition } = await import("../lib/tile-status-history.js");

  const db = await loadDb();
  const coll = getCollections(db);
  const tile = coll.tiles[0];

  const initialHistoryLength = getStatusHistory(tile).length;
  assert(initialHistoryLength >= 1, "初始有状态历史");

  const record = createStatusRecord(
    tile.status,
    TILE_STATUSES.PENDING_REVIEW,
    "test_user",
    "测试状态变更"
  );

  assertEq(record.from, tile.status, "记录包含 from 状态");
  assertEq(record.to, TILE_STATUSES.PENDING_REVIEW, "记录包含 to 状态");
  assertEq(record.operator, "test_user", "记录包含 operator");
  assertEq(record.note, "测试状态变更", "记录包含 note");
  assert(record.at !== undefined, "记录包含时间戳");
  assert(record.fromLabel !== undefined, "记录包含 from 中文标签");
  assert(record.toLabel !== undefined, "记录包含 to 中文标签");

  addStatusHistory(tile, record);
  assertEq(getStatusHistory(tile).length, initialHistoryLength + 1, "历史记录增加 1 条");

  const last = getLastTransition(tile);
  assertEq(last.to, TILE_STATUSES.PENDING_REVIEW, "getLastTransition 返回最新记录");

  tile.status = TILE_STATUSES.PENDING_REVIEW;
  const progress = getStatusProgress(tile);
  assert(progress.progress >= 60, "进度百分比计算正确");
  assertEq(progress.current, TILE_STATUSES.PENDING_REVIEW, "进度包含当前状态");
  assert(progress.completed.length >= 3, "已完成状态数量正确");

  await saveDb(db);
}

async function test5_normal_workflow() {
  console.log("\nTest 5: 正常状态流转流程");

  await setupMigratedDb();

  const { loadDb, saveDb, getCollections } = await import("../lib/db.js");
  const { TILE_STATUSES, TILE_STATUS_LABELS } = await import("../lib/tile-status-machine.js");
  const {
    handleTransitionStatus,
    handleGetTileStatus,
    handleUpdateTileWithStatus
  } = await import("../lib/tile-status-routes.js");

  const db = await loadDb();
  const coll = getCollections(db);

  const newTile = {
    id: "AG-WORKFLOW-001",
    body: "粗陶坯",
    recipe: "松灰42 长石35 石英18 红土5",
    status: TILE_STATUSES.DRAFT,
    statusHistory: [],
    batchId: null,
    inventoryDeducted: false,
    color: "",
    score: 0,
    defects: "",
    defectTags: [],
    observations: [],
    materialBatchRefs: [
      { ingredientName: "松灰", batchNo: "SG-2026-001" },
      { ingredientName: "长石", batchNo: "CS-2026-001" },
      { ingredientName: "石英", batchNo: "SY-2026-001" },
      { ingredientName: "红土", batchNo: "HT-2026-001" }
    ],
    batchWeight: 10
  };
  coll.tiles.push(newTile);
  await saveDb(db);

  const status1 = await handleGetTileStatus("AG-WORKFLOW-001", db);
  assertEq(status1.status, 200, "获取状态成功");
  assertEq(status1.data.status, TILE_STATUSES.DRAFT, "初始状态为草稿");
  assert(status1.data.availableTransitions.length > 0, "有可用的状态转换");

  const trans1 = await handleTransitionStatus("AG-WORKFLOW-001", {
    targetStatus: TILE_STATUSES.PENDING_FIRING,
    operator: "test_user",
    note: "准备入窑"
  }, db);
  assertEq(trans1.status, 200, "草稿 -> 待烧成 成功");
  assertEq(trans1.data.from, TILE_STATUSES.DRAFT, "转换记录 from 正确");
  assertEq(trans1.data.to, TILE_STATUSES.PENDING_FIRING, "转换记录 to 正确");
  assert(trans1.data.statusRecord.operator === "test_user", "operator 正确记录");
  assert(trans1.data.statusRecord.note === "准备入窑", "note 正确记录");

  const tileAfterTrans1 = coll.tiles.find(t => t.id === "AG-WORKFLOW-001");
  assert(tileAfterTrans1.inventoryDeducted === true, "库存已扣减");

  const trans2 = await handleTransitionStatus("AG-WORKFLOW-001", {
    targetStatus: TILE_STATUSES.DRAFT,
    operator: "test_user",
    note: "配方需要调整，退回草稿"
  }, db);
  assertEq(trans2.status, 200, "待烧成 -> 草稿 成功（回退）");
  assert(tileAfterTrans1.inventoryDeducted === false, "库存已恢复");

  const trans3 = await handleTransitionStatus("AG-WORKFLOW-001", {
    targetStatus: TILE_STATUSES.PENDING_FIRING,
    operator: "test_user",
    note: "重新提交"
  }, db);
  assertEq(trans3.status, 200, "草稿 -> 待烧成 再次成功");

  const updateBeforeFiring = await handleUpdateTileWithStatus("AG-WORKFLOW-001", {
    body: "修改后的坯体"
  }, db);
  assertEq(updateBeforeFiring.status, 400, "待烧成状态修改 body 被拒绝");
  assert(updateBeforeFiring.data.error === "fields_not_allowed", "错误类型正确");

  const updateKiln = await handleUpdateTileWithStatus("AG-WORKFLOW-001", {
    kiln: "K-3",
    observations: [{ at: "2026-06-20", note: "调整窑炉" }]
  }, db);
  assertEq(updateKiln.status, 200, "待烧成状态修改 kiln 和 observations 成功");

  const trans4 = await handleTransitionStatus("AG-WORKFLOW-001", {
    targetStatus: TILE_STATUSES.FIRED,
    operator: "test_user",
    note: "烧成完成"
  }, db);
  assertEq(trans4.status, 200, "待烧成 -> 已烧成 成功");

  const addFiringResult = await handleUpdateTileWithStatus("AG-WORKFLOW-001", {
    color: "青灰色",
    score: 85,
    defectTags: [{ name: "针孔", severity: "mild", note: "少量" }]
  }, db);
  assertEq(addFiringResult.status, 200, "已烧成状态录入结果成功");

  const trans5 = await handleTransitionStatus("AG-WORKFLOW-001", {
    targetStatus: TILE_STATUSES.PENDING_REVIEW,
    operator: "test_user",
    note: "进入复盘阶段"
  }, db);
  assertEq(trans5.status, 200, "已烧成 -> 待复盘 成功");

  const updateReview = await handleUpdateTileWithStatus("AG-WORKFLOW-001", {
    score: 88,
    observations: [{ at: "2026-06-21", note: "复盘调整评分" }]
  }, db);
  assertEq(updateReview.status, 200, "待复盘状态修改评分成功");

  const updateColorFail = await handleUpdateTileWithStatus("AG-WORKFLOW-001", {
    color: "修改颜色"
  }, db);
  assertEq(updateColorFail.status, 400, "待复盘状态修改 color 被拒绝");

  const tileBeforeArchive = coll.tiles.find(t => t.id === "AG-WORKFLOW-001");
  tileBeforeArchive.observations = [];
  tileBeforeArchive.score = 0;
  await saveDb(db);

  const trans6Fail = await handleTransitionStatus("AG-WORKFLOW-001", {
    targetStatus: TILE_STATUSES.ARCHIVED,
    operator: "test_user"
  }, db);
  assertEq(trans6Fail.status, 400, "无观察记录不能归档");

  const addScoreAndObservation = await handleUpdateTileWithStatus("AG-WORKFLOW-001", {
    score: 85,
    observations: [{ at: "2026-06-22", note: "最终复盘记录" }]
  }, db);
  assertEq(addScoreAndObservation.status, 200, "添加评分和观察记录成功");

  const trans6 = await handleTransitionStatus("AG-WORKFLOW-001", {
    targetStatus: TILE_STATUSES.ARCHIVED,
    operator: "test_user",
    note: "实验完成，归档"
  }, db);
  assertEq(trans6.status, 200, "待复盘 -> 已归档 成功");

  const updateArchived = await handleUpdateTileWithStatus("AG-WORKFLOW-001", {
    score: 90
  }, db);
  assertEq(updateArchived.status, 400, "已归档状态修改任何字段被拒绝");

  const trans7Fail = await handleTransitionStatus("AG-WORKFLOW-001", {
    targetStatus: TILE_STATUSES.DRAFT,
    operator: "test_user"
  }, db);
  assertEq(trans7Fail.status, 400, "已归档不能转换到任何状态");

  const tileFinal = coll.tiles.find(t => t.id === "AG-WORKFLOW-001");
  assert(tileFinal.statusHistory.length >= 6, "完整的状态历史记录");
}

async function test6_invalid_transitions() {
  console.log("\nTest 6: 非法状态跳转错误信息验证");

  await setupMigratedDb();

  const { loadDb, getCollections } = await import("../lib/db.js");
  const { TILE_STATUSES, TILE_STATUS_LABELS } = await import("../lib/tile-status-machine.js");
  const { handleTransitionStatus } = await import("../lib/tile-status-routes.js");

  const db = await loadDb();
  const coll = getCollections(db);

  const testTile = coll.tiles.find(t => t.id === "AG-LEGACY-001");
  testTile.status = TILE_STATUSES.DRAFT;

  const invalidStatus = await handleTransitionStatus("AG-LEGACY-001", {
    targetStatus: "invalid_status"
  }, db);
  assertEq(invalidStatus.status, 400, "无效状态值被拒绝");
  assert(invalidStatus.data.message.includes("不是有效的试片状态"), "错误信息可读");
  assert(Array.isArray(invalidStatus.data.validStatuses), "返回有效状态列表");

  const draftToArchived = await handleTransitionStatus("AG-LEGACY-001", {
    targetStatus: TILE_STATUSES.ARCHIVED
  }, db);
  assertEq(draftToArchived.status, 400, "草稿 -> 已归档 被拒绝");
  assert(draftToArchived.data.message.includes(TILE_STATUS_LABELS[TILE_STATUSES.DRAFT]), "错误信息包含当前状态中文");
  assert(draftToArchived.data.message.includes(TILE_STATUS_LABELS[TILE_STATUSES.ARCHIVED]), "错误信息包含目标状态中文");
  assert(draftToArchived.data.message.includes(TILE_STATUS_LABELS[TILE_STATUSES.PENDING_FIRING]), "错误信息包含允许的状态");
  assert(Array.isArray(draftToArchived.data.allowedTransitions), "返回允许的转换列表");

  testTile.status = TILE_STATUSES.ARCHIVED;
  const archivedToAny = await handleTransitionStatus("AG-LEGACY-001", {
    targetStatus: TILE_STATUSES.PENDING_REVIEW
  }, db);
  assertEq(archivedToAny.status, 400, "已归档 -> 任何状态 被拒绝");
  assert(archivedToAny.data.message.includes("已归档"), "错误信息表明已归档不可变更");

  testTile.status = TILE_STATUSES.FIRED;
  const firedToDraft = await handleTransitionStatus("AG-LEGACY-001", {
    targetStatus: TILE_STATUSES.DRAFT
  }, db);
  assertEq(firedToDraft.status, 400, "已烧成 -> 草稿 被拒绝");

  const sameStatus = await handleTransitionStatus("AG-LEGACY-001", {
    targetStatus: TILE_STATUSES.FIRED
  }, db);
  assertEq(sameStatus.status, 400, "相同状态转换被拒绝");
  assert(sameStatus.data.message.includes("状态未发生变化"), "错误信息说明状态未变化");
}

async function test7_batch_status_transition() {
  console.log("\nTest 7: 批量状态转换");

  await setupMigratedDb();

  const { loadDb, saveDb, getCollections } = await import("../lib/db.js");
  const { TILE_STATUSES } = await import("../lib/tile-status-machine.js");
  const { handleBatchStatusTransition } = await import("../lib/tile-status-routes.js");

  const db = await loadDb();
  const coll = getCollections(db);

  for (let i = 1; i <= 4; i++) {
    coll.tiles.push({
      id: `AG-BATCH-00${i}`,
      body: "粗陶坯",
      recipe: "松灰42 长石35 石英18 红土5",
      status: TILE_STATUSES.DRAFT,
      statusHistory: [],
      batchId: null,
      inventoryDeducted: false,
      color: i <= 2 ? "测试颜色" : "",
      score: i <= 2 ? 80 : 0,
      defects: "",
      defectTags: [],
      observations: [],
      materialBatchRefs: [
        { ingredientName: "松灰", batchNo: "SG-2026-001" },
        { ingredientName: "长石", batchNo: "CS-2026-001" },
        { ingredientName: "石英", batchNo: "SY-2026-001" },
        { ingredientName: "红土", batchNo: "HT-2026-001" }
      ],
      batchWeight: 5
    });
  }

  coll.tiles.find(t => t.id === "AG-BATCH-003").status = TILE_STATUSES.ARCHIVED;

  await saveDb(db);

  const result = await handleBatchStatusTransition({
    tileIds: ["AG-BATCH-001", "AG-BATCH-002", "AG-BATCH-003", "AG-BATCH-004"],
    targetStatus: TILE_STATUSES.PENDING_FIRING,
    operator: "batch_user",
    note: "批量提交待烧成"
  }, db);

  assertEq(result.status, 200, "批量转换接口调用成功");
  assertEq(result.data.total, 4, "总数量正确");
  assertEq(result.data.successCount, 3, "成功数量正确（AG-BATCH-001、002、004 成功，AG-BATCH-003 已归档失败）");
  assertEq(result.data.failedCount, 1, "失败数量正确");

  const successIds = result.data.success.map(r => r.id);
  assert(successIds.includes("AG-BATCH-001"), "AG-BATCH-001 转换成功");
  assert(successIds.includes("AG-BATCH-002"), "AG-BATCH-002 转换成功");
  assert(successIds.includes("AG-BATCH-004"), "AG-BATCH-004 转换成功（有库存扣减信息）");

  const failedIds = result.data.failed.map(r => r.id);
  assert(failedIds.includes("AG-BATCH-003"), "AG-BATCH-003 转换失败（已归档）");

  for (const success of result.data.success) {
    assertEq(success.to, TILE_STATUSES.PENDING_FIRING, "成功转换的目标状态正确");
  }

  for (const failed of result.data.failed) {
    assert(failed.error !== undefined, "失败项包含错误信息");
    assert(failed.message !== undefined, "失败项包含可读错误消息");
  }
}

async function test8_api_routes_and_filters() {
  console.log("\nTest 8: API 路由与过滤功能");

  await setupMigratedDb();

  const { loadDb, getCollections, saveDb } = await import("../lib/db.js");
  const { TILE_STATUSES } = await import("../lib/tile-status-machine.js");
  const { handleListTiles } = await import("../lib/routes.js");
  const { getStatusInfo, handleGetStatusHistory, handleGetTileStatus } = await import("../lib/tile-status-routes.js");

  const db = await loadDb();
  const coll = getCollections(db);

  const testData = [
    { id: "AG-FILTER-001", status: TILE_STATUSES.DRAFT, batchId: null },
    { id: "AG-FILTER-002", status: TILE_STATUSES.PENDING_FIRING, batchId: "BATCH-001" },
    { id: "AG-FILTER-003", status: TILE_STATUSES.FIRED, batchId: "BATCH-001" },
    { id: "AG-FILTER-004", status: TILE_STATUSES.PENDING_REVIEW, batchId: "BATCH-002" },
    { id: "AG-FILTER-005", status: TILE_STATUSES.ARCHIVED, batchId: "BATCH-002" }
  ];

  for (const td of testData) {
    coll.tiles.push({
      id: td.id,
      body: "测试坯体",
      recipe: "测试配方",
      status: td.status,
      statusHistory: [],
      batchId: td.batchId,
      inventoryDeducted: false,
      color: "",
      score: 0,
      defects: "",
      defectTags: [],
      observations: []
    });
  }

  await saveDb(db);

  const statusInfo = getStatusInfo();
  assert(Array.isArray(statusInfo.statuses), "getStatusInfo 返回状态列表");
  assertEq(statusInfo.statuses.length, 5, "共有 5 种状态");
  assert(typeof statusInfo.transitions === "object", "getStatusInfo 返回状态转换图");

  const urlAll = new URL("http://localhost/tiles");
  const resultAll = await handleListTiles(urlAll, db);
  assert(resultAll.data.length >= 5, "无过滤时返回所有试片");

  const urlDraft = new URL("http://localhost/tiles?status=draft");
  const resultDraft = await handleListTiles(urlDraft, db);
  assert(resultDraft.data.every(t => t.status === TILE_STATUSES.DRAFT), "status 过滤只返回草稿状态");
  assert(resultDraft.data.length >= 1, "至少返回 1 条草稿");

  const urlBatch1 = new URL("http://localhost/tiles?batchId=BATCH-001");
  const resultBatch1 = await handleListTiles(urlBatch1, db);
  assert(resultBatch1.data.every(t => t.batchId === "BATCH-001"), "batchId 过滤正确");
  assertEq(resultBatch1.data.length, 2, "BATCH-001 有 2 个试片");

  const urlArchived = new URL("http://localhost/tiles?status=archived");
  const resultArchived = await handleListTiles(urlArchived, db);
  assert(resultArchived.data.every(t => t.status === TILE_STATUSES.ARCHIVED), "归档过滤正确");

  const statusResult = await handleGetTileStatus("AG-FILTER-003", db);
  assertEq(statusResult.status, 200, "获取试片状态成功");
  assertEq(statusResult.data.status, TILE_STATUSES.FIRED, "返回正确状态");
  assert(Array.isArray(statusResult.data.availableTransitions), "返回可用转换");
  assert(statusResult.data.progress !== undefined, "返回进度信息");

  const historyResult = await handleGetStatusHistory("AG-FILTER-003", db);
  assertEq(historyResult.status, 200, "获取状态历史成功");
  assert(Array.isArray(historyResult.data.history), "返回历史数组");

  const notFoundResult = await handleGetTileStatus("NON-EXISTENT", db);
  assertEq(notFoundResult.status, 404, "不存在的试片返回 404");
}

async function test10_tile_list_advanced_filters() {
  console.log("\nTest 10: 试片列表高级组合筛选与排序");

  await setupMigratedDb();

  const { loadDb, saveDb, getCollections } = await import("../lib/db.js");
  const { handleListTiles } = await import("../lib/routes.js");

  const db = await loadDb();
  const coll = getCollections(db);

  const tiles = [
    { id: "AG-ADV-001", body: "粗陶坯", recipe: "松灰42 长石35", ashSource: "南山松灰", kiln: "K-1", peakTemp: 1200, score: 60, defects: "", defectTags: [], observations: [] },
    { id: "AG-ADV-002", body: "粗陶坯", recipe: "稻灰40 长石40", ashSource: "东北稻灰", kiln: "K-2", peakTemp: 1240, score: 75, defects: "边缘流釉", defectTags: [{ name: "流釉", severity: "mild", note: "边缘" }], observations: [] },
    { id: "AG-ADV-003", body: "细瓷坯", recipe: "竹灰42 长石35", ashSource: "莫干山竹灰", kiln: "K-2", peakTemp: 1260, score: 88, defects: "针孔", defectTags: [{ name: "针孔", severity: "moderate", note: "" }], observations: [] },
    { id: "AG-ADV-004", body: "细瓷坯", recipe: "木灰50 长石30", ashSource: "果木灰", kiln: "K-3", peakTemp: 1300, score: 92, defects: "", defectTags: [], observations: [] },
    { id: "AG-ADV-005", body: "粗陶坯", recipe: "松灰42 长石35", ashSource: "南山松灰", kiln: "K-2", peakTemp: 1250, score: 45, defects: "缩釉开裂", defectTags: [{ name: "缩釉", severity: "severe", note: "" }, { name: "开裂", severity: "severe", note: "" }], observations: [] },
    { id: "AG-ADV-006", body: "细瓷坯", recipe: "稻灰40 长石40", ashSource: "东北稻灰", kiln: "K-1", peakTemp: 1180, score: 30, defects: "", defectTags: [], observations: [] }
  ];

  const { TILE_STATUSES } = await import("../lib/tile-status-machine.js");
  for (const t of tiles) {
    coll.tiles.push({
      ...t,
      status: TILE_STATUSES.DRAFT,
      statusHistory: [],
      batchId: null,
      inventoryDeducted: false
    });
  }
  await saveDb(db);

  const urlKiln = new URL("http://localhost/tiles?kiln=K-2");
  const resKiln = await handleListTiles(urlKiln, db);
  assertEq(resKiln.status, 200, "kiln 过滤返回 200");
  assert(resKiln.data.every(t => t.kiln === "K-2"), "kiln=K-2 只返回 K-2 窑的试片");
  assert(resKiln.data.some(t => t.id.startsWith("AG-ADV-")), "kiln=K-2 包含测试数据");
  const advK2Count = resKiln.data.filter(t => t.id.startsWith("AG-ADV-")).length;
  assertEq(advK2Count, 3, "K-2 窑测试数据有 3 条");

  const urlMaxTemp = new URL("http://localhost/tiles?maxTemp=1250");
  const resMaxTemp = await handleListTiles(urlMaxTemp, db);
  assert(resMaxTemp.data.every(t => Number(t.peakTemp) <= 1250), "maxTemp=1250 过滤正确");
  assert(resMaxTemp.data.length >= 3, "maxTemp=1250 至少返回 3 条（含种子数据）");

  const urlMinScore = new URL("http://localhost/tiles?minScore=70");
  const resMinScore = await handleListTiles(urlMinScore, db);
  assert(resMinScore.data.every(t => Number(t.score) >= 70), "minScore=70 过滤正确");

  const urlMaxScore = new URL("http://localhost/tiles?maxScore=60");
  const resMaxScore = await handleListTiles(urlMaxScore, db);
  assert(resMaxScore.data.every(t => Number(t.score) <= 60), "maxScore=60 过滤正确");

  const urlHasDefectsTrue = new URL("http://localhost/tiles?hasDefects=true");
  const resHasDefectsTrue = await handleListTiles(urlHasDefectsTrue, db);
  assert(resHasDefectsTrue.data.every(t =>
    (Array.isArray(t.defectTags) && t.defectTags.length > 0) || (typeof t.defects === "string" && t.defects.trim().length > 0)
  ), "hasDefects=true 只返回有缺陷的试片");

  const urlHasDefectsFalse = new URL("http://localhost/tiles?hasDefects=false");
  const resHasDefectsFalse = await handleListTiles(urlHasDefectsFalse, db);
  assert(resHasDefectsFalse.data.every(t =>
    !(Array.isArray(t.defectTags) && t.defectTags.length > 0) && !(typeof t.defects === "string" && t.defects.trim().length > 0)
  ), "hasDefects=false 只返回无缺陷的试片");

  const urlCombined = new URL("http://localhost/tiles?kiln=K-2&minTemp=1230&maxTemp=1260&minScore=70&maxScore=90&hasDefects=true");
  const resCombined = await handleListTiles(urlCombined, db);
  assertEq(resCombined.status, 200, "多条件组合筛选返回 200");
  assert(resCombined.data.every(t => t.kiln === "K-2"), "组合筛选：kiln=K-2");
  assert(resCombined.data.every(t => Number(t.peakTemp) >= 1230), "组合筛选：minTemp=1230");
  assert(resCombined.data.every(t => Number(t.peakTemp) <= 1260), "组合筛选：maxTemp=1260");
  assert(resCombined.data.every(t => Number(t.score) >= 70), "组合筛选：minScore=70");
  assert(resCombined.data.every(t => Number(t.score) <= 90), "组合筛选：maxScore=90");
  assert(resCombined.data.every(t =>
    (Array.isArray(t.defectTags) && t.defectTags.length > 0) || (typeof t.defects === "string" && t.defects.trim().length > 0)
  ), "组合筛选：hasDefects=true");

  const urlSortScoreDesc = new URL("http://localhost/tiles?sort=-score");
  const resSortDesc = await handleListTiles(urlSortScoreDesc, db);
  const advDesc = resSortDesc.data.filter(t => t.id.startsWith("AG-ADV-"));
  const scoresDesc = advDesc.map(t => Number(t.score));
  for (let i = 1; i < scoresDesc.length; i++) {
    assert(scoresDesc[i - 1] >= scoresDesc[i], `sort=-score 降序：${scoresDesc[i - 1]} >= ${scoresDesc[i]}`);
  }

  const urlSortScoreAsc = new URL("http://localhost/tiles?sort=score");
  const resSortAsc = await handleListTiles(urlSortScoreAsc, db);
  const advAsc = resSortAsc.data.filter(t => t.id.startsWith("AG-ADV-"));
  const scoresAsc = advAsc.map(t => Number(t.score));
  for (let i = 1; i < scoresAsc.length; i++) {
    assert(scoresAsc[i - 1] <= scoresAsc[i], `sort=score 升序：${scoresAsc[i - 1]} <= ${scoresAsc[i]}`);
  }

  const urlSortPeakTemp = new URL("http://localhost/tiles?sort=-peakTemp");
  const resSortPeak = await handleListTiles(urlSortPeakTemp, db);
  const advPeak = resSortPeak.data.filter(t => t.id.startsWith("AG-ADV-"));
  const tempsPeak = advPeak.map(t => Number(t.peakTemp));
  for (let i = 1; i < tempsPeak.length; i++) {
    assert(tempsPeak[i - 1] >= tempsPeak[i], `sort=-peakTemp 降序：${tempsPeak[i - 1]} >= ${tempsPeak[i]}`);
  }

  const urlComboSort = new URL("http://localhost/tiles?kiln=K-2&minScore=40&sort=-score");
  const resComboSort = await handleListTiles(urlComboSort, db);
  assertEq(resComboSort.status, 200, "组合筛选+排序返回 200");
  assert(resComboSort.data.every(t => t.kiln === "K-2"), "组合+排序：kiln=K-2");
  assert(resComboSort.data.every(t => Number(t.score) >= 40), "组合+排序：minScore=40");
  const comboScores = resComboSort.data.map(t => Number(t.score));
  for (let i = 1; i < comboScores.length; i++) {
    assert(comboScores[i - 1] >= comboScores[i], `组合+排序：score 降序 ${comboScores[i - 1]} >= ${comboScores[i]}`);
  }

  const urlInvalidSort = new URL("http://localhost/tiles?sort=invalidField");
  const resInvalidSort = await handleListTiles(urlInvalidSort, db);
  assertEq(resInvalidSort.status, 200, "不支持的 sort 字段仍返回 200（忽略排序）");
  assert(Array.isArray(resInvalidSort.data), "不支持的 sort 字段返回数组");

  const firstResult = resComboSort.data[0];
  assert(firstResult.id !== undefined, "返回结构兼容：包含 id");
  assert(firstResult.kiln !== undefined, "返回结构兼容：包含 kiln");
  assert(firstResult.score !== undefined, "返回结构兼容：包含 score");
  assert(firstResult.peakTemp !== undefined, "返回结构兼容：包含 peakTemp");
}

async function test9_legacy_entry_guards() {
  console.log("\nTest 9: 旧入口权限守卫验证");

  await setupMigratedDb();

  const { loadDb, saveDb, getCollections } = await import("../lib/db.js");
  const { TILE_STATUSES } = await import("../lib/tile-status-machine.js");
  const { handleAddObservation, handleCreateTile, handleApplyPlan } = await import("../lib/routes.js");
  const { handleUpdateTileDefectTags, handleAddDefectTag, handleRemoveDefectTag } = await import("../lib/defect-routes.js");
  const { handleAddBatchTiles, handleRemoveBatchTiles } = await import("../lib/batch-routes.js");
  const { ensureBatchCollection, insertBatch } = await import("../lib/batch-repository.js");

  const db = await loadDb();
  const coll = getCollections(db);

  const archivedTile = {
    id: "AG-GUARD-ARCHIVED",
    body: "测试坯体",
    recipe: "松灰42 长石35",
    ashSource: "南山松灰",
    kiln: "K-2",
    peakTemp: 1240,
    color: "青灰",
    score: 85,
    defectTags: [{ name: "流釉", severity: "mild", note: "" }],
    observations: [{ at: "2026-06-20", note: "测试" }],
    status: TILE_STATUSES.ARCHIVED,
    statusHistory: [{ from: null, to: TILE_STATUSES.ARCHIVED, operator: "test", note: "", at: new Date().toISOString() }],
    batchId: null,
    inventoryDeducted: true
  };
  const draftTile = {
    id: "AG-GUARD-DRAFT",
    body: "测试坯体",
    recipe: "松灰42 长石35",
    ashSource: "南山松灰",
    kiln: "K-2",
    peakTemp: 1240,
    status: TILE_STATUSES.DRAFT,
    statusHistory: [{ from: null, to: TILE_STATUSES.DRAFT, operator: "test", note: "", at: new Date().toISOString() }],
    batchId: null,
    inventoryDeducted: false,
    defectTags: [],
    observations: []
  };
  const firedTile = {
    id: "AG-GUARD-FIRED",
    body: "测试坯体",
    recipe: "松灰42 长石35",
    ashSource: "南山松灰",
    kiln: "K-2",
    peakTemp: 1240,
    status: TILE_STATUSES.FIRED,
    statusHistory: [{ from: null, to: TILE_STATUSES.FIRED, operator: "test", note: "", at: new Date().toISOString() }],
    batchId: null,
    inventoryDeducted: true,
    defectTags: [],
    observations: []
  };
  coll.tiles.push(archivedTile, draftTile, firedTile);

  ensureBatchCollection(db);
  insertBatch(db, { id: "BATCH-GUARD", name: "守卫测试批次", kiln: "K-2", tileIds: [], status: "planned", observations: [], createdAt: "2026-06-20", updatedAt: "2026-06-20" });

  await saveDb(db);

  const obsArchived = await handleAddObservation("AG-GUARD-ARCHIVED", { note: "不应该被添加" }, db);
  assertEq(obsArchived.status, 400, "已归档试片通过旧入口添加观察记录被拒绝");
  assert(obsArchived.data.error === "fields_not_allowed", "观察记录拒绝错误类型正确");

  const obsDraft = await handleAddObservation("AG-GUARD-DRAFT", { note: "应该被添加" }, db);
  assertEq(obsDraft.status, 201, "草稿试片通过旧入口添加观察记录成功");

  const pendingFiringTile = {
    id: "AG-GUARD-PENDING-FIRING",
    body: "测试坯体",
    recipe: "松灰42 长石35",
    ashSource: "南山松灰",
    kiln: "K-2",
    peakTemp: 1240,
    status: TILE_STATUSES.PENDING_FIRING,
    statusHistory: [{ from: null, to: TILE_STATUSES.PENDING_FIRING, operator: "test", note: "", at: new Date().toISOString() }],
    batchId: null,
    inventoryDeducted: true,
    score: 0,
    defectTags: [],
    observations: []
  };
  const reviewTile = {
    id: "AG-GUARD-PENDING-REVIEW",
    body: "测试坯体",
    recipe: "松灰42 长石35",
    ashSource: "南山松灰",
    kiln: "K-2",
    peakTemp: 1240,
    status: TILE_STATUSES.PENDING_REVIEW,
    statusHistory: [{ from: null, to: TILE_STATUSES.PENDING_REVIEW, operator: "test", note: "", at: new Date().toISOString() }],
    batchId: null,
    inventoryDeducted: true,
    defects: "原始缺陷",
    defectTags: [],
    observations: [],
    score: 80
  };
  coll.tiles.push(pendingFiringTile, reviewTile);

  const obsWithScorePendingFiring = await handleAddObservation("AG-GUARD-PENDING-FIRING", { note: "观察记录可写但评分不可写", score: 77 }, db);
  assertEq(obsWithScorePendingFiring.status, 400, "待烧成试片通过旧入口添加观察记录时不能顺带修改评分");
  assertEq(coll.tiles.find(t => t.id === "AG-GUARD-PENDING-FIRING").score, 0, "待烧成旧入口拒绝后评分未变化");

  const defectArchived = await handleUpdateTileDefectTags("AG-GUARD-ARCHIVED", { defectTags: [{ name: "缩釉", severity: "severe" }] }, db);
  assertEq(defectArchived.status, 400, "已归档试片通过旧入口更新缺陷标签被拒绝");

  const defectFired = await handleUpdateTileDefectTags("AG-GUARD-FIRED", { defectTags: [{ name: "缩釉", severity: "severe" }] }, db);
  assertEq(defectFired.status, 200, "已烧成试片通过旧入口更新缺陷标签成功");

  const defectTextReview = await handleUpdateTileDefectTags("AG-GUARD-PENDING-REVIEW", {
    defects: "不应该被改写",
    defectTags: [{ name: "缩釉", severity: "mild" }]
  }, db);
  assertEq(defectTextReview.status, 400, "待复盘试片通过旧入口更新缺陷标签时不能顺带修改缺陷文本");
  assertEq(coll.tiles.find(t => t.id === "AG-GUARD-PENDING-REVIEW").defects, "原始缺陷", "待复盘旧入口拒绝后缺陷文本未变化");

  const addDefectArchived = await handleAddDefectTag("AG-GUARD-ARCHIVED", { name: "开裂", severity: "mild" }, db);
  assertEq(addDefectArchived.status, 400, "已归档试片通过旧入口添加缺陷标签被拒绝");

  const addDefectDraft = await handleAddDefectTag("AG-GUARD-DRAFT", { name: "开裂", severity: "mild" }, db);
  assertEq(addDefectDraft.status, 200, "草稿试片通过旧入口添加缺陷标签成功");

  const removeDefectArchived = await handleRemoveDefectTag("AG-GUARD-ARCHIVED", { name: "流釉" }, db);
  assertEq(removeDefectArchived.status, 400, "已归档试片通过旧入口删除缺陷标签被拒绝");

  const batchAddArchived = await handleAddBatchTiles("BATCH-GUARD", { tileIds: ["AG-GUARD-ARCHIVED"] }, db);
  assert(batchAddArchived.data.forbidden.length === 1, "已归档试片加入批次被拒绝（forbidden）");
  assert(batchAddArchived.data.forbidden[0].id === "AG-GUARD-ARCHIVED", "被拒绝的试片 ID 正确");

  const batchAddFired = await handleAddBatchTiles("BATCH-GUARD", { tileIds: ["AG-GUARD-FIRED"] }, db);
  assert(batchAddFired.data.added.length === 1, "已烧成试片可以加入批次");
  assertEq(coll.tiles.find(t => t.id === "AG-GUARD-FIRED").batchId, "BATCH-GUARD", "试片 batchId 已同步更新");

  const batchRemoveArchived = await handleRemoveBatchTiles("BATCH-GUARD", { tileIds: ["AG-GUARD-ARCHIVED"] }, db);
  assert(batchRemoveArchived.data.forbidden.length === 1, "已归档试片从批次移除被拒绝");

  const createResult = await handleCreateTile({
    body: "新试片坯体",
    recipe: "松灰42 长石35"
  }, db);
  assertEq(createResult.status, 201, "创建试片成功");
  const newTile = coll.tiles.find(t => t.id === createResult.data.id);
  assert(newTile.inventoryDeducted === false, "创建试片时库存不扣减（inventoryDeducted=false）");
  assert(newTile.status === TILE_STATUSES.DRAFT, "创建试片初始状态为草稿");
  assert(Array.isArray(newTile.statusHistory), "创建试片有状态历史记录");
}

async function test11_batch_usage_summary() {
  console.log("\nTest 11: 原料批号使用摘要接口");

  await setupMigratedDb();

  const { loadDb, saveDb, getCollections } = await import("../lib/db.js");
  const { handleBatchUsageSummary } = await import("../lib/inventory-routes.js");
  const { TILE_STATUSES } = await import("../lib/tile-status-machine.js");

  const db = await loadDb();
  const coll = getCollections(db);

  console.log("  11.1 不存在的批号返回 404");
  const notFoundResult = await handleBatchUsageSummary("NON-EXISTENT-BATCH", db);
  assertEq(notFoundResult.status, 404, "不存在的批号返回 404");
  assertEq(notFoundResult.data.error, "batch_not_found", "错误类型正确");

  console.log("  11.2 无使用记录的批号返回空摘要");
  const noUsageResult = await handleBatchUsageSummary("SG-2026-001", db);
  assertEq(noUsageResult.status, 200, "无使用记录的批号返回 200");
  assertEq(noUsageResult.data.batchNo, "SG-2026-001", "批号正确");
  assertEq(noUsageResult.data.materialName, "松灰", "原料名称正确");
  assertEq(noUsageResult.data.currentStock, 50, "当前库存正确");
  assertEq(noUsageResult.data.reorderThreshold, 0, "预警阈值正确");
  assertEq(noUsageResult.data.tileCount, 0, "引用试片数为 0");
  assertEq(noUsageResult.data.totalUsed, 0, "累计使用量为 0");
  assert(Array.isArray(noUsageResult.data.tiles), "tiles 是数组");
  assertEq(noUsageResult.data.tiles.length, 0, "tiles 数组为空");
  assert(Array.isArray(noUsageResult.data.consumptionByIngredient), "consumptionByIngredient 是数组");
  assertEq(noUsageResult.data.consumptionByIngredient.length, 0, "consumptionByIngredient 数组为空");
  assert(noUsageResult.data.isLowStock === false, "isLowStock 为 false");

  console.log("  11.3 多试片共用同一批号的使用摘要");
  coll.tiles.push({
    id: "AG-SUMMARY-001",
    body: "粗陶坯",
    recipe: "松灰42 长石35 石英18 红土5",
    ashSource: "南山松灰",
    kiln: "K-2",
    peakTemp: 1240,
    color: "青灰",
    score: 82,
    status: TILE_STATUSES.FIRED,
    statusHistory: [],
    batchId: null,
    inventoryDeducted: true,
    defectTags: [],
    observations: [],
    batchWeight: 10,
    materialBatchRefs: [
      { ingredientName: "松灰", batchNo: "SG-2026-001", deducted: 4.2, unit: "kg" },
      { ingredientName: "长石", batchNo: "CS-2026-001", deducted: 3.5, unit: "kg" },
      { ingredientName: "石英", batchNo: "SY-2026-001", deducted: 1.8, unit: "kg" },
      { ingredientName: "红土", batchNo: "HT-2026-001", deducted: 0.5, unit: "kg" }
    ]
  });

  coll.tiles.push({
    id: "AG-SUMMARY-002",
    body: "细瓷坯",
    recipe: "松灰50 长石30 石英20",
    ashSource: "南山松灰",
    kiln: "K-2",
    peakTemp: 1250,
    color: "月白",
    score: 88,
    status: TILE_STATUSES.DRAFT,
    statusHistory: [],
    batchId: null,
    inventoryDeducted: false,
    defectTags: [],
    observations: [],
    batchWeight: 5,
    materialBatchRefs: [
      { ingredientName: "松灰", batchNo: "SG-2026-001", deducted: 2.5, unit: "kg" },
      { ingredientName: "长石", batchNo: "CS-2026-001", deducted: 1.5, unit: "kg" },
      { ingredientName: "石英", batchNo: "SY-2026-001", deducted: 1.0, unit: "kg" }
    ]
  });

  coll.tiles.push({
    id: "AG-SUMMARY-003",
    body: "粗陶坯",
    recipe: "松灰45 长石40 红土15",
    ashSource: "莫干山竹灰",
    kiln: "K-3",
    peakTemp: 1260,
    color: "",
    score: 0,
    status: TILE_STATUSES.PENDING_FIRING,
    statusHistory: [],
    batchId: null,
    inventoryDeducted: true,
    defectTags: [],
    observations: [],
    batchWeight: 8,
    materialBatchRefs: [
      { ingredientName: "松灰", batchNo: "SG-2026-001", deducted: 3.6, unit: "kg" },
      { ingredientName: "长石", batchNo: "CS-2026-001", deducted: 3.2, unit: "kg" },
      { ingredientName: "红土", batchNo: "HT-2026-001", deducted: 1.2, unit: "kg" }
    ]
  });

  await saveDb(db);

  const multiTileResult = await handleBatchUsageSummary("SG-2026-001", db);
  assertEq(multiTileResult.status, 200, "多试片共用批号返回 200");
  assertEq(multiTileResult.data.batchNo, "SG-2026-001", "批号正确");
  assertEq(multiTileResult.data.materialName, "松灰", "原料名称正确");
  assertEq(multiTileResult.data.tileCount, 3, "引用试片数为 3");
  assertEq(multiTileResult.data.totalUsed, 10.3, "累计使用量正确：4.2+2.5+3.6=10.3");
  assertEq(multiTileResult.data.tiles.length, 3, "tiles 数组有 3 条记录");

  const tile001 = multiTileResult.data.tiles.find(t => t.tileId === "AG-SUMMARY-001");
  assert(tile001, "AG-SUMMARY-001 在 tiles 中");
  assertEq(tile001.ingredientName, "松灰", "成分名称正确");
  assertEq(tile001.deducted, 4.2, "扣用量正确");
  assertEq(tile001.batchWeight, 10, "批次重量正确");
  assertEq(tile001.status, TILE_STATUSES.FIRED, "状态正确");

  const tile002 = multiTileResult.data.tiles.find(t => t.tileId === "AG-SUMMARY-002");
  assert(tile002, "AG-SUMMARY-002 在 tiles 中");
  assertEq(tile002.deducted, 2.5, "AG-SUMMARY-002 扣用量正确");
  assertEq(tile002.status, TILE_STATUSES.DRAFT, "状态正确");

  const tile003 = multiTileResult.data.tiles.find(t => t.tileId === "AG-SUMMARY-003");
  assert(tile003, "AG-SUMMARY-003 在 tiles 中");
  assertEq(tile003.deducted, 3.6, "AG-SUMMARY-003 扣用量正确");
  assertEq(tile003.status, TILE_STATUSES.PENDING_FIRING, "状态正确");

  assertEq(multiTileResult.data.consumptionByIngredient.length, 1, "按成分汇总只有 1 种成分");
  const ingredientSummary = multiTileResult.data.consumptionByIngredient[0];
  assertEq(ingredientSummary.ingredientName, "松灰", "成分名称正确");
  assertEq(ingredientSummary.totalDeducted, 10.3, "总扣用量正确");
  assertEq(ingredientSummary.tileCount, 3, "引用试片数正确");
  assertEq(ingredientSummary.unit, "kg", "单位正确");

  console.log("  11.4 低库存标识正确");
  const lowStockBatch = coll.materialStocks.find(s => s.batchNo === "SG-2026-001");
  lowStockBatch.reorderThreshold = 50;
  lowStockBatch.quantity = 39.7;
  await saveDb(db);

  const lowStockResult = await handleBatchUsageSummary("SG-2026-001", db);
  assertEq(lowStockResult.status, 200, "低库存查询返回 200");
  assert(lowStockResult.data.isLowStock === true, "isLowStock 为 true（39.7 <= 50）");
  assertEq(lowStockResult.data.reorderThreshold, 50, "预警阈值正确");

  console.log("  11.5 验证完整返回结构");
  const fullResult = await handleBatchUsageSummary("CS-2026-001", db);
  assertEq(fullResult.status, 200, "长石批号查询返回 200");
  assertEq(fullResult.data.materialName, "长石", "原料名称正确");
  assertEq(fullResult.data.unit, "kg", "单位正确");
  assertEq(fullResult.data.tileCount, 3, "长石被 3 个试片引用");
  assertEq(fullResult.data.totalUsed, 8.2, "长石总用量：3.5+1.5+3.2=8.2");
  assertEq(fullResult.data.consumptionByIngredient[0].totalDeducted, 8.2, "成分汇总总用量正确");

  assert("currentStock" in fullResult.data, "包含 currentStock 字段");
  assert("reorderThreshold" in fullResult.data, "包含 reorderThreshold 字段");
  assert("isLowStock" in fullResult.data, "包含 isLowStock 字段");
  assert("supplier" in fullResult.data, "包含 supplier 字段");
  assert("entryDate" in fullResult.data, "包含 entryDate 字段");
  assert("totalUsed" in fullResult.data, "包含 totalUsed 字段");
  assert("tiles" in fullResult.data, "包含 tiles 字段");
  assert("consumptionByIngredient" in fullResult.data, "包含 consumptionByIngredient 字段");
}

async function run() {
  try {
    await setupTestEnv();

    await test1_status_machine_validation();
    await test2_permission_rules_validation();
    await test3_data_migration();
    await test4_status_history_recording();
    await test5_normal_workflow();
    await test6_invalid_transitions();
    await test7_batch_status_transition();
    await test8_api_routes_and_filters();
    await test9_legacy_entry_guards();
    await test10_tile_list_advanced_filters();
    await test11_batch_usage_summary();

    console.log(`\n========== Results: ${passed} passed, ${failed} failed ==========`);
    if (failed > 0) {
      console.log("\nFailures:");
      for (const f of failures) console.log(`  - ${f}`);
      process.exit(1);
    }
    console.log("\nAll tests passed!");
  } finally {
    await cleanupTestEnv();
  }
}

run().catch(err => {
  console.error(`Test runner crashed: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
