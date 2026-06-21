import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(__dirname);
const testDir = join(projectRoot, "tests", "tmp-event");
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

const legacySampleV3 = {
  schemaVersion: 3,
  migrations: [
    { version: 1, name: "introduce-schema-version", appliedAt: "2026-06-20T13:00:13.852Z" },
    { version: 2, name: "add-tile-status-fields", appliedAt: "2026-06-20T15:00:00.000Z" },
    { version: 3, name: "add-inventory-reservation", appliedAt: "2026-06-20T16:00:00.000Z" }
  ],
  collections: {
    tiles: [
      {
        id: "AG-EVT-001",
        body: "粗陶坯",
        recipe: "松灰42 长石35 石英18 红土5",
        ashSource: "南山松灰",
        kiln: "K-2",
        peakTemp: 1240,
        color: "青灰带油滴",
        defects: "边缘流釉",
        defectTags: [{ name: "流釉", severity: "mild", note: "边缘" }],
        score: 82,
        observations: [{ at: "2026-06-10", note: "还原气氛后半段偏强" }],
        recipeVersionId: null,
        status: "archived",
        statusHistory: [
          { from: null, to: "draft", operator: "system", note: "创建试片", at: "2026-06-01T08:00:00.000Z" },
          { from: "draft", to: "pending_firing", operator: "user", note: "提交烧成", at: "2026-06-02T10:00:00.000Z" },
          { from: "pending_firing", to: "fired", operator: "user", note: "烧成完成", at: "2026-06-03T14:00:00.000Z" },
          { from: "fired", to: "pending_review", operator: "user", note: "进入复盘", at: "2026-06-04T09:00:00.000Z" },
          { from: "pending_review", to: "archived", operator: "user", note: "归档", at: "2026-06-05T11:00:00.000Z" }
        ],
        batchId: null,
        inventoryDeducted: true,
        inventoryReserved: false,
        inventoryConsumed: true,
        reservationIds: ["IT-001", "IT-002"],
        materialBatchRefs: [
          { ingredientName: "松灰", batchNo: "SG-2026-001" },
          { ingredientName: "长石", batchNo: "CS-2026-001" }
        ],
        batchWeight: 10
      },
      {
        id: "AG-EVT-002",
        body: "细瓷坯",
        recipe: "稻灰40 长石40 石英18 红土2",
        ashSource: "东北稻灰",
        kiln: "K-1",
        peakTemp: 1260,
        color: "",
        defects: "",
        defectTags: [],
        score: 0,
        observations: [],
        recipeVersionId: null,
        status: "draft",
        statusHistory: [
          { from: null, to: "draft", operator: "system", note: "创建试片", at: "2026-06-10T08:00:00.000Z" }
        ],
        batchId: null,
        inventoryDeducted: false,
        inventoryReserved: false,
        inventoryConsumed: false,
        reservationIds: []
      }
    ],
    firingPlans: [],
    recipes: [],
    recipeVersions: [],
    batches: [
      {
        id: "BATCH-EVT-001",
        name: "测试批次",
        kiln: "K-2",
        plannedDate: "2026-06-15",
        targetAtmosphere: "还原",
        tileIds: ["AG-EVT-001"],
        status: "completed",
        observations: [],
        createdAt: "2026-06-15",
        updatedAt: "2026-06-15"
      }
    ],
    materialStocks: [
      { id: "MAT-EVT-001", name: "松灰", batchNo: "SG-2026-001", quantity: 50, reservedQuantity: 0, unit: "kg", entryDate: "2026-05-15", supplier: "南山灰场", reorderThreshold: 10, notes: "当年春采集", createdAt: "2026-05-15", updatedAt: "2026-05-15" },
      { id: "MAT-EVT-002", name: "长石", batchNo: "CS-2026-001", quantity: 80, reservedQuantity: 0, unit: "kg", entryDate: "2026-05-20", supplier: "景德镇矿物站", reorderThreshold: 15, notes: "钾长石", createdAt: "2026-05-20", updatedAt: "2026-05-20" }
    ],
    inventoryTransactions: [
      { id: "IT-001", tileId: "AG-EVT-001", stockId: "MAT-EVT-001", ingredientName: "松灰", batchNo: "SG-2026-001", quantity: 4.2, unit: "kg", type: "reserve", status: "completed", relatedTransactionId: null, createdAt: "2026-06-02T10:00:00.000Z", note: "草稿→待烧成 库存预留" },
      { id: "IT-002", tileId: "AG-EVT-001", stockId: "MAT-EVT-002", ingredientName: "长石", batchNo: "CS-2026-001", quantity: 3.5, unit: "kg", type: "reserve", status: "completed", relatedTransactionId: null, createdAt: "2026-06-02T10:00:00.000Z", note: "草稿→待烧成 库存预留" }
    ]
  }
};

