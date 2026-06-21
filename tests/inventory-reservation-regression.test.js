import { mkdir, writeFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(__dirname);
const testDir = join(projectRoot, "tests", "tmp-reservation-regression");
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

function assertApprox(actual, expected, msg, eps = 0.001) {
  const ok = Math.abs(Number(actual) - Number(expected)) < eps;
  if (ok) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    failures.push(`${msg}: expected ≈${expected}, got ${actual}`);
    console.log(`  ✗ ${msg}: expected ≈${expected}, got ${actual}`);
  }
}

const baseDb = {
  schemaVersion: 4,
  migrations: [
    { version: 1, name: "introduce-schema-version", appliedAt: "2026-06-20T13:00:00.000Z" },
    { version: 2, name: "add-tile-status-fields", appliedAt: "2026-06-20T15:00:00.000Z" },
    { version: 3, name: "add-inventory-reservation", appliedAt: "2026-06-20T17:00:00.000Z" },
    { version: 4, name: "add-business-events", appliedAt: "2026-06-20T19:00:00.000Z" }
  ],
  collections: {
    tiles: [
      {
        id: "AG-REG-001",
        body: "粗陶坯",
        recipe: "松灰42 长石35 石英18 红土5",
        status: "draft",
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
          { ingredientName: "长石", batchNo: "CS-2026-001" },
          { ingredientName: "石英", batchNo: "SY-2026-001" },
          { ingredientName: "红土", batchNo: "HT-2026-001" }
        ],
        batchWeight: 10
      },
      {
        id: "AG-REG-002",
        body: "细瓷坯",
        recipe: "松灰50 长石30 石英20",
        status: "draft",
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
          { ingredientName: "长石", batchNo: "CS-2026-001" },
          { ingredientName: "石英", batchNo: "SY-2026-001" }
        ],
        batchWeight: 5
      },
      {
        id: "AG-REG-003",
        body: "测试坯体",
        recipe: "松灰40 长石60",
        status: "pending_firing",
        statusHistory: [{ from: "draft", to: "pending_firing", operator: "test", at: "2026-06-21T10:00:00.000Z" }],
        batchId: null,
        inventoryDeducted: true,
        inventoryReserved: true,
        inventoryConsumed: false,
        reservationIds: [],
        defectTags: [],
        observations: [],
        materialBatchRefs: [
          { ingredientName: "松灰", batchNo: "SG-2026-001" },
          { ingredientName: "长石", batchNo: "CS-2026-001" }
        ],
        batchWeight: 8
      }
    ],
    firingPlans: [],
    recipes: [],
    recipeVersions: [],
    batches: [],
    businessEvents: [],
    inventoryTransactions: [],
    materialStocks: [
      { id: "MAT-001", name: "松灰", batchNo: "SG-2026-001", quantity: 100, reservedQuantity: 0, unit: "kg", entryDate: "2026-05-15", reorderThreshold: 10, supplier: "南山灰场", notes: "", createdAt: "2026-05-15", updatedAt: "2026-05-15" },
      { id: "MAT-002", name: "长石", batchNo: "CS-2026-001", quantity: 100, reservedQuantity: 0, unit: "kg", entryDate: "2026-05-20", reorderThreshold: 15, supplier: "景德镇矿物站", notes: "", createdAt: "2026-05-20", updatedAt: "2026-05-20" },
      { id: "MAT-003", name: "石英", batchNo: "SY-2026-001", quantity: 100, reservedQuantity: 0, unit: "kg", entryDate: "2026-05-22", reorderThreshold: 10, supplier: "", notes: "", createdAt: "2026-05-22", updatedAt: "2026-05-22" },
      { id: "MAT-004", name: "红土", batchNo: "HT-2026-001", quantity: 100, reservedQuantity: 0, unit: "kg", entryDate: "2026-06-01", reorderThreshold: 5, supplier: "", notes: "", createdAt: "2026-06-01", updatedAt: "2026-06-01" }
    ]
  }
};

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

async function setupTestEnv() {
  await rm(testDir, { recursive: true, force: true });
  await mkdir(testBackupDir, { recursive: true });
  delete process.env.ASH_GLAZE_MIGRATIONS_DIR;
  const db = deepClone(baseDb);
  await writeFile(testDbPath, JSON.stringify(db, null, 2));
}

async function cleanupTestEnv() {
  await rm(testDir, { recursive: true, force: true });
}

