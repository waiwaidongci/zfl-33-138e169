import { getCollections } from "./db.js";

export function ensureInventoryCollection(db) {
  const coll = getCollections(db);
  if (!coll.materialStocks) coll.materialStocks = [];
  if (!coll.inventoryTransactions) coll.inventoryTransactions = [];
}

export function getStockIds(db) {
  ensureInventoryCollection(db);
  const coll = getCollections(db);
  return new Set(coll.materialStocks.map(s => s.id));
}

export function generateStockId(db) {
  ensureInventoryCollection(db);
  let counter = getCollections(db).materialStocks.length + 1;
  let id;
  const existing = getStockIds(db);
  do {
    id = `MAT-${String(counter).padStart(3, "0")}`;
    counter++;
  } while (existing.has(id));
  return id;
}

function generateTransactionId(db) {
  ensureInventoryCollection(db);
  const coll = getCollections(db);
  const existing = new Set(coll.inventoryTransactions.map(t => t.id));
  let counter = coll.inventoryTransactions.length + 1;
  let id;
  do {
    id = `IT-${String(counter).padStart(3, "0")}`;
    counter++;
  } while (existing.has(id));
  return id;
}

export function listStocks(db, filters) {
  ensureInventoryCollection(db);
  const coll = getCollections(db);
  let rows = coll.materialStocks.slice();
  if (filters.name) rows = rows.filter(s => s.name === filters.name);
  if (filters.batchNo) rows = rows.filter(s => s.batchNo === filters.batchNo);
  if (filters.lowStock) {
    rows = rows.filter(s => s.quantity <= s.reorderThreshold);
  }
  return rows.sort((a, b) => (b.entryDate || "").localeCompare(a.entryDate || ""));
}

export function getStock(db, id) {
  ensureInventoryCollection(db);
  const coll = getCollections(db);
  return coll.materialStocks.find(s => s.id === id) || null;
}

export function getStockByBatchNo(db, batchNo) {
  ensureInventoryCollection(db);
  const coll = getCollections(db);
  return coll.materialStocks.find(s => s.batchNo === batchNo) || null;
}

export function findStockByNameAndBatchNo(db, name, batchNo) {
  ensureInventoryCollection(db);
  const coll = getCollections(db);
  return coll.materialStocks.find(s => s.name === name && s.batchNo === batchNo) || null;
}

export function getAvailableQuantity(stock) {
  const reserved = stock.reservedQuantity || 0;
  return Number((stock.quantity - reserved).toFixed(2));
}

export function insertStock(db, stock) {
  ensureInventoryCollection(db);
  const coll = getCollections(db);
  coll.materialStocks.push(stock);
  return stock;
}

export function updateStock(db, id, updates) {
  ensureInventoryCollection(db);
  const coll = getCollections(db);
  const idx = coll.materialStocks.findIndex(s => s.id === id);
  if (idx < 0) return null;
  coll.materialStocks[idx] = { ...coll.materialStocks[idx], ...updates };
  return coll.materialStocks[idx];
}

export function deleteStock(db, id) {
  ensureInventoryCollection(db);
  const coll = getCollections(db);
  const idx = coll.materialStocks.findIndex(s => s.id === id);
  if (idx < 0) return false;
  coll.materialStocks.splice(idx, 1);
  return true;
}