async function setupTestEnv() {
  await rm(testDir, { recursive: true, force: true });
  await mkdir(testBackupDir, { recursive: true });
  delete process.env.ASH_GLAZE_MIGRATIONS_DIR;
}

async function writeV3Db() {
  await writeFile(testDbPath, JSON.stringify(legacySampleV3, null, 2));
}

async function cleanupTestEnv() {
  await rm(testDir, { recursive: true, force: true });
}

async function test1_migration_up() {
  console.log("\nTest 1: v3→v4 迁移执行 - 业务事件集合创建与回溯");

  await writeV3Db();

  const { migrateToLatest } = await import("../lib/schema-migration.js");
  const { loadDb, getSchemaVersion, getCollections } = await import("../lib/db.js");

  const result = await migrateToLatest({ autoBackup: false });
  assert(result.success, "迁移执行成功");
  assertEq(result.toVersion, 4, "迁移后 schemaVersion 为 4");

  const db = await loadDb();
  assertEq(getSchemaVersion(db), 4, "数据库 schemaVersion 为 4");

  const coll = getCollections(db);
  assert(Array.isArray(coll.businessEvents), "businessEvents 集合已创建");
  assert(coll.businessEvents.length > 0, "businessEvents 有回溯事件");

  const tileCreatedEvents = coll.businessEvents.filter(e => e.type === "tile_created");
  assertEq(tileCreatedEvents.length, 2, "回溯了 2 个试片创建事件");

  const statusEvents = coll.businessEvents.filter(e => e.type === "status_transitioned");
  assert(statusEvents.length >= 5, `回溯了 ${statusEvents.length} 个状态流转事件（>= 5）`);

  const defectEvents = coll.businessEvents.filter(e => e.type === "defect_tags_changed");
  assertEq(defectEvents.length, 1, "回溯了 1 个缺陷标签变更事件");

  const batchEvents = coll.businessEvents.filter(e => e.type === "batch_created");
  assert(batchEvents.length >= 1, "回溯了批次创建事件");

  const batchStatusEvents = coll.businessEvents.filter(e => e.type === "batch_status_changed");
  assert(batchStatusEvents.length >= 1, "回溯了批次状态变更事件");

  const inventoryConfirmedEvents = coll.businessEvents.filter(e => e.type === "inventory_confirmed");
  assertEq(inventoryConfirmedEvents.length, 1, "回溯了 1 个库存确认消耗事件（AG-EVT-001）");
}

async function test2_migration_rollback() {
  console.log("\nTest 2: v4→v3 回滚 - 业务事件集合移除");

  const { rollbackLastMigration } = await import("../lib/schema-migration.js");
  const { loadDb, getSchemaVersion, getCollections } = await import("../lib/db.js");

  const rbResult = await rollbackLastMigration({ autoBackup: false });
  assert(rbResult.success, "回滚执行成功");
  assertEq(rbResult.rolledBack.version, 4, "回滚的版本为 4");

  const db = await loadDb();
  assertEq(getSchemaVersion(db), 3, "回滚后 schemaVersion 为 3");

  const coll = getCollections(db);
  assert(!Array.isArray(coll.businessEvents) || coll.businessEvents.length === 0, "回滚后 businessEvents 集合已清空或移除");

  assertEq(coll.tiles.length, 2, "回滚后 tiles 数据完整");
  assertEq(coll.batches.length, 1, "回滚后 batches 数据完整");
  assertEq(coll.materialStocks.length, 2, "回滚后 materialStocks 数据完整");
}