async function test1_draft_to_pending_firing_reserve_by_recipe_ratio() {
  console.log("\nTest 1: 草稿→待烧成 按配方比例预留库存（四原料精确计算）");

  await setupTestEnv();
  const { loadDb, getCollections } = await import("../lib/db.js");
  const { TILE_STATUSES } = await import("../lib/tile-status-machine.js");
  const { handleTransitionStatus } = await import("../lib/tile-status-routes.js");
  const { parseIngredients } = await import("../lib/recipe-repository.js");

  const db = await loadDb();
  const coll = getCollections(db);

  const tile = coll.tiles.find(t => t.id === "AG-REG-001");
  assertEq(tile.status, TILE_STATUSES.DRAFT, "初始状态为草稿");
  assertEq(tile.inventoryReserved, false, "初始 inventoryReserved=false");

  const stocksBefore = {
    songHui: coll.materialStocks.find(s => s.id === "MAT-001"),
    changShi: coll.materialStocks.find(s => s.id === "MAT-002"),
    shiYing: coll.materialStocks.find(s => s.id === "MAT-003"),
    hongTu: coll.materialStocks.find(s => s.id === "MAT-004")
  };
  const qtyBefore = {
    songHui: stocksBefore.songHui.quantity,
    changShi: stocksBefore.changShi.quantity,
    shiYing: stocksBefore.shiYing.quantity,
    hongTu: stocksBefore.hongTu.quantity
  };
  const reservedBefore = {
    songHui: stocksBefore.songHui.reservedQuantity || 0,
    changShi: stocksBefore.changShi.reservedQuantity || 0,
    shiYing: stocksBefore.shiYing.reservedQuantity || 0,
    hongTu: stocksBefore.hongTu.reservedQuantity || 0
  };

  const ingredients = parseIngredients(tile.recipe);
  assertEq(ingredients.length, 4, "配方解析出 4 种原料");
  const expectedDeductions = ingredients.map(i => ({
    name: i.name,
    qty: Number(((i.percentage / 100) * tile.batchWeight).toFixed(2))
  }));

  const txnCountBefore = coll.inventoryTransactions.length;

  const result = await handleTransitionStatus("AG-REG-001", {
    targetStatus: TILE_STATUSES.PENDING_FIRING,
    operator: "regression_test",
    note: "回归测试：提交待烧成"
  }, db);

  assertEq(result.status, 200, "草稿→待烧成 接口返回 200");

  const tileAfter = coll.tiles.find(t => t.id === "AG-REG-001");
  assertEq(tileAfter.status, TILE_STATUSES.PENDING_FIRING, "状态变更为待烧成");
  assertEq(tileAfter.inventoryReserved, true, "inventoryReserved=true");
  assertEq(tileAfter.inventoryConsumed, false, "inventoryConsumed=false");
  assert(Array.isArray(tileAfter.reservationIds), "reservationIds 为数组");
  assert(tileAfter.reservationIds.length >= 4, "reservationIds 包含至少 4 条流水 ID");

  const stocksAfter = {
    songHui: coll.materialStocks.find(s => s.id === "MAT-001"),
    changShi: coll.materialStocks.find(s => s.id === "MAT-002"),
    shiYing: coll.materialStocks.find(s => s.id === "MAT-003"),
    hongTu: coll.materialStocks.find(s => s.id === "MAT-004")
  };

  assertEq(stocksAfter.songHui.quantity, qtyBefore.songHui, "松灰 quantity 不变（仅预留）");
  assertEq(stocksAfter.changShi.quantity, qtyBefore.changShi, "长石 quantity 不变（仅预留）");
  assertEq(stocksAfter.shiYing.quantity, qtyBefore.shiYing, "石英 quantity 不变（仅预留）");
  assertEq(stocksAfter.hongTu.quantity, qtyBefore.hongTu, "红土 quantity 不变（仅预留）");

  const songHuiReserveDelta = stocksAfter.songHui.reservedQuantity - reservedBefore.songHui;
  const changShiReserveDelta = stocksAfter.changShi.reservedQuantity - reservedBefore.changShi;
  const shiYingReserveDelta = stocksAfter.shiYing.reservedQuantity - reservedBefore.shiYing;
  const hongTuReserveDelta = stocksAfter.hongTu.reservedQuantity - reservedBefore.hongTu;

  const expectedSongHui = expectedDeductions.find(d => d.name === "松灰").qty;
  const expectedChangShi = expectedDeductions.find(d => d.name === "长石").qty;
  const expectedShiYing = expectedDeductions.find(d => d.name === "石英").qty;
  const expectedHongTu = expectedDeductions.find(d => d.name === "红土").qty;

  assertApprox(songHuiReserveDelta, expectedSongHui, `松灰预留量正确: batchWeight=${tile.batchWeight}kg × 42% = ${expectedSongHui}kg`);
  assertApprox(changShiReserveDelta, expectedChangShi, `长石预留量正确: batchWeight=${tile.batchWeight}kg × 35% = ${expectedChangShi}kg`);
  assertApprox(shiYingReserveDelta, expectedShiYing, `石英预留量正确: batchWeight=${tile.batchWeight}kg × 18% = ${expectedShiYing}kg`);
  assertApprox(hongTuReserveDelta, expectedHongTu, `红土预留量正确: batchWeight=${tile.batchWeight}kg × 5% = ${expectedHongTu}kg`);

  const txnCountAfter = coll.inventoryTransactions.length;
  assertEq(txnCountAfter - txnCountBefore, 4, "新增 4 条库存流水（每原料 1 条）");

  const reserveTxns = coll.inventoryTransactions.filter(
    t => t.tileId === "AG-REG-001" && t.type === "reserve"
  );
  assertEq(reserveTxns.length, 4, "4 条流水均为 reserve 类型");

  for (const txn of reserveTxns) {
    assertEq(txn.status, "active", `流水 ${txn.id} 状态为 active`);
    assert(txn.relatedTransactionId === null, `流水 ${txn.id} 无关联流水`);
    assert(txn.createdAt !== undefined, `流水 ${txn.id} 有 createdAt`);
  }

  const songHuiTxn = reserveTxns.find(t => t.ingredientName === "松灰");
  const changShiTxn = reserveTxns.find(t => t.ingredientName === "长石");
  const shiYingTxn = reserveTxns.find(t => t.ingredientName === "石英");
  const hongTuTxn = reserveTxns.find(t => t.ingredientName === "红土");

  assertApprox(songHuiTxn.quantity, expectedSongHui, `松灰流水 quantity=${expectedSongHui}`);
  assertApprox(changShiTxn.quantity, expectedChangShi, `长石流水 quantity=${expectedChangShi}`);
  assertApprox(shiYingTxn.quantity, expectedShiYing, `石英流水 quantity=${expectedShiYing}`);
  assertApprox(hongTuTxn.quantity, expectedHongTu, `红土流水 quantity=${expectedHongTu}`);

  assertEq(songHuiTxn.batchNo, "SG-2026-001", "松灰流水批号正确");
  assertEq(changShiTxn.batchNo, "CS-2026-001", "长石流水批号正确");
  assertEq(shiYingTxn.batchNo, "SY-2026-001", "石英流水批号正确");
  assertEq(hongTuTxn.batchNo, "HT-2026-001", "红土流水批号正确");
}

