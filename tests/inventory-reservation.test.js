import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(__dirname);
const testDir = join(projectRoot, "tests", "tmp-reservation");
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

const sampleDb = {
  schemaVersion: 2,
  migrations: [
    { version: 1, name: "introduce-schema-version", appliedAt: "2026-06-20T13:00:00.000Z" },
    { version: 2, name: "add-tile-status-fields", appliedAt: "2026-06-20T15:00:00.000Z" }
  ],
  collections: {
    tiles: [
      {
        id: "AG-RES-001",
        body: "粗陶坯",
        recipe: "松灰42 长石35 石英18 红土5",
        status: "pending_firing",
        statusHistory: [{ from: "draft", to: "pending_firing", operator: "test", at: "2026-06-21T10:00:00.000Z" }],
        batchId: null,
        inventoryDeducted: true,
        materialBatchRefs: [
          { ingredientName: "松灰", batchNo: "SG-2026-001", deducted: 4.2, unit: "kg" },
          { ingredientName: "长石", batchNo: "CS-2026-001", deducted: 3.5, unit: "kg" }
        ],
        batchWeight: 10
      },
      {
        id: "AG-RES-002",
        body: "细瓷坯",
        recipe: "松灰42 长石35 石英18 红土5",
        status: "fired",
        statusHistory: [{ from: "pending_firing", to: "fired", operator: "test", at: "2026-06-21T11:00:00.000Z" }],
        batchId: null,
        inventoryDeducted: true,
        materialBatchRefs: [
          { ingredientName: "松灰", batchNo: "SG-2026-001", deducted: 2.1, unit: "kg" },
          { ingredientName: "长石", batchNo: "CS-2026-001", deducted: 1.75, unit: "kg" }
        ],
        batchWeight: 5
      },
      {
        id: "AG-RES-003",
        body: "测试坯",
        recipe: "松灰42 长石35",
        status: "draft",
        statusHistory: [],
        batchId: null,
        inventoryDeducted: false,
        defectTags: [],
        observations: []
      }
    ],
    firingPlans: [],
    recipes: [],
    recipeVersions: [],
    batches: [],
    materialStocks: [
      { id: "MAT-001", name: "松灰", batchNo: "SG-2026-001", quantity: 43.7, unit: "kg", entryDate: "2026-05-15", reorderThreshold: 10, supplier: "南山灰场", notes: "", createdAt: "2026-05-15", updatedAt: "2026-05-15" },
      { id: "MAT-002", name: "长石", batchNo: "CS-2026-001", quantity: 74.75, unit: "kg", entryDate: "2026-05-20", reorderThreshold: 15, supplier: "景德镇矿物站", notes: "", createdAt: "2026-05-20", updatedAt: "2026-05-20" }
    ]
  }
};

async function setupTestEnv() {
  await rm(testDir, { recursive: true, force: true });
  await mkdir(testBackupDir, { recursive: true });
  delete process.env.ASH_GLAZE_MIGRATIONS_DIR;
  await writeFile(testDbPath, JSON.stringify(sampleDb, null, 2));
}

async function cleanupTestEnv() {
  await rm(testDir, { recursive: true, force: true });
}