async function test3_migration_validation() {
  console.log("\nTest 3: 迁移验证函数");

  await writeV3Db();

  const { migrateToLatest } = await import("../lib/schema-migration.js");
  const { loadDb, getCollections } = await import("../lib/db.js");

  await migrateToLatest({ autoBackup: false });
  const db = await loadDb();
  const coll = getCollections(db);

  assert(Array.isArray(coll.businessEvents), "businessEvents 是数组");
  assert(coll.businessEvents.length > 0, "businessEvents 有事件");

  const seenIds = new Set();
  for (const event of coll.businessEvents) {
    assert(event.id !== undefined, `事件有 id 字段`);
    assert(event.type !== undefined, `事件有 type 字段`);
    assert(event.entityId !== undefined, `事件有 entityId 字段`);
    assert(event.entityType !== undefined, `事件有 entityType 字段`);
    assert(event.at !== undefined, `事件有 at 字段`);
    assert(event.typeLabel !== undefined, `事件有 typeLabel 字段`);
    assert(!seenIds.has(event.id), `事件 ID ${event.id} 唯一`);
    seenIds.add(event.id);
  }
}

async function test4_event_log_module() {
  console.log("\nTest 4: event-log 模块核心功能");

  await writeV3Db();
  const { migrateToLatest } = await import("../lib/schema-migration.js");
  await migrateToLatest({ autoBackup: false });

  const { loadDb, saveDb } = await import("../lib/db.js");
  const { recordEvent, getTimeline, getEventsByType, getEventStats, ensureEventCollection, EVENT_TYPES } = await import("../lib/event-log.js");

  const db = await loadDb();

  const eventBeforeCount = db.collections.businessEvents.length;

  const newEvent = recordEvent(db, {
    type: EVENT_TYPES.TILE_CREATED,
    entityId: "AG-TEST-NEW",
    entityType: "tile",
    payload: { body: "测试坯体" },
    operator: "test_user",
    note: "测试创建事件"
  });

  assert(newEvent.id !== undefined, "recordEvent 返回有 id 的事件");
  assertEq(newEvent.type, EVENT_TYPES.TILE_CREATED, "事件类型正确");
  assertEq(newEvent.entityId, "AG-TEST-NEW", "实体 ID 正确");
  assertEq(newEvent.operator, "test_user", "操作者正确");
  assertEq(db.collections.businessEvents.length, eventBeforeCount + 1, "事件数量增加 1");

  const timeline = getTimeline(db, "AG-EVT-001");
  assert(timeline.total > 0, "AG-EVT-001 有时间线事件");
  assert(timeline.events.length > 0, "时间线返回事件列表");
  assertEq(timeline.entityId, "AG-EVT-001", "时间线 entityId 正确");

  for (const e of timeline.events) {
    assertEq(e.entityId, "AG-EVT-001", `事件 ${e.id} 的 entityId 匹配`);
  }

  const tileCreatedEvents = getEventsByType(db, EVENT_TYPES.TILE_CREATED);
  assert(tileCreatedEvents.total > 0, "按类型查询返回结果");
  for (const e of tileCreatedEvents.events) {
    assertEq(e.type, EVENT_TYPES.TILE_CREATED, "按类型过滤的事件类型正确");
  }

  const timelineWithFilter = getTimeline(db, "AG-EVT-001", { type: EVENT_TYPES.STATUS_TRANSITIONED });
  assert(timelineWithFilter.total > 0, "带类型过滤的时间线有结果");
  for (const e of timelineWithFilter.events) {
    assertEq(e.type, EVENT_TYPES.STATUS_TRANSITIONED, "过滤后事件类型正确");
  }

  const timelineWithEntityType = getTimeline(db, "AG-EVT-001", { entityType: "tile" });
  assert(timelineWithEntityType.total > 0, "带实体类型过滤的时间线有结果");

  const stats = getEventStats(db);
  assert(stats.totalEvents > 0, "事件统计总数大于 0");
  assert(typeof stats.byType === "object", "按类型统计是对象");
  assert(typeof stats.byEntityType === "object", "按实体类型统计是对象");

  await saveDb(db);
}