async function test2_draft_to_pending_firing_various_weights() {
  console.log("\nTest 2: 草稿→待烧成 不同批次重量下的配方比例预留验证");

  await setupTestEnv();
  const { loadDb, getCollections } = await import("../lib/db.js");
  const { TILE_STATUSES } = await import("../lib/tile-status-machine.js");
  const { handleTransitionStatus } = await import("../lib/tile-status-routes.js");

  const db = await loadDb();
  const coll = getCollections(db);

  const tile = coll.tiles.find(t => t.id === "AG-REG-002");
  tile.materialBatchRefs = [
    { ingredientName: "松灰", batchNo: "SG-2026-001" },
    { ingredientName: "长石", batchNo: "CS-2026-001" },
    { ingredientName: "石英", batchNo: "SY-2026-001" }
  ];
  tile.batchWeight = 3;

  const result1 = await handleTransitionStatus("AG-REG-002", {
    targetStatus: TILE_STATUSES.PENDING_FIRING,
    operator: "regression_test"
  }, db);
  assertEq(result1.status, 200, "3kg 批次提交成功");

  const stocks1 = {
    songHui: coll.materialStocks.find(s => s.id === "MAT-001"),
    changShi: coll.materialStocks.find(s => s.id === "MAT-002"),
    shiYing: coll.materialStocks.find(s => s.id === "MAT-003")
  };
  assertApprox(stocks1.songHui.reservedQuantity, 1.5, "3kg × 50% = 1.5kg 松灰预留");
  assertApprox(stocks1.changShi.reservedQuantity, 0.9, "3kg × 30% = 0.9kg 长石预留");
  assertApprox(stocks1.shiYing.reservedQuantity, 0.6, "3kg × 20% = 0.6kg 石英预留");

  await handleTransitionStatus("AG-REG-002", {
    targetStatus: TILE_STATUSES.DRAFT,
    operator: "regression_test"
  }, db);

  tile.batchWeight = 0.5;
  const result2 = await handleTransitionStatus("AG-REG-002", {
    targetStatus: TILE_STATUSES.PENDING_FIRING,
    operator: "regression_test"
  }, db);
  assertEq(result2.status, 200, "0.5kg 小批次提交成功");

  const stocks2 = {
    songHui: coll.materialStocks.find(s => s.id === "MAT-001"),
    changShi: coll.materialStocks.find(s => s.id === "MAT-002"),
    shiYing: coll.materialStocks.find(s => s.id === "MAT-003")
  };
  assertApprox(stocks2.songHui.reservedQuantity, 0.25, "0.5kg × 50% = 0.25kg 松灰预留");
  assertApprox(stocks2.changShi.reservedQuantity, 0.15, "0.5kg × 30% = 0.15kg 长石预留");
  assertApprox(stocks2.shiYing.reservedQuantity, 0.1, "0.5kg × 20% = 0.1kg 石英预留");
}