async function test1_migration_v3() {
  console.log("\nTest 1: v3 迁移 - 库存预留数据结构");

  const { migrateToLatest } = await import("../lib/schema-migration.js");
  const { loadDb, getSchemaVersion, getCollections } = await import("../lib/db.js");

  const result = await migrateToLatest({ autoBackup: false });
  assert(result.success, "v3 迁移执行成功");
  assert(result.toVersion === 3, "迁移后 schemaVersion 为 3");

  const db = await loadDb();
  assertEq(getSchemaVersion(db), 3, "数据库 schemaVersion 为 3");

  const coll = getCollections(db);

  assert(Array.isArray(coll.inventoryTransactions), "inventoryTransactions 集合存在");
  assert(coll.inventoryTransactions.length > 0, "有库存流水记录");

  const tile1 = coll.tiles.find(t => t.id === "AG-RES-001");
  assertEq(tile1.inventoryReserved, true, "pending_firing 试片 inventoryReserved=true");
  assertEq(tile1.inventoryConsumed, false, "pending_firing 试片 inventoryConsumed=false");
  assert(Array.isArray(tile1.reservationIds), "pending_firing 试片有 reservationIds");
  assert(tile1.reservationIds.length > 0, "pending_firing 试片 reservationIds 非空");

  const tile2 = coll.tiles.find(t => t.id === "AG-RES-002");
  assertEq(tile2.inventoryReserved, false, "fired 试片 inventoryReserved=false");
  assertEq(tile2.inventoryConsumed, true, "fired 试片 inventoryConsumed=true");
  assert(Array.isArray(tile2.reservationIds), "fired 试片有 reservationIds");

  const tile3 = coll.tiles.find(t => t.id === "AG-RES-003");
  assertEq(tile3.inventoryReserved, false, "draft 试片 inventoryReserved=false");
  assertEq(tile3.inventoryConsumed, false, "draft 试片 inventoryConsumed=false");

  const stock1 = coll.materialStocks.find(s => s.id === "MAT-001");
  assertEq(stock1.reservedQuantity, 4.2, "松灰 reservedQuantity=4.2（pending_firing 预留）");
  assert(typeof stock1.reservedQuantity === "number", "reservedQuantity 为数字");

  const stock2 = coll.materialStocks.find(s => s.id === "MAT-002");
  assertEq(stock2.reservedQuantity, 3.5, "长石 reservedQuantity=3.5（pending_firing 预留）");

  const reserveTxns = coll.inventoryTransactions.filter(t => t.type === "reserve");
  const confirmTxns = coll.inventoryTransactions.filter(t => t.type === "confirm");
  assert(reserveTxns.length > 0, "有 reserve 类型流水");
  assert(confirmTxns.length > 0, "有 confirm 类型流水（fired 试片）");

  for (const txn of coll.inventoryTransactions) {
    assert(txn.id !== undefined, `流水 ${txn.id} 有 id`);
    assert(txn.tileId !== undefined, `流水 ${txn.id} 有 tileId`);
    assert(txn.stockId !== undefined, `流水 ${txn.id} 有 stockId`);
    assert(txn.quantity > 0, `流水 ${txn.id} quantity > 0`);
    assert(["reserve", "confirm", "release"].includes(txn.type), `流水 ${txn.id} type 有效`);
    assert(["active", "completed", "cancelled"].includes(txn.status), `流水 ${txn.id} status 有效`);
  }
}