async function test5_timeline_api() {
  console.log("\nTest 5: 时间线 API 接口");

  await writeV3Db();
  const { migrateToLatest } = await import("../lib/schema-migration.js");
  await migrateToLatest({ autoBackup: false });

  const { loadDb } = await import("../lib/db.js");
  const { handleGetEntityTimeline, handleGetEventsByType, handleGetEventStats, handleGetEventTypes } = await import("../lib/event-routes.js");

  const db = await loadDb();

  const timelineResult = await handleGetEntityTimeline("AG-EVT-001", new URL("http://localhost/events"), db);
  assertEq(timelineResult.status, 200, "获取实体时间线返回 200");
  assert(timelineResult.data.total > 0, "时间线有事件");
  assert(Array.isArray(timelineResult.data.events), "时间线返回 events 数组");
  assertEq(timelineResult.data.entityId, "AG-EVT-001", "entityId 正确");

  const timelineWithLimit = await handleGetEntityTimeline("AG-EVT-001", new URL("http://localhost/events?limit=2"), db);
  assertEq(timelineWithLimit.data.events.length, Math.min(2, timelineWithLimit.data.total), "limit 参数限制返回数量");

  const timelineWithOffset = await handleGetEntityTimeline("AG-EVT-001", new URL("http://localhost/events?offset=1"), db);
  assertEq(timelineWithOffset.data.offset, 1, "offset 参数正确传递");

  const noEventsResult = await handleGetEntityTimeline("NON-EXISTENT", new URL("http://localhost/events"), db);
  assertEq(noEventsResult.status, 200, "不存在的实体返回 200");
  assertEq(noEventsResult.data.total, 0, "不存在的实体事件数为 0");

  const statsResult = await handleGetEventStats(db);
  assertEq(statsResult.status, 200, "事件统计接口返回 200");
  assert(statsResult.data.totalEvents > 0, "统计总数大于 0");

  const typesResult = await handleGetEventTypes();
  assertEq(typesResult.status, 200, "事件类型列表返回 200");
  assert(Array.isArray(typesResult.data.types), "类型列表是数组");
  assert(typesResult.data.types.length > 0, "有事件类型");

  const byTypeResult = await handleGetEventsByType("tile_created", new URL("http://localhost/events"), db);
  assertEq(byTypeResult.status, 200, "按类型查询返回 200");
  assert(byTypeResult.data.total > 0, "tile_created 类型有事件");

  const invalidTypeResult = await handleGetEventsByType("invalid_type", new URL("http://localhost/events"), db);
  assertEq(invalidTypeResult.status, 400, "无效类型返回 400");
}

async function test6_new_tile_creation_event() {
  console.log("\nTest 6: 新建试片写入事件");

  await writeV3Db();
  const { migrateToLatest } = await import("../lib/schema-migration.js");
  await migrateToLatest({ autoBackup: false });

  const { loadDb, saveDb, getCollections } = await import("../lib/db.js");
  const { handleCreateTile } = await import("../lib/routes.js");
  const { ensureEventCollection } = await import("../lib/event-log.js");

  const db = await loadDb();
  const eventCountBefore = getCollections(db).businessEvents.length;

  const result = await handleCreateTile({
    body: "测试坯体",
    recipe: "松灰42 长石35",
    ashSource: "测试灰源",
    kiln: "K-1",
    peakTemp: 1200
  }, db);

  assertEq(result.status, 201, "创建试片成功");

  ensureEventCollection(db);
  const eventsAfter = getCollections(db).businessEvents;
  assert(eventsAfter.length > eventCountBefore, "创建试片后事件数增加");

  const tileCreatedEvent = eventsAfter.find(e => e.type === "tile_created" && e.entityId === result.data.id);
  assert(tileCreatedEvent !== undefined, "找到了对应的 tile_created 事件");
  assertEq(tileCreatedEvent.payload.body, "测试坯体", "事件 payload 包含坯体信息");
  assertEq(tileCreatedEvent.payload.recipe, "松灰42 长石35", "事件 payload 包含配方信息");
}