export function validateStockForDeduction(db, materialBatchRefs, recipeIngredients, batchWeight) {
  const errors = [];
  const deductions = [];

  for (const ingredient of recipeIngredients) {
    const ref = materialBatchRefs.find(r => r.ingredientName === ingredient.name);
    if (!ref) {
      errors.push({ ingredientName: ingredient.name, error: "no_batch_ref", message: `原料 '${ingredient.name}' 未指定库存批号` });
      continue;
    }

    const stock = findStockByNameAndBatchNo(db, ingredient.name, ref.batchNo);
    if (!stock) {
      errors.push({ ingredientName: ingredient.name, batchNo: ref.batchNo, error: "stock_not_found", message: `未找到原料 '${ingredient.name}' 批号 '${ref.batchNo}' 的库存记录` });
      continue;
    }

    const requiredQuantity = Number(((ingredient.percentage / 100) * batchWeight).toFixed(2));
    const available = getAvailableQuantity(stock);
    if (available < requiredQuantity) {
      errors.push({
        ingredientName: ingredient.name,
        batchNo: ref.batchNo,
        error: "insufficient_stock",
        message: `原料 '${ingredient.name}'(批号:${ref.batchNo}) 可用库存不足: 需要 ${requiredQuantity}${stock.unit}, 可用 ${available}${stock.unit} (总量 ${stock.quantity}, 已预留 ${stock.reservedQuantity || 0})`,
        required: requiredQuantity,
        available,
        totalQuantity: stock.quantity,
        reservedQuantity: stock.reservedQuantity || 0,
        unit: stock.unit
      });
      continue;
    }

    deductions.push({
      stockId: stock.id,
      ingredientName: ingredient.name,
      batchNo: ref.batchNo,
      percentage: ingredient.percentage,
      requiredQuantity,
      unit: stock.unit
    });
  }

  return { valid: errors.length === 0, errors, deductions };
}

export function deductStock(db, deductions) {
  const deducted = [];
  for (const d of deductions) {
    const stock = getStock(db, d.stockId);
    if (!stock) continue;
    stock.quantity = Number((stock.quantity - d.requiredQuantity).toFixed(2));
    deducted.push({
      stockId: stock.id,
      ingredientName: d.ingredientName,
      batchNo: d.batchNo,
      deducted: d.requiredQuantity,
      remaining: stock.quantity,
      unit: stock.unit
    });
  }
  return deducted;
}

export function reserveStock(db, tile, deductions) {
  ensureInventoryCollection(db);
  const coll = getCollections(db);
  const transactionIds = [];

  for (const d of deductions) {
    const stock = getStock(db, d.stockId);
    if (!stock) continue;

    if (stock.quantity < d.requiredQuantity) {
      throw new Error(`原料 '${d.ingredientName}' 库存不足，无法预留: 需要 ${d.requiredQuantity}, 当前 ${stock.quantity}`);
    }

    stock.reservedQuantity = Number(((stock.reservedQuantity || 0) + d.requiredQuantity).toFixed(2));
    if (stock.reservedQuantity > stock.quantity) {
      stock.reservedQuantity = Number((stock.reservedQuantity - d.requiredQuantity).toFixed(2));
      throw new Error(`原料 '${d.ingredientName}' 预留后库存将变负数，预留失败`);
    }

    const txnId = generateTransactionId(db);
    const txn = {
      id: txnId,
      tileId: tile.id,
      stockId: stock.id,
      ingredientName: d.ingredientName,
      batchNo: d.batchNo,
      quantity: d.requiredQuantity,
      unit: stock.unit,
      type: "reserve",
      status: "active",
      relatedTransactionId: null,
      createdAt: new Date().toISOString(),
      note: "草稿→待烧成 库存预留"
    };
    coll.inventoryTransactions.push(txn);
    transactionIds.push(txnId);
  }

  if (!tile.reservationIds) tile.reservationIds = [];
  tile.reservationIds.push(...transactionIds);
  tile.inventoryReserved = true;
  tile.inventoryConsumed = false;

  return transactionIds;
}