async function test2_reserve_flow() {
  console.log("\nTest 2: 草稿→待烧成 库存预留流程");

  await setupTestEnv();
  const { migrateToLatest } = await import("../lib/schema-migration.js");
  await migrateToLatest({ autoBackup: false });

  const { loadDb, saveDb, getCollections } = await import("../lib/db.js");
  const { TILE_STATUSES } = await import("../lib/tile-status-machine.js");
  const { handleTransitionStatus } = await import("../lib/tile-status-routes.js");

  const db = await loadDb();
  const coll = getCollections(db);

  const tile3 = coll.tiles.find(t => t.id === "AG-RES-003");
  tile3.materialBatchRefs = [
    { ingredientName: "松灰", batchNo: "SG-2026-001" },
    { ingredientName: "长石", batchNo: "CS-2026-001" }
  ];
  tile3.batchWeight = 5;

  const stockBefore1 = coll.materialStocks.find(s => s.id === "MAT-001");
  const stockBefore2 = coll.materialStocks.find(s => s.id === "MAT-002");
  const qtyBefore1 = stockBefore1.quantity;
  const qtyBefore2 = stockBefore2.quantity;
  const reservedBefore1 = stockBefore1.reservedQuantity || 0;
  const reservedBefore2 = stockBefore2.reservedQuantity || 0;

  const result = await handleTransitionStatus("AG-RES-003", {
    targetStatus: TILE_STATUSES.PENDING_FIRING,
    operator: "test_user",
    note: "提交待烧成"
  }, db);

  assertEq(result.status, 200, "草稿→待烧成 成功");

  const tileAfter = coll.tiles.find(t => t.id === "AG-RES-003");
  assertEq(tileAfter.inventoryReserved, true, "预留后 inventoryReserved=true");
  assertEq(tileAfter.inventoryConsumed, false, "预留后 inventoryConsumed=false");
  assert(Array.isArray(tileAfter.reservationIds), "预留后有 reservationIds");
  assert(tileAfter.reservationIds.length > 0, "reservationIds 非空");

  const stockAfter1 = coll.materialStocks.find(s => s.id === "MAT-001");
  const stockAfter2 = coll.materialStocks.find(s => s.id === "MAT-002");

  assertEq(stockAfter1.quantity, qtyBefore1, "预留后 quantity 不变（松灰）");
  assertEq(stockAfter2.quantity, qtyBefore2, "预留后 quantity 不变（长石）");

  assert(stockAfter1.reservedQuantity > reservedBefore1, "预留后 reservedQuantity 增加（松灰）");
  assert(stockAfter2.reservedQuantity > reservedBefore2, "预留后 reservedQuantity 增加（长石）");

  const txns = coll.inventoryTransactions.filter(t => t.tileId === "AG-RES-003" && t.type === "reserve");
  assert(txns.length === 2, "生成了 2 条 reserve 流水");
  for (const txn of txns) {
    assertEq(txn.status, "active", `流水 ${txn.id} 状态为 active`);
    assertEq(txn.tileId, "AG-RES-003", `流水 ${txn.id} tileId 正确`);
  }

  await saveDb(db);
}

async function test3_release_flow() {
  console.log("\nTest 3: 待烧成→草稿 释放预留流程");

  await setupTestEnv();
  const { migrateToLatest } = await import("../lib/schema-migration.js");
  await migrateToLatest({ autoBackup: false });

  const { loadDb, saveDb, getCollections } = await import("../lib/db.js");
  const { TILE_STATUSES } = await import("../lib/tile-status-machine.js");
  const { handleTransitionStatus } = await import("../lib/tile-status-routes.js");

  const db = await loadDb();
  const coll = getCollections(db);

  const stockBefore = coll.materialStocks.find(s => s.id === "MAT-001");
  const reservedBefore = stockBefore.reservedQuantity || 0;

  const result = await handleTransitionStatus("AG-RES-001", {
    targetStatus: TILE_STATUSES.DRAFT,
    operator: "test_user",
    note: "退回草稿"
  }, db);

  assertEq(result.status, 200, "待烧成→草稿 成功");

  const tileAfter = coll.tiles.find(t => t.id === "AG-RES-001");
  assertEq(tileAfter.inventoryReserved, false, "释放后 inventoryReserved=false");
  assertEq(tileAfter.inventoryConsumed, false, "释放后 inventoryConsumed=false");

  const stockAfter = coll.materialStocks.find(s => s.id === "MAT-001");
  assert(stockAfter.reservedQuantity < reservedBefore, "释放后 reservedQuantity 减少");

  const releaseTxns = coll.inventoryTransactions.filter(
    t => t.tileId === "AG-RES-001" && t.type === "release"
  );
  assert(releaseTxns.length > 0, "生成了 release 类型流水");

  const reserveTxns = coll.inventoryTransactions.filter(
    t => t.tileId === "AG-RES-001" && t.type === "reserve" && t.status === "cancelled"
  );
  assert(reserveTxns.length > 0, "原始 reserve 流水状态变为 cancelled");

  await saveDb(db);
}