async function test7_status_transition_event() {
  console.log("\nTest 7: 状态流转写入事件");

  await writeV3Db();
  const { migrateToLatest } = await import("../lib/schema-migration.js");
  await migrateToLatest({ autoBackup: false });

  const { loadDb, saveDb, getCollections } = await import("../lib/db.js");
  const { TILE_STATUSES } = await import("../lib/tile-status-machine.js");
  const { handleTransitionStatus } = await import("../lib/tile-status-routes.js");
  const { ensureEventCollection } = await import("../lib/event-log.js");

  const db = await loadDb();
  const coll = getCollections(db);

  const testTile = {
    id: "AG-EVT-STATUS",
    body: "粗陶坯",
    recipe: "松灰42 长石35",
    status: TILE_STATUSES.DRAFT,
    statusHistory: [],
    batchId: null,
    inventoryDeducted: false,
    inventoryReserved: false,
    inventoryConsumed: false,
    reservationIds: [],
    defectTags: [],
    observations: [],
    materialBatchRefs: [
      { ingredientName: "松灰", batchNo: "SG-2026-001" },
      { ingredientName: "长石", batchNo: "CS-2026-001" }
    ],
    batchWeight: 5
  };
  coll.tiles.push(testTile);

  const eventCountBefore = coll.businessEvents.length;

  const result = await handleTransitionStatus("AG-EVT-STATUS", {
    targetStatus: TILE_STATUSES.PENDING_FIRING,
    operator: "test_user",
    note: "测试状态流转"
  }, db);

  assertEq(result.status, 200, "状态流转成功");

  ensureEventCollection(db);
  const eventsAfter = getCollections(db).businessEvents;
  assert(eventsAfter.length > eventCountBefore, "状态流转后事件数增加");

  const statusEvent = eventsAfter[eventsAfter.length - 1];
  assertEq(statusEvent.type, "status_transitioned", "事件类型为 status_transitioned");
  assertEq(statusEvent.entityId, "AG-EVT-STATUS", "实体 ID 正确");
  assertEq(statusEvent.payload.from, TILE_STATUSES.DRAFT, "from 状态正确");
  assertEq(statusEvent.payload.to, TILE_STATUSES.PENDING_FIRING, "to 状态正确");
  assertEq(statusEvent.operator, "test_user", "操作者正确");
}

async function test8_defect_tag_events() {
  console.log("\nTest 8: 缺陷标签变更写入事件");

  await writeV3Db();
  const { migrateToLatest } = await import("../lib/schema-migration.js");
  await migrateToLatest({ autoBackup: false });

  const { loadDb, saveDb, getCollections } = await import("../lib/db.js");
  const { TILE_STATUSES } = await import("../lib/tile-status-machine.js");
  const { handleUpdateTileDefectTags, handleAddDefectTag, handleRemoveDefectTag } = await import("../lib/defect-routes.js");
  const { ensureEventCollection } = await import("../lib/event-log.js");

  const db = await loadDb();
  const coll = getCollections(db);

  const testTile = {
    id: "AG-EVT-DEFECT",
    body: "粗陶坯",
    recipe: "松灰42 长石35",
    status: TILE_STATUSES.FIRED,
    statusHistory: [],
    batchId: null,
    inventoryDeducted: false,
    defectTags: [],
    observations: []
  };
  coll.tiles.push(testTile);

  const eventCountBefore = coll.businessEvents.length;

  const addResult = await handleAddDefectTag("AG-EVT-DEFECT", {
    name: "针孔",
    severity: "mild",
    note: "少量"
  }, db);

  assertEq(addResult.status, 200, "添加缺陷标签成功");

  ensureEventCollection(db);
  const eventsAfterAdd = getCollections(db).businessEvents;
  assert(eventsAfterAdd.length > eventCountBefore, "添加缺陷标签后事件数增加");

  const addEvent = eventsAfterAdd[eventsAfterAdd.length - 1];
  assertEq(addEvent.type, "defect_tags_changed", "事件类型为 defect_tags_changed");
  assertEq(addEvent.payload.action, "add", "action 为 add");
  assertEq(addEvent.payload.addedTag.name, "针孔", "添加的标签名称正确");

  const eventCountBefore2 = eventsAfterAdd.length;

  const removeResult = await handleRemoveDefectTag("AG-EVT-DEFECT", {
    name: "针孔"
  }, db);

  assertEq(removeResult.status, 200, "移除缺陷标签成功");

  ensureEventCollection(db);
  const eventsAfterRemove = getCollections(db).businessEvents;
  assert(eventsAfterRemove.length > eventCountBefore2, "移除缺陷标签后事件数增加");

  const removeEvent = eventsAfterRemove[eventsAfterRemove.length - 1];
  assertEq(removeEvent.type, "defect_tags_changed", "移除事件类型为 defect_tags_changed");
  assertEq(removeEvent.payload.action, "remove", "action 为 remove");
  assertEq(removeEvent.payload.removedTag, "针孔", "移除的标签名称正确");
}