async function test3_insufficient_stock_no_status_change_no_partial_txns() {
  console.log("\nTest 3: 库存不足时不改变试片状态，也不留下半截库存流水");

  await setupTestEnv();
  const { loadDb, getCollections } = await import("../lib/db.js");
  const { TILE_STATUSES } = await import("../lib/tile-status-machine.js");
  const { handleTransitionStatus } = await import("../lib/tile-status-routes.js");

  const db = await loadDb();
  const coll = getCollections(db);

  const stockSongHui = coll.materialStocks.find(s => s.id === "MAT-001");
  const stockChangShi = coll.materialStocks.find(s => s.id === "MAT-002");
  const stockShiYing = coll.materialStocks.find(s => s.id === "MAT-003");
  const stockHongTu = coll.materialStocks.find(s => s.id === "MAT-004");

  stockSongHui.quantity = 100;
  stockSongHui.reservedQuantity = 0;
  stockChangShi.quantity = 100;
  stockChangShi.reservedQuantity = 0;
  stockShiYing.quantity = 0.5;
  stockShiYing.reservedQuantity = 0;
  stockHongTu.quantity = 100;
  stockHongTu.reservedQuantity = 0;

  const tile = coll.tiles.find(t => t.id === "AG-REG-001");
  tile.batchWeight = 10;

  const snapshotBefore = {
    tileStatus: tile.status,
    tileInventoryReserved: tile.inventoryReserved,
    tileInventoryConsumed: tile.inventoryConsumed,
    tileReservationIdsLen: (tile.reservationIds || []).length,
    songHuiQty: stockSongHui.quantity,
    songHuiReserved: stockSongHui.reservedQuantity,
    changShiQty: stockChangShi.quantity,
    changShiReserved: stockChangShi.reservedQuantity,
    shiYingQty: stockShiYing.quantity,
    shiYingReserved: stockShiYing.reservedQuantity,
    hongTuQty: stockHongTu.quantity,
    hongTuReserved: stockHongTu.reservedQuantity,
    txnCount: coll.inventoryTransactions.length,
    txnIds: coll.inventoryTransactions.map(t => t.id).sort()
  };

  const result = await handleTransitionStatus("AG-REG-001", {
    targetStatus: TILE_STATUSES.PENDING_FIRING,
    operator: "regression_test",
    note: "库存不足应该失败"
  }, db);

  assertEq(result.status, 409, "库存不足时返回 409");
  assertEq(result.data.error, "insufficient_stock", "错误类型为 insufficient_stock");
  assert(result.data.message.includes("库存不足"), "错误信息包含库存不足描述");
  assert(Array.isArray(result.data.details), "返回 details 错误数组");
  assert(result.data.details.length > 0, "details 至少有 1 条错误");

  const shiYingError = result.data.details.find(e => e.ingredientName === "石英");
  assert(shiYingError !== undefined, "错误详情包含石英库存不足");
  assertEq(shiYingError.error, "insufficient_stock", "石英错误类型正确");
  assert(shiYingError.required !== undefined, "错误详情包含 required 字段");
  assert(shiYingError.available !== undefined, "错误详情包含 available 字段");
  assertApprox(shiYingError.required, 1.8, "石英需要 10kg × 18% = 1.8kg");
  assertApprox(shiYingError.available, 0.5, "石英可用 0.5kg");

  assertEq(tile.status, snapshotBefore.tileStatus, "试片状态未改变（仍为草稿）");
  assertEq(tile.inventoryReserved, snapshotBefore.tileInventoryReserved, "inventoryReserved 未改变");
  assertEq(tile.inventoryConsumed, snapshotBefore.tileInventoryConsumed, "inventoryConsumed 未改变");
  assertEq((tile.reservationIds || []).length, snapshotBefore.tileReservationIdsLen, "reservationIds 未增加");

  assertEq(stockSongHui.quantity, snapshotBefore.songHuiQty, "松灰 quantity 未变（无半截扣减）");
  assertEq(stockSongHui.reservedQuantity, snapshotBefore.songHuiReserved, "松灰 reservedQuantity 未变（无半截预留）");
  assertEq(stockChangShi.quantity, snapshotBefore.changShiQty, "长石 quantity 未变");
  assertEq(stockChangShi.reservedQuantity, snapshotBefore.changShiReserved, "长石 reservedQuantity 未变");
  assertEq(stockShiYing.quantity, snapshotBefore.shiYingQty, "石英 quantity 未变");
  assertEq(stockShiYing.reservedQuantity, snapshotBefore.shiYingReserved, "石英 reservedQuantity 未变");
  assertEq(stockHongTu.quantity, snapshotBefore.hongTuQty, "红土 quantity 未变");
  assertEq(stockHongTu.reservedQuantity, snapshotBefore.hongTuReserved, "红土 reservedQuantity 未变");

  assertEq(coll.inventoryTransactions.length, snapshotBefore.txnCount, "inventoryTransactions 数量未增加");
  const txnIdsAfter = coll.inventoryTransactions.map(t => t.id).sort();
  assertEq(JSON.stringify(txnIdsAfter), JSON.stringify(snapshotBefore.txnIds), "流水 ID 完全一致（无新增半截流水）");

  for (const txn of coll.inventoryTransactions) {
    assert(txn.tileId !== "AG-REG-001", "没有属于 AG-REG-001 的库存流水");
  }
}