async function test4_confirm_flow() {
  console.log("\nTest 4: 待烧成→已烧成 确认消耗流程");

  await setupTestEnv();
  const { migrateToLatest } = await import("../lib/schema-migration.js");
  await migrateToLatest({ autoBackup: false });

  const { loadDb, saveDb, getCollections } = await import("../lib/db.js");
  const { TILE_STATUSES } = await import("../lib/tile-status-machine.js");
  const { handleTransitionStatus } = await import("../lib/tile-status-routes.js");

  const db = await loadDb();
  const coll = getCollections(db);

  const stockBefore = coll.materialStocks.find(s => s.id === "MAT-001");
  const qtyBefore = stockBefore.quantity;
  const reservedBefore = stockBefore.reservedQuantity || 0;

  const result = await handleTransitionStatus("AG-RES-001", {
    targetStatus: TILE_STATUSES.FIRED,
    operator: "test_user",
    note: "烧成完成"
  }, db);

  assertEq(result.status, 200, "待烧成→已烧成 成功");

  const tileAfter = coll.tiles.find(t => t.id === "AG-RES-001");
  assertEq(tileAfter.inventoryReserved, false, "确认后 inventoryReserved=false");
  assertEq(tileAfter.inventoryConsumed, true, "确认后 inventoryConsumed=true");

  const stockAfter = coll.materialStocks.find(s => s.id === "MAT-001");
  assert(stockAfter.quantity < qtyBefore, "确认后 quantity 减少（实际消耗）");
  assert(stockAfter.reservedQuantity < reservedBefore, "确认后 reservedQuantity 减少（释放预留）");

  const confirmTxns = coll.inventoryTransactions.filter(
    t => t.tileId === "AG-RES-001" && t.type === "confirm"
  );
  assert(confirmTxns.length > 0, "生成了 confirm 类型流水");

  const originalReserveTxns = coll.inventoryTransactions.filter(
    t => t.tileId === "AG-RES-001" && t.type === "reserve" && t.status === "completed"
  );
  assert(originalReserveTxns.length > 0, "原始 reserve 流水状态变为 completed");

  for (const txn of confirmTxns) {
    assert(txn.relatedTransactionId !== null, `confirm 流水 ${txn.id} 关联了 reserve 流水`);
  }

  await saveDb(db);
}

async function test5_negative_stock_protection() {
  console.log("\nTest 5: 库存不能变负数保护");

  await setupTestEnv();
  const { migrateToLatest } = await import("../lib/schema-migration.js");
  await migrateToLatest({ autoBackup: false });

  const { loadDb, saveDb, getCollections } = await import("../lib/db.js");
  const { TILE_STATUSES } = await import("../lib/tile-status-machine.js");
  const { handleTransitionStatus } = await import("../lib/tile-status-routes.js");

  const db = await loadDb();
  const coll = getCollections(db);

  const stock1 = coll.materialStocks.find(s => s.id === "MAT-001");
  stock1.quantity = 0.5;
  stock1.reservedQuantity = 0;

  const tile3 = coll.tiles.find(t => t.id === "AG-RES-003");
  tile3.materialBatchRefs = [
    { ingredientName: "松灰", batchNo: "SG-2026-001" }
  ];
  tile3.batchWeight = 10;

  const result = await handleTransitionStatus("AG-RES-003", {
    targetStatus: TILE_STATUSES.PENDING_FIRING,
    operator: "test_user",
    note: "应该失败"
  }, db);

  assertEq(result.status, 409, "库存不足时返回 409");
  assert(result.data.error === "insufficient_stock", "错误类型为 insufficient_stock");

  const stockAfter = coll.materialStocks.find(s => s.id === "MAT-001");
  assertEq(stockAfter.quantity, 0.5, "库存数量未变");
  assertEq(stockAfter.reservedQuantity, 0, "预留数量未变");

  await saveDb(db);
}