async function test9_recipe_version_event() {
  console.log("\nTest 9: 配方版本创建写入事件");

  await writeV3Db();
  const { migrateToLatest } = await import("../lib/schema-migration.js");
  await migrateToLatest({ autoBackup: false });

  const { loadDb, saveDb, getCollections } = await import("../lib/db.js");
  const { handleCreateRecipe, handleCreateVersion } = await import("../lib/recipe-routes.js");
  const { ensureEventCollection } = await import("../lib/event-log.js");

  const db = await loadDb();

  const eventCountBefore = getCollections(db).businessEvents.length;

  const createResult = await handleCreateRecipe({
    name: "测试配方",
    text: "松灰42 长石35 石英18 红土5"
  }, db);

  assertEq(createResult.status, 201, "创建配方成功");

  ensureEventCollection(db);
  const eventsAfterCreate = getCollections(db).businessEvents;
  assert(eventsAfterCreate.length > eventCountBefore, "创建配方后事件数增加");

  const recipeEvent = eventsAfterCreate[eventsAfterCreate.length - 1];
  assertEq(recipeEvent.type, "recipe_version_created", "事件类型为 recipe_version_created");
  assertEq(recipeEvent.payload.version, 1, "版本号为 1");

  const eventCountBefore2 = eventsAfterCreate.length;

  const versionResult = await handleCreateVersion(createResult.data.recipe.id, {
    text: "松灰45 长石32 石英18 红土5",
    note: "调整松灰比例"
  }, db);

  assertEq(versionResult.status, 201, "创建新版本成功");

  ensureEventCollection(db);
  const eventsAfterVersion = getCollections(db).businessEvents;
  assert(eventsAfterVersion.length > eventCountBefore2, "创建新版本后事件数增加");

  const versionEvent = eventsAfterVersion[eventsAfterVersion.length - 1];
  assertEq(versionEvent.type, "recipe_version_created", "新版本事件类型正确");
  assertEq(versionEvent.payload.version, 2, "新版本号为 2");
}

async function test10_batch_events() {
  console.log("\nTest 10: 批次操作写入事件");

  await writeV3Db();
  const { migrateToLatest } = await import("../lib/schema-migration.js");
  await migrateToLatest({ autoBackup: false });

  const { loadDb, saveDb, getCollections } = await import("../lib/db.js");
  const { handleCreateBatch, handleAdvanceBatchStatus, handleAddBatchTiles } = await import("../lib/batch-routes.js");
  const { ensureEventCollection } = await import("../lib/event-log.js");

  const db = await loadDb();

  const eventCountBefore = getCollections(db).businessEvents.length;

  const createResult = await handleCreateBatch({
    name: "事件测试批次",
    kiln: "K-2"
  }, db);

  assertEq(createResult.status, 201, "创建批次成功");

  ensureEventCollection(db);
  const eventsAfterCreate = getCollections(db).businessEvents;
  assert(eventsAfterCreate.length > eventCountBefore, "创建批次后事件数增加");

  const batchEvent = eventsAfterCreate[eventsAfterCreate.length - 1];
  assertEq(batchEvent.type, "batch_created", "事件类型为 batch_created");
  assertEq(batchEvent.entityId, createResult.data.id, "实体 ID 为批次 ID");

  const eventCountBefore2 = eventsAfterCreate.length;

  const advanceResult = await handleAdvanceBatchStatus(createResult.data.id, {
    status: "loading",
    note: "开始装窑"
  }, db);

  assertEq(advanceResult.status, 200, "批次状态推进成功");

  ensureEventCollection(db);
  const eventsAfterAdvance = getCollections(db).businessEvents;
  assert(eventsAfterAdvance.length > eventCountBefore2, "批次状态推进后事件数增加");

  const statusEvent = eventsAfterAdvance[eventsAfterAdvance.length - 1];
  assertEq(statusEvent.type, "batch_status_changed", "事件类型为 batch_status_changed");
  assertEq(statusEvent.payload.from, "planned", "from 状态正确");
  assertEq(statusEvent.payload.to, "loading", "to 状态正确");
}