async function test4_insufficient_stock_second_material_rollback_first() {
  console.log("\nTest 4: 第 N 种原料库存不足时，前 N-1 种已预留的库存全部回滚");

  await setupTestEnv();
  const { loadDb, getCollections } = await import("../lib/db.js");
  const { TILE_STATUSES } = await import("../lib/tile-status-machine.js");
  const { handleTransitionStatus } = await import("../lib/tile-status-routes.js");

  const db = await loadDb();
  const coll = getCollections(db);

  const tile = coll.tiles.find(t => t.id === "AG-REG-001");
  tile.batchWeight = 10;

  const stocks = coll.materialStocks;
  stocks[0].quantity = 100;
  stocks[0].reservedQuantity = 0;
  stocks[1].quantity = 100;
  stocks[1].reservedQuantity = 0;
  stocks[2].quantity = 0.3;
  stocks[2].reservedQuantity = 0;
  stocks[3].quantity = 100;
  stocks[3].reservedQuantity = 0;

  const initialSongHuiReserved = stocks[0].reservedQuantity;
  const initialChangShiReserved = stocks[1].reservedQuantity;
  const initialShiYingReserved = stocks[2].reservedQuantity;
  const initialHongTuReserved = stocks[3].reservedQuantity;
  const initialTxnCount = coll.inventoryTransactions.length;

  const result = await handleTransitionStatus("AG-REG-001", {
    targetStatus: TILE_STATUSES.PENDING_FIRING,
    operator: "regression_test"
  }, db);

  assertEq(result.status, 409, "石英不足导致整体失败");

  assertEq(stocks[0].reservedQuantity, initialSongHuiReserved, "松灰预留量已回滚（未留下半截）");
  assertEq(stocks[1].reservedQuantity, initialChangShiReserved, "长石预留量已回滚（未留下半截）");
  assertEq(stocks[2].reservedQuantity, initialShiYingReserved, "石英预留量未变");
  assertEq(stocks[3].reservedQuantity, initialHongTuReserved, "红土预留量未变");

  assertEq(coll.inventoryTransactions.length, initialTxnCount, "流水数量未增加（所有已创建流水已回滚删除）");

  assertEq(tile.status, TILE_STATUSES.DRAFT, "试片仍为草稿状态");
  assertEq(tile.inventoryReserved, false, "inventoryReserved 仍为 false");
}