async function test6_full_lifecycle() {
  console.log("\nTest 6: 完整生命周期：预留→释放→重新预留→确认");

  await setupTestEnv();
  const { migrateToLatest } = await import("../lib/schema-migration.js");
  await migrateToLatest({ autoBackup: false });

  const { loadDb, saveDb, getCollections } = await import("../lib/db.js");
  const { TILE_STATUSES } = await import("../lib/tile-status-machine.js");
  const { handleTransitionStatus } = await import("../lib/tile-status-routes.js");

  const db = await loadDb();
  const coll = getCollections(db);

  const tile3 = coll.tiles.find(t => t.id === "AG-RES-003");
  tile3.materialBatchRefs = [
    { ingredientName: "松灰", batchNo: "SG-2026-001" },
    { ingredientName: "长石", batchNo: "CS-2026-001" }
  ];
  tile3.batchWeight = 5;

  const stockBefore = coll.materialStocks.find(s => s.id === "MAT-001");
  const originalQty = stockBefore.quantity;
  const originalReserved = stockBefore.reservedQuantity || 0;

  const r1 = await handleTransitionStatus("AG-RES-003", {
    targetStatus: TILE_STATUSES.PENDING_FIRING,
    operator: "test_user"
  }, db);
  assertEq(r1.status, 200, "1. 草稿→待烧成（预留）成功");

  const reserved1 = coll.materialStocks.find(s => s.id === "MAT-001").reservedQuantity;
  assert(reserved1 > originalReserved, "1. 预留后 reservedQuantity 增加");
  assertEq(coll.materialStocks.find(s => s.id === "MAT-001").quantity, originalQty, "1. 预留后 quantity 不变");

  const r2 = await handleTransitionStatus("AG-RES-003", {
    targetStatus: TILE_STATUSES.DRAFT,
    operator: "test_user"
  }, db);
  assertEq(r2.status, 200, "2. 待烧成→草稿（释放）成功");

  const reserved2 = coll.materialStocks.find(s => s.id === "MAT-001").reservedQuantity;
  assert(reserved2 < reserved1, "2. 释放后 reservedQuantity 减少");
  assertEq(coll.materialStocks.find(s => s.id === "MAT-001").quantity, originalQty, "2. 释放后 quantity 不变");

  const r3 = await handleTransitionStatus("AG-RES-003", {
    targetStatus: TILE_STATUSES.PENDING_FIRING,
    operator: "test_user"
  }, db);
  assertEq(r3.status, 200, "3. 草稿→待烧成（重新预留）成功");

  const reserved3 = coll.materialStocks.find(s => s.id === "MAT-001").reservedQuantity;
  assert(reserved3 > reserved2, "3. 重新预留后 reservedQuantity 增加");

  const r4 = await handleTransitionStatus("AG-RES-003", {
    targetStatus: TILE_STATUSES.FIRED,
    operator: "test_user"
  }, db);
  assertEq(r4.status, 200, "4. 待烧成→已烧成（确认消耗）成功");

  const stockFinal = coll.materialStocks.find(s => s.id === "MAT-001");
  assert(stockFinal.quantity < originalQty, "4. 确认消耗后 quantity 减少");
  assert(stockFinal.reservedQuantity < reserved3, "4. 确认消耗后 reservedQuantity 减少");

  const tileFinal = coll.tiles.find(t => t.id === "AG-RES-003");
  assertEq(tileFinal.inventoryReserved, false, "4. 最终 inventoryReserved=false");
  assertEq(tileFinal.inventoryConsumed, true, "4. 最终 inventoryConsumed=true");

  const allTxns = coll.inventoryTransactions.filter(t => t.tileId === "AG-RES-003");
  const reserveTxns = allTxns.filter(t => t.type === "reserve");
  const releaseTxns = allTxns.filter(t => t.type === "release");
  const confirmTxns = allTxns.filter(t => t.type === "confirm");
  assert(reserveTxns.length === 4, "4. 有 4 条 reserve 流水（2次预留×2原料）");
  assert(releaseTxns.length === 2, "4. 有 2 条 release 流水（1次释放×2原料）");
  assert(confirmTxns.length === 2, "4. 有 2 条 confirm 流水（1次确认×2原料）");

  const cancelledReserves = reserveTxns.filter(t => t.status === "cancelled");
  const completedReserves = reserveTxns.filter(t => t.status === "completed");
  assert(cancelledReserves.length === 2, "4. 第一次 reserve 的 2 条被取消");
  assert(completedReserves.length === 2, "4. 第二次 reserve 的 2 条被确认");

  await saveDb(db);
}