export function confirmStockReservation(db, tile) {
  ensureInventoryCollection(db);
  const coll = getCollections(db);

  if (!tile.inventoryReserved) {
    return { confirmed: false, reason: "no_active_reservation" };
  }

  const activeReserveTxns = coll.inventoryTransactions.filter(
    t => t.tileId === tile.id && t.type === "reserve" && t.status === "active"
  );

  if (activeReserveTxns.length === 0) {
    return { confirmed: false, reason: "no_active_reserve_transactions" };
  }

  const confirmedIds = [];

  for (const reserveTxn of activeReserveTxns) {
    const stock = getStock(db, reserveTxn.stockId);
    if (!stock) continue;

    if (stock.quantity < reserveTxn.quantity) {
      throw new Error(`原料 '${reserveTxn.ingredientName}' 库存不足，无法确认消耗: 需要消耗 ${reserveTxn.quantity}, 当前 ${stock.quantity}`);
    }

    stock.quantity = Number((stock.quantity - reserveTxn.quantity).toFixed(2));
    stock.reservedQuantity = Number(((stock.reservedQuantity || 0) - reserveTxn.quantity).toFixed(2));

    if (stock.reservedQuantity < 0) {
      stock.reservedQuantity = 0;
    }

    reserveTxn.status = "completed";

    const confirmTxnId = generateTransactionId(db);
    coll.inventoryTransactions.push({
      id: confirmTxnId,
      tileId: tile.id,
      stockId: stock.id,
      ingredientName: reserveTxn.ingredientName,
      batchNo: reserveTxn.batchNo,
      quantity: reserveTxn.quantity,
      unit: reserveTxn.unit,
      type: "confirm",
      status: "completed",
      relatedTransactionId: reserveTxn.id,
      createdAt: new Date().toISOString(),
      note: "待烧成→已烧成 确认消耗"
    });

    if (Array.isArray(tile.reservationIds)) {
      tile.reservationIds.push(confirmTxnId);
    }
    confirmedIds.push(confirmTxnId);

    const ref = (tile.materialBatchRefs || []).find(
      r => r.ingredientName === reserveTxn.ingredientName && r.batchNo === reserveTxn.batchNo
    );
    if (ref) {
      ref.deducted = reserveTxn.quantity;
    }
  }

  tile.inventoryReserved = false;
  tile.inventoryConsumed = true;

  return { confirmed: true, confirmedIds };
}

export function releaseStockReservation(db, tile) {
  ensureInventoryCollection(db);
  const coll = getCollections(db);

  if (!tile.inventoryReserved) {
    return { released: false, reason: "no_active_reservation" };
  }

  const activeReserveTxns = coll.inventoryTransactions.filter(
    t => t.tileId === tile.id && t.type === "reserve" && t.status === "active"
  );

  if (activeReserveTxns.length === 0) {
    tile.inventoryReserved = false;
    return { released: false, reason: "no_active_reserve_transactions" };
  }

  const releasedIds = [];

  for (const reserveTxn of activeReserveTxns) {
    const stock = getStock(db, reserveTxn.stockId);
    if (!stock) continue;

    stock.reservedQuantity = Number(((stock.reservedQuantity || 0) - reserveTxn.quantity).toFixed(2));

    if (stock.reservedQuantity < 0) {
      stock.reservedQuantity = 0;
    }

    reserveTxn.status = "cancelled";

    const releaseTxnId = generateTransactionId(db);
    coll.inventoryTransactions.push({
      id: releaseTxnId,
      tileId: tile.id,
      stockId: stock.id,
      ingredientName: reserveTxn.ingredientName,
      batchNo: reserveTxn.batchNo,
      quantity: reserveTxn.quantity,
      unit: reserveTxn.unit,
      type: "release",
      status: "completed",
      relatedTransactionId: reserveTxn.id,
      createdAt: new Date().toISOString(),
      note: "待烧成→草稿 释放预留"
    });

    if (Array.isArray(tile.reservationIds)) {
      tile.reservationIds.push(releaseTxnId);
    }
    releasedIds.push(releaseTxnId);
  }

  tile.inventoryReserved = false;
  tile.inventoryConsumed = false;

  return { released: true, releasedIds };
}

export function getTransactionsByTileId(db, tileId) {
  ensureInventoryCollection(db);
  const coll = getCollections(db);
  return coll.inventoryTransactions.filter(t => t.tileId === tileId);
}