async function test5_pending_firing_to_draft_release_reservation() {
  console.log("\nTest 5: 待烧成→草稿 释放预留量，库存恢复原状");

  await setupTestEnv();
  const { loadDb, getCollections } = await import("../lib/db.js");
  const { TILE_STATUSES } = await import("../lib/tile-status-machine.js");
  const { handleTransitionStatus } = await import("../lib/tile-status-routes.js");

  const db = await loadDb();
  const coll = getCollections(db);

  const tile = coll.tiles.find(t => t.id === "AG-REG-001");
  tile.batchWeight = 10;

  const r1 = await handleTransitionStatus("AG-REG-001", {
    targetStatus: TILE_STATUSES.PENDING_FIRING,
    operator: "regression_test"
  }, db);
  assertEq(r1.status, 200, "先提交到待烧成");

  const stocksAfterReserve = {
    songHui: coll.materialStocks.find(s => s.id === "MAT-001"),
    changShi: coll.materialStocks.find(s => s.id === "MAT-002"),
    shiYing: coll.materialStocks.find(s => s.id === "MAT-003"),
    hongTu: coll.materialStocks.find(s => s.id === "MAT-004")
  };
  const reservedAfterReserve = {
    songHui: stocksAfterReserve.songHui.reservedQuantity,
    changShi: stocksAfterReserve.changShi.reservedQuantity,
    shiYing: stocksAfterReserve.shiYing.reservedQuantity,
    hongTu: stocksAfterReserve.hongTu.reservedQuantity
  };
  const qtyAfterReserve = {
    songHui: stocksAfterReserve.songHui.quantity,
    changShi: stocksAfterReserve.changShi.quantity,
    shiYing: stocksAfterReserve.shiYing.quantity,
    hongTu: stocksAfterReserve.hongTu.quantity
  };
  const txnCountAfterReserve = coll.inventoryTransactions.length;
  const reserveTxnIds = coll.inventoryTransactions
    .filter(t => t.tileId === "AG-REG-001" && t.type === "reserve")
    .map(t => t.id);
  assert(reserveTxnIds.length > 0, "有 reserve 流水");

  const result = await handleTransitionStatus("AG-REG-001", {
    targetStatus: TILE_STATUSES.DRAFT,
    operator: "regression_test",
    note: "退回草稿释放预留"
  }, db);

  assertEq(result.status, 200, "待烧成→草稿 接口返回 200");

  const tileAfter = coll.tiles.find(t => t.id === "AG-REG-001");
  assertEq(tileAfter.status, TILE_STATUSES.DRAFT, "状态变更回草稿");
  assertEq(tileAfter.inventoryReserved, false, "inventoryReserved=false");
  assertEq(tileAfter.inventoryConsumed, false, "inventoryConsumed=false");

  const stocksAfterRelease = {
    songHui: coll.materialStocks.find(s => s.id === "MAT-001"),
    changShi: coll.materialStocks.find(s => s.id === "MAT-002"),
    shiYing: coll.materialStocks.find(s => s.id === "MAT-003"),
    hongTu: coll.materialStocks.find(s => s.id === "MAT-004")
  };

  assertEq(stocksAfterRelease.songHui.quantity, qtyAfterReserve.songHui, "释放后松灰 quantity 不变（从未扣减）");
  assertEq(stocksAfterRelease.changShi.quantity, qtyAfterReserve.changShi, "释放后长石 quantity 不变");
  assertEq(stocksAfterRelease.shiYing.quantity, qtyAfterReserve.shiYing, "释放后石英 quantity 不变");
  assertEq(stocksAfterRelease.hongTu.quantity, qtyAfterReserve.hongTu, "释放后红土 quantity 不变");

  assertApprox(stocksAfterRelease.songHui.reservedQuantity, reservedAfterReserve.songHui - 4.2, "松灰 reservedQuantity 减少 4.2kg");
  assertApprox(stocksAfterRelease.changShi.reservedQuantity, reservedAfterReserve.changShi - 3.5, "长石 reservedQuantity 减少 3.5kg");
  assertApprox(stocksAfterRelease.shiYing.reservedQuantity, reservedAfterReserve.shiYing - 1.8, "石英 reservedQuantity 减少 1.8kg");
  assertApprox(stocksAfterRelease.hongTu.reservedQuantity, reservedAfterReserve.hongTu - 0.5, "红土 reservedQuantity 减少 0.5kg");

  assertEq(stocksAfterRelease.songHui.reservedQuantity, 0, "松灰最终 reservedQuantity=0");
  assertEq(stocksAfterRelease.changShi.reservedQuantity, 0, "长石最终 reservedQuantity=0");
  assertEq(stocksAfterRelease.shiYing.reservedQuantity, 0, "石英最终 reservedQuantity=0");
  assertEq(stocksAfterRelease.hongTu.reservedQuantity, 0, "红土最终 reservedQuantity=0");

  const txnCountAfterRelease = coll.inventoryTransactions.length;
  assertEq(txnCountAfterRelease - txnCountAfterReserve, 4, "新增 4 条 release 流水（每原料 1 条）");

  const releaseTxns = coll.inventoryTransactions.filter(
    t => t.tileId === "AG-REG-001" && t.type === "release"
  );
  assertEq(releaseTxns.length, 4, "4 条 release 流水");

  for (const txn of releaseTxns) {
    assertEq(txn.status, "completed", `release 流水 ${txn.id} 状态为 completed`);
    assert(txn.relatedTransactionId !== null, `release 流水 ${txn.id} 有关联 reserve 流水`);
    assert(reserveTxnIds.includes(txn.relatedTransactionId), `release 流水 ${txn.id} 关联的 reserve 流水存在`);
  }

  const originalReserveTxns = coll.inventoryTransactions.filter(
    t => t.tileId === "AG-REG-001" && t.type === "reserve"
  );
  for (const txn of originalReserveTxns) {
    assertEq(txn.status, "cancelled", `原 reserve 流水 ${txn.id} 状态变为 cancelled`);
  }
}