async function test7_transaction_traceability() {
  console.log("\nTest 7: 库存流水可追踪性");

  await setupTestEnv();
  const { migrateToLatest } = await import("../lib/schema-migration.js");
  await migrateToLatest({ autoBackup: false });

  const { loadDb, getCollections } = await import("../lib/db.js");
  const { getTransactionsByTileId, getTransactionsByStockId } = await import("../lib/inventory-repository.js");

  const db = await loadDb();

  const tileTxns = getTransactionsByTileId(db, "AG-RES-001");
  assert(tileTxns.length > 0, "按 tileId 查询流水有结果");
  for (const txn of tileTxns) {
    assertEq(txn.tileId, "AG-RES-001", `流水 ${txn.id} tileId 匹配`);
  }

  const stockTxns = getTransactionsByStockId(db, "MAT-001");
  assert(stockTxns.length > 0, "按 stockId 查询流水有结果");
  for (const txn of stockTxns) {
    assertEq(txn.stockId, "MAT-001", `流水 ${txn.id} stockId 匹配`);
  }

  const confirmTxns = tileTxns.filter(t => t.type === "confirm");
  for (const txn of confirmTxns) {
    assert(txn.relatedTransactionId !== null, `confirm 流水 ${txn.id} 关联了 reserve 流水`);
    const relatedReserve = tileTxns.find(t => t.id === txn.relatedTransactionId);
    assert(relatedReserve !== undefined, `关联的 reserve 流水 ${txn.relatedTransactionId} 存在`);
    assertEq(relatedReserve.type, "reserve", `关联流水类型为 reserve`);
    assertEq(relatedReserve.quantity, txn.quantity, `关联流水数量一致`);
  }
}

async function test8_available_quantity() {
  console.log("\nTest 8: 可用库存计算（quantity - reservedQuantity）");

  const { getAvailableQuantity } = await import("../lib/inventory-repository.js");

  const stock1 = { quantity: 100, reservedQuantity: 30 };
  assertEq(getAvailableQuantity(stock1), 70, "可用库存 = 100 - 30 = 70");

  const stock2 = { quantity: 50, reservedQuantity: 0 };
  assertEq(getAvailableQuantity(stock2), 50, "无预留时可用库存 = 50");

  const stock3 = { quantity: 50 };
  assertEq(getAvailableQuantity(stock3), 50, "缺少 reservedQuantity 时可用库存 = 50");
}

async function test9_rollback_v3() {
  console.log("\nTest 9: v3 迁移回滚");

  await setupTestEnv();
  const { migrateToLatest, rollbackLastMigration } = await import("../lib/schema-migration.js");
  const { loadDb, getSchemaVersion, getCollections } = await import("../lib/db.js");

  await migrateToLatest({ autoBackup: false });

  const dbMigrated = await loadDb();
  assertEq(getSchemaVersion(dbMigrated), 3, "迁移后版本为 3");

  const rbResult = await rollbackLastMigration({ autoBackup: false });
  assert(rbResult.success, "回滚执行成功");

  const dbRolled = await loadDb();
  assertEq(getSchemaVersion(dbRolled), 2, "回滚后版本为 2");

  const coll = getCollections(dbRolled);
  assert(Array.isArray(coll.inventoryTransactions), "回滚后 inventoryTransactions 集合仍存在（KNOWN_COLLECTIONS 保留）");
  assertEq(coll.inventoryTransactions.length, 0, "回滚后 inventoryTransactions 为空数组");

  for (const stock of coll.materialStocks) {
    assert(stock.reservedQuantity === undefined, `stock ${stock.id} reservedQuantity 已移除`);
  }

  for (const tile of coll.tiles) {
    assert(tile.reservationIds === undefined, `tile ${tile.id} reservationIds 已移除`);
    assert(tile.inventoryReserved === undefined, `tile ${tile.id} inventoryReserved 已移除`);
    assert(tile.inventoryConsumed === undefined, `tile ${tile.id} inventoryConsumed 已移除`);
  }

  const stock1 = coll.materialStocks.find(s => s.id === "MAT-001");
  const pendingFiringTile = coll.tiles.find(t => t.id === "AG-RES-001");
  if (pendingFiringTile && pendingFiringTile.inventoryDeducted) {
    const deducted = pendingFiringTile.materialBatchRefs[0]?.deducted || 0;
    assert(stock1.quantity < 50, "回滚后 pending_firing 试片的库存已重新扣减");
  }
}