export function getTransactionsByStockId(db, stockId) {
  ensureInventoryCollection(db);
  const coll = getCollections(db);
  return coll.inventoryTransactions.filter(t => t.stockId === stockId);
}

export function findTilesByBatchNo(db, batchNo) {
  const coll = getCollections(db);
  if (!coll.tiles) return [];
  return coll.tiles.filter(t =>
    Array.isArray(t.materialBatchRefs) && t.materialBatchRefs.some(r => r.batchNo === batchNo)
  );
}

export function getInventorySummary(db) {
  ensureInventoryCollection(db);
  const coll = getCollections(db);
  const byName = {};
  for (const stock of coll.materialStocks) {
    if (!byName[stock.name]) {
      byName[stock.name] = { name: stock.name, totalQuantity: 0, totalReserved: 0, unit: stock.unit, batches: [] };
    }
    byName[stock.name].totalQuantity = Number((byName[stock.name].totalQuantity + stock.quantity).toFixed(2));
    byName[stock.name].totalReserved = Number((byName[stock.name].totalReserved + (stock.reservedQuantity || 0)).toFixed(2));
    byName[stock.name].batches.push({
      id: stock.id,
      batchNo: stock.batchNo,
      quantity: stock.quantity,
      reservedQuantity: stock.reservedQuantity || 0,
      availableQuantity: getAvailableQuantity(stock),
      entryDate: stock.entryDate,
      supplier: stock.supplier || ""
    });
  }
  return Object.values(byName);
}

export function getBatchUsageSummary(db, batchNo) {
  ensureInventoryCollection(db);
  const coll = getCollections(db);

  const stock = getStockByBatchNo(db, batchNo);
  if (!stock) return null;

  const tiles = findTilesByBatchNo(db, batchNo);
  const tileUsages = [];
  const ingredientConsumption = {};

  for (const tile of tiles) {
    const ref = (tile.materialBatchRefs || []).find(r => r.batchNo === batchNo);
    if (!ref) continue;

    const deducted = Number(ref.deducted || 0);
    const ingredientName = ref.ingredientName || stock.name;
    const unit = ref.unit || stock.unit;

    tileUsages.push({
      tileId: tile.id,
      body: tile.body,
      recipe: tile.recipe,
      batchWeight: tile.batchWeight || null,
      ingredientName,
      deducted,
      unit,
      status: tile.status || null,
      inventoryReserved: tile.inventoryReserved || false,
      inventoryConsumed: tile.inventoryConsumed || false
    });

    if (!ingredientConsumption[ingredientName]) {
      ingredientConsumption[ingredientName] = {
        ingredientName,
        totalDeducted: 0,
        totalReserved: 0,
        unit,
        tileCount: 0
      };
    }
    ingredientConsumption[ingredientName].totalDeducted = Number(
      (ingredientConsumption[ingredientName].totalDeducted + deducted).toFixed(2)
    );
    if (tile.inventoryReserved && !tile.inventoryConsumed) {
      ingredientConsumption[ingredientName].totalReserved = Number(
        (ingredientConsumption[ingredientName].totalReserved + deducted).toFixed(2)
      );
    }
    ingredientConsumption[ingredientName].tileCount++;
  }

  return {
    batchNo: stock.batchNo,
    materialName: stock.name,
    unit: stock.unit,
    currentStock: stock.quantity,
    reservedQuantity: stock.reservedQuantity || 0,
    availableQuantity: getAvailableQuantity(stock),
    reorderThreshold: stock.reorderThreshold || 0,
    supplier: stock.supplier || "",
    entryDate: stock.entryDate || null,
    isLowStock: stock.quantity <= (stock.reorderThreshold || 0),
    totalUsed: Number(
      Object.values(ingredientConsumption)
        .reduce((sum, c) => sum + c.totalDeducted, 0)
        .toFixed(2)
    ),
    tileCount: tileUsages.length,
    tiles: tileUsages,
    consumptionByIngredient: Object.values(ingredientConsumption)
  };
}