async function test6_release_restores_exact_reserved_amount() {
  console.log("\nTest 6: 多次预留-释放循环，每次释放量与预留量精确对应");

  await setupTestEnv();
  const { loadDb, getCollections } = await import("../lib/db.js");
  const { TILE_STATUSES } = await import("../lib/tile-status-machine.js");
  const { handleTransitionStatus } = await import("../lib/tile-status-routes.js");

  const db = await loadDb();
  const coll = getCollections(db);

  const tile = coll.tiles.find(t => t.id === "AG-REG-002");
  tile.batchWeight = 5;

  const stockSongHui = coll.materialStocks.find(s => s.id === "MAT-001");
  const initialQty = stockSongHui.quantity;
  const initialReserved = stockSongHui.reservedQuantity || 0;

  for (let i = 1; i <= 3; i++) {
    const r1 = await handleTransitionStatus("AG-REG-002", {
      targetStatus: TILE_STATUSES.PENDING_FIRING,
      operator: "regression_test"
    }, db);
    assertEq(r1.status, 200, `第 ${i} 次预留成功`);
    assertApprox(stockSongHui.reservedQuantity, initialReserved + 2.5, `第 ${i} 次预留后松灰 reserved = ${initialReserved + 2.5}`);
    assertEq(stockSongHui.quantity, initialQty, `第 ${i} 次预留后 quantity 不变`);

    const r2 = await handleTransitionStatus("AG-REG-002", {
      targetStatus: TILE_STATUSES.DRAFT,
      operator: "regression_test"
    }, db);
    assertEq(r2.status, 200, `第 ${i} 次释放成功`);
    assertApprox(stockSongHui.reservedQuantity, initialReserved, `第 ${i} 次释放后松灰 reserved 回到 ${initialReserved}`);
    assertEq(stockSongHui.quantity, initialQty, `第 ${i} 次释放后 quantity 仍不变`);
  }

  assertEq(stockSongHui.quantity, initialQty, "3 轮循环后 quantity 完全如初");
  assertApprox(stockSongHui.reservedQuantity, initialReserved, "3 轮循环后 reservedQuantity 完全如初");
}

async function test7_release_no_reservation_is_idempotent() {
  console.log("\nTest 7: 对无预留的试片执行退回草稿是幂等的，无副作用");

  await setupTestEnv();
  const { loadDb, getCollections } = await import("../lib/db.js");
  const { TILE_STATUSES } = await import("../lib/tile-status-machine.js");
  const { handleTransitionStatus, executeStatusTransition } = await import("../lib/tile-status-routes.js");
  const { releaseStockReservation } = await import("../lib/inventory-repository.js");

  const db = await loadDb();
  const coll = getCollections(db);

  const tile = coll.tiles.find(t => t.id === "AG-REG-001");
  assertEq(tile.status, TILE_STATUSES.DRAFT, "初始状态为草稿");
  assertEq(tile.inventoryReserved, false, "初始无预留");

  const snapshot = {
    songHuiReserved: coll.materialStocks[0].reservedQuantity,
    changShiReserved: coll.materialStocks[1].reservedQuantity,
    txnCount: coll.inventoryTransactions.length
  };

  const releaseResult = releaseStockReservation(db, tile);
  assertEq(releaseResult.released, false, "无预留时释放返回 released=false");
  assertEq(releaseResult.reason, "no_active_reservation", "原因为 no_active_reservation");

  assertEq(coll.materialStocks[0].reservedQuantity, snapshot.songHuiReserved, "释放无预留试片不改变松灰 reservedQuantity");
  assertEq(coll.materialStocks[1].reservedQuantity, snapshot.changShiReserved, "释放无预留试片不改变长石 reservedQuantity");
  assertEq(coll.inventoryTransactions.length, snapshot.txnCount, "释放无预留试片不产生流水");
}