async function test11_full_workflow_with_events() {
  console.log("\nTest 11: 旧数据迁移后完整业务流程验证");

  await writeV3Db();
  const { migrateToLatest } = await import("../lib/schema-migration.js");
  const { loadDb, saveDb, getCollections } = await import("../lib/db.js");
  const { TILE_STATUSES } = await import("../lib/tile-status-machine.js");

  await migrateToLatest({ autoBackup: false });
  const db = await loadDb();

  const { handleCreateTile } = await import("../lib/routes.js");
  const { handleTransitionStatus } = await import("../lib/tile-status-routes.js");
  const { handleUpdateTileDefectTags, handleAddDefectTag } = await import("../lib/defect-routes.js");
  const { handleCreateRecipe, handleCreateVersion } = await import("../lib/recipe-routes.js");
  const { handleCreateBatch } = await import("../lib/batch-routes.js");
  const { handleGetEntityTimeline } = await import("../lib/event-routes.js");
  const { ensureEventCollection } = await import("../lib/event-log.js");

  const createResult = await handleCreateTile({
    body: "工作流测试坯",
    recipe: "松灰42 长石35",
    ashSource: "南山松灰",
    kiln: "K-2",
    peakTemp: 1240,
    materialBatchRefs: [
      { ingredientName: "松灰", batchNo: "SG-2026-001" },
      { ingredientName: "长石", batchNo: "CS-2026-001" }
    ],
    batchWeight: 5
  }, db);

  assertEq(createResult.status, 201, "创建试片成功");
  const tileId = createResult.data.id;

  const transResult = await handleTransitionStatus(tileId, {
    targetStatus: TILE_STATUSES.PENDING_FIRING,
    operator: "workflow_user",
    note: "提交烧成"
  }, db);
  assertEq(transResult.status, 200, "状态流转 draft→pending_firing 成功");

  const transResult2 = await handleTransitionStatus(tileId, {
    targetStatus: TILE_STATUSES.FIRED,
    operator: "workflow_user",
    note: "烧成完成"
  }, db);
  assertEq(transResult2.status, 200, "状态流转 pending_firing→fired 成功");

  const defectResult = await handleAddDefectTag(tileId, {
    name: "缩釉",
    severity: "medium",
    note: "局部"
  }, db);
  assertEq(defectResult.status, 200, "添加缺陷标签成功");

  const recipeResult = await handleCreateRecipe({
    name: "工作流测试配方",
    text: "松灰50 长石30 石英15 红土5"
  }, db);
  assertEq(recipeResult.status, 201, "创建配方成功");

  const batchResult = await handleCreateBatch({
    name: "工作流测试批次",
    kiln: "K-2"
  }, db);
  assertEq(batchResult.status, 201, "创建批次成功");

  ensureEventCollection(db);
  const timelineResult = await handleGetEntityTimeline(tileId, new URL("http://localhost/events"), db);
  assertEq(timelineResult.status, 200, "获取试片时间线成功");
  assert(timelineResult.data.total >= 4, `试片时间线事件数 >= 4 (实际: ${timelineResult.data.total})`);

  const typesInTimeline = timelineResult.data.events.map(e => e.type);
  assert(typesInTimeline.includes("tile_created"), "时间线包含 tile_created");
  assert(typesInTimeline.includes("status_transitioned"), "时间线包含 status_transitioned");
  assert(typesInTimeline.includes("inventory_reserved"), "时间线包含 inventory_reserved");
  assert(typesInTimeline.includes("inventory_confirmed"), "时间线包含 inventory_confirmed");
  assert(typesInTimeline.includes("defect_tags_changed"), "时间线包含 defect_tags_changed");

  const coll = getCollections(db);
  assertEq(coll.tiles.length, 3, "试片数量正确（2个旧+1个新）");
  assertEq(coll.materialStocks.length, 2, "库存数据完整");
  assertEq(coll.inventoryTransactions.length > 0, true, "库存流水记录存在");
}