async function test10_reserve_partial_failure_rollback() {
  console.log("\nTest 10: 预留部分失败时回滚已创建的流水和预留量");

  await setupTestEnv();
  const { loadDb, getCollections } = await import("../lib/db.js");
  const { migrateToLatest } = await import("../lib/schema-migration.js");
  const { reserveStock, ensureInventoryCollection, validateStockForDeduction } = await import("../lib/inventory-repository.js");
  const { parseIngredients } = await import("../lib/recipe-repository.js");

  await migrateToLatest({ autoBackup: false });
  const db = await loadDb();
  const coll = getCollections(db);
  ensureInventoryCollection(db);

  const stock1 = coll.materialStocks.find(s => s.id === "MAT-001");
  stock1.quantity = 100;
  stock1.reservedQuantity = 0;

  const stock2 = coll.materialStocks.find(s => s.id === "MAT-002");
  stock2.quantity = 0.5;
  stock2.reservedQuantity = 0;

  const tile = coll.tiles.find(t => t.id === "AG-RES-001");
  tile.status = "draft";
  tile.inventoryReserved = false;
  tile.inventoryConsumed = false;
  tile.reservationIds = [];
  tile.materialBatchRefs = [
    { ingredientName: "松灰", batchNo: "SG-2026-001" },
    { ingredientName: "长石", batchNo: "CS-2026-001" }
  ];
  tile.batchWeight = 10;

  const ingredients = parseIngredients(tile.recipe);
  const validation = validateStockForDeduction(db, tile.materialBatchRefs, ingredients, tile.batchWeight);
  assert(validation.valid === false, "验证应失败（长石库存不足）");
  assert(validation.errors.length > 0, "有库存不足错误");

  const initialTxnCount = coll.inventoryTransactions.length;
  const initialReserved1 = stock1.reservedQuantity;
  const initialReserved2 = stock2.reservedQuantity;

  const deductions = [
    { stockId: "MAT-001", ingredientName: "松灰", batchNo: "SG-2026-001", requiredQuantity: 4.2, unit: "kg" },
    { stockId: "MAT-002", ingredientName: "长石", batchNo: "CS-2026-001", requiredQuantity: 3.5, unit: "kg" }
  ];

  let threw = false;
  try {
    reserveStock(db, tile, deductions);
  } catch (err) {
    threw = true;
  }
  assert(threw === true, "预留部分失败时抛出异常");

  assertEq(stock1.reservedQuantity, initialReserved1, "失败后松灰 reservedQuantity 回滚");
  assertEq(stock2.reservedQuantity, initialReserved2, "失败后长石 reservedQuantity 回滚");
  assertEq(coll.inventoryTransactions.length, initialTxnCount, "失败后 inventoryTransactions 数量不变（已回滚）");
  assert(tile.inventoryReserved === false, "失败后 tile.inventoryReserved 仍为 false");
}