async function test8_pending_firing_with_existing_reservation_release_then_reserve() {
  console.log("\nTest 8: 已处于 pending_firing 的试片（带旧预留），退回草稿再重新提交，旧预留释放+新预留创建");

  await setupTestEnv();
  const { loadDb, getCollections } = await import("../lib/db.js");
  const { TILE_STATUSES } = await import("../lib/tile-status-machine.js");
  const { handleTransitionStatus } = await import("../lib/tile-status-routes.js");
  const { reserveStock } = await import("../lib/inventory-repository.js");
  const { parseIngredients } = await import("../lib/recipe-repository.js");

  const db = await loadDb();
  const coll = getCollections(db);

  const tile = coll.tiles.find(t => t.id === "AG-REG-003");
  tile.batchWeight = 8;

  const ingredients = parseIngredients(tile.recipe);
  const deductions = ingredients.map(i => {
    const ref = tile.materialBatchRefs.find(r => r.ingredientName === i.name);
    const stock = coll.materialStocks.find(s => s.batchNo === ref.batchNo);
    return {
      stockId: stock.id,
      ingredientName: i.name,
      batchNo: ref.batchNo,
      requiredQuantity: Number(((i.percentage / 100) * tile.batchWeight).toFixed(2)),
      unit: stock.unit
    };
  });
  reserveStock(db, tile, deductions);

  const stockSongHui = coll.materialStocks.find(s => s.id === "MAT-001");
  const stockChangShi = coll.materialStocks.find(s => s.id === "MAT-002");
  const reservedAfterInitial = stockSongHui.reservedQuantity;
  assertApprox(reservedAfterInitial, 3.2, "初始预留：8kg × 40% = 3.2kg 松灰");

  const r1 = await handleTransitionStatus("AG-REG-003", {
    targetStatus: TILE_STATUSES.DRAFT,
    operator: "regression_test"
  }, db);
  assertEq(r1.status, 200, "待烧成→草稿 成功");
  assertApprox(stockSongHui.reservedQuantity, 0, "释放后松灰 reservedQuantity=0");

  tile.batchWeight = 10;
  const r2 = await handleTransitionStatus("AG-REG-003", {
    targetStatus: TILE_STATUSES.PENDING_FIRING,
    operator: "regression_test"
  }, db);
  assertEq(r2.status, 200, "草稿→待烧成 重新提交成功");
  assertApprox(stockSongHui.reservedQuantity, 4.0, "重新预留：10kg × 40% = 4.0kg 松灰（按新重量）");
  assertApprox(stockChangShi.reservedQuantity, 6.0, "重新预留：10kg × 60% = 6.0kg 长石");

  const allTxns = coll.inventoryTransactions.filter(t => t.tileId === "AG-REG-003");
  const reserveTxns = allTxns.filter(t => t.type === "reserve");
  const releaseTxns = allTxns.filter(t => t.type === "release");

  assert(reserveTxns.length >= 4, "至少 4 条 reserve 流水（初始 2 条 + 重新预留 2 条）");
  assert(releaseTxns.length >= 2, "至少 2 条 release 流水（释放初始 2 条）");

  const initialReserveCancelled = reserveTxns
    .slice(0, 2)
    .every(t => t.status === "cancelled");
  assert(initialReserveCancelled, "初始 reserve 流水状态均为 cancelled");

  const newReserveActive = reserveTxns
    .slice(-2)
    .every(t => t.status === "active");
  assert(newReserveActive, "新 reserve 流水状态均为 active");
}

async function run() {
  try {
    await test1_draft_to_pending_firing_reserve_by_recipe_ratio();
    await test2_draft_to_pending_firing_various_weights();
    await test3_insufficient_stock_no_status_change_no_partial_txns();
    await test4_insufficient_stock_second_material_rollback_first();
    await test5_pending_firing_to_draft_release_reservation();
    await test6_release_restores_exact_reserved_amount();
    await test7_release_no_reservation_is_idempotent();
    await test8_pending_firing_with_existing_reservation_release_then_reserve();

    console.log(`\n========== Results: ${passed} passed, ${failed} failed ==========`);
    if (failed > 0) {
      console.log("\nFailures:");
      for (const f of failures) console.log(`  - ${f}`);
      process.exit(1);
    }
    console.log("\nAll regression tests passed!");
  } finally {
    await cleanupTestEnv();
  }
}

run().catch(err => {
  console.error(`Test runner crashed: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