async function test12_api_compatibility() {
  console.log("\nTest 12: API 响应兼容性验证 - 确保旧接口不受影响");

  await writeV3Db();
  const { migrateToLatest } = await import("../lib/schema-migration.js");
  const { loadDb, getCollections } = await import("../lib/db.js");
  const { TILE_STATUSES } = await import("../lib/tile-status-machine.js");

  await migrateToLatest({ autoBackup: false });
  const db = await loadDb();

  const { handleListTiles, handleGetTile, handleCreateTile } = await import("../lib/routes.js");
  const { handleGetTileStatus, handleGetStatusHistory } = await import("../lib/tile-status-routes.js");
  const { handleListRecipes } = await import("../lib/recipe-routes.js");
  const { handleListBatches } = await import("../lib/batch-routes.js");
  const { handleListInventory } = await import("../lib/inventory-routes.js");

  const listResult = await handleListTiles(new URL("http://localhost/tiles"), db);
  assertEq(listResult.status, 200, "GET /tiles 返回 200");
  assert(Array.isArray(listResult.data), "返回数组");
  assert(listResult.data.length >= 2, "包含旧数据");

  const tileResult = await handleGetTile("AG-EVT-001", db);
  assertEq(tileResult.status, 200, "GET /tiles/:id 返回 200");
  assertEq(tileResult.data.id, "AG-EVT-001", "返回正确的试片");
  assert(tileResult.data.status !== undefined, "返回包含 status 字段");
  assert(Array.isArray(tileResult.data.statusHistory), "返回包含 statusHistory 字段");
  assert(tileResult.data.recipeVersion !== undefined || tileResult.data.recipeVersionId !== undefined, "返回包含配方版本信息");

  const statusResult = await handleGetTileStatus("AG-EVT-001", db);
  assertEq(statusResult.status, 200, "GET /tiles/:id/status 返回 200");
  assertEq(statusResult.data.status, TILE_STATUSES.ARCHIVED, "状态正确");

  const historyResult = await handleGetStatusHistory("AG-EVT-001", db);
  assertEq(historyResult.status, 200, "GET /tiles/:id/status-history 返回 200");
  assert(Array.isArray(historyResult.data.history), "返回历史数组");

  const recipeListResult = await handleListRecipes(new URL("http://localhost/recipes"), db);
  assertEq(recipeListResult.status, 200, "GET /recipes 返回 200");

  const batchListResult = await handleListBatches(new URL("http://localhost/batches"), db);
  assertEq(batchListResult.status, 200, "GET /batches 返回 200");

  const inventoryListResult = await handleListInventory(new URL("http://localhost/inventory"), db);
  assertEq(inventoryListResult.status, 200, "GET /inventory 返回 200");

  const createResult = await handleCreateTile({
    body: "兼容性测试坯体",
    recipe: "松灰42 长石35"
  }, db);
  assertEq(createResult.status, 201, "POST /tiles 返回 201");
  assert(createResult.data.id !== undefined, "响应包含 id");
  assert(createResult.data.status === TILE_STATUSES.DRAFT, "响应包含 status");
  assert(Array.isArray(createResult.data.statusHistory), "响应包含 statusHistory");
}

async function test13_event_ordering_and_dedup() {
  console.log("\nTest 13: 事件排序与唯一性");

  await writeV3Db();
  const { migrateToLatest } = await import("../lib/schema-migration.js");
  const { loadDb, getCollections } = await import("../lib/db.js");
  const { getTimeline } = await import("../lib/event-log.js");

  await migrateToLatest({ autoBackup: false });
  const db = await loadDb();

  const events = getCollections(db).businessEvents;
  const ids = events.map(e => e.id);
  const uniqueIds = new Set(ids);
  assertEq(uniqueIds.size, ids.length, "所有事件 ID 唯一");

  const timeline = getTimeline(db, "AG-EVT-001");
  for (let i = 1; i < timeline.events.length; i++) {
    assert(timeline.events[i].at >= timeline.events[i - 1].at,
      `事件 ${timeline.events[i].id} 按时间排序（${timeline.events[i].at} >= ${timeline.events[i - 1].at}）`);
  }
}

async function run() {
  try {
    await setupTestEnv();
    await test1_migration_up();
    await test2_migration_rollback();
    await test3_migration_validation();
    await test4_event_log_module();
    await test5_timeline_api();
    await test6_new_tile_creation_event();
    await test7_status_transition_event();
    await test8_defect_tag_events();
    await test9_recipe_version_event();
    await test10_batch_events();
    await test11_full_workflow_with_events();
    await test12_api_compatibility();
    await test13_event_ordering_and_dedup();

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