async function test11_batch_apply_reservation_mode() {
  console.log("\nTest 11: 一键批次应用走预留模式（quantity 不变，reservedQuantity 增加）");

  await setupTestEnv();
  const { loadDb, getCollections } = await import("../lib/db.js");
  const { migrateToLatest } = await import("../lib/schema-migration.js");
  const { handleApplyPlan } = await import("../lib/routes.js");
  const { TILE_STATUSES } = await import("../lib/tile-status-machine.js");

  await migrateToLatest({ autoBackup: false });
  const db = await loadDb();
  const coll = getCollections(db);

  const plan = {
    id: "FP-RESERVE-TEST",
    name: "预留测试规划",
    status: "draft",
    kiln: "K-2",
    peakTemp: 1240,
    holdMinutes: 35,
    heatingStages: [],
    firingCurve: [{ temp: 25, minutes: 0 }, { temp: 1240, minutes: 500 }],
    totalDurationMinutes: 500,
    heatingRates: [],
    risks: [],
    riskCount: { danger: 0, warning: 0, info: 0 },
    similarCurves: [],
    notes: "",
    createdAt: "2026-06-21",
    updatedAt: "2026-06-21",
    appliedTileId: null
  };
  coll.firingPlans.push(plan);

  coll.materialStocks.push(
    { id: "MAT-003", name: "石英", batchNo: "SY-2026-001", quantity: 60, reservedQuantity: 0, unit: "kg", entryDate: "2026-05-22", reorderThreshold: 10 },
    { id: "MAT-004", name: "红土", batchNo: "HT-2026-001", quantity: 30, reservedQuantity: 0, unit: "kg", entryDate: "2026-06-01", reorderThreshold: 10 }
  );

  const stock1 = coll.materialStocks.find(s => s.batchNo === "SG-2026-001");
  const stock2 = coll.materialStocks.find(s => s.batchNo === "CS-2026-001");
  const initialQty1 = stock1.quantity;
  const initialQty2 = stock2.quantity;

  const result = await handleApplyPlan("FP-RESERVE-TEST", {
    applyMode: "batch",
    batchName: "预留模式测试批次",
    plannedDate: "2026-06-25",
    targetAtmosphere: "还原",
    operator: "test_user",
    tiles: [
      {
        id: "AG-BATCH-RESERVE-001",
        body: "粗陶坯",
        recipe: "松灰42 长石35 石英18 红土5",
        ashSource: "南山松灰",
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

  assertEq(result.status, 201, "批次创建成功");

  assertEq(stock1.quantity, initialQty1, "松灰 quantity 不变（预留模式）");
  assert(stock1.reservedQuantity > 0, "松灰 reservedQuantity 增加");
  assertEq(stock2.quantity, initialQty2, "长石 quantity 不变（预留模式）");
  assert(stock2.reservedQuantity > 0, "长石 reservedQuantity 增加");

  const tile = coll.tiles.find(t => t.id === "AG-BATCH-RESERVE-001");
  assertEq(tile.status, TILE_STATUSES.PENDING_FIRING, "试片状态为待烧成");
  assert(tile.inventoryReserved === true, "试片已预留库存");
  assert(tile.inventoryConsumed === false, "试片未消耗库存");

  const reserveTxns = coll.inventoryTransactions.filter(t => t.tileId === "AG-BATCH-RESERVE-001" && t.type === "reserve");
  assert(reserveTxns.length > 0, "生成了 reserve 类型流水");
  for (const txn of reserveTxns) {
    assertEq(txn.status, "active", "reserve 流水状态为 active");
  }
}

async function run() {
  try {
    await setupTestEnv();
    await test1_migration_v3();
    await test2_reserve_flow();
    await test3_release_flow();
    await test4_confirm_flow();
    await test5_negative_stock_protection();
    await test6_full_lifecycle();
    await test7_transaction_traceability();
    await test8_available_quantity();
    await test9_rollback_v3();
    await test10_reserve_partial_failure_rollback();
    await test11_batch_apply_reservation_mode();

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
