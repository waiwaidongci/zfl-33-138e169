import { saveDb } from "./db.js";
import {
  ensureInventoryCollection,
  generateStockId,
  getStock,
  getStockByBatchNo,
  insertStock,
  updateStock,
  deleteStock,
  listStocks,
  findTilesByBatchNo,
  getInventorySummary,
  getBatchUsageSummary
} from "./inventory-repository.js";

export async function handleListInventory(url, db) {
  ensureInventoryCollection(db);
  const filters = {
    name: url.searchParams.get("name"),
    batchNo: url.searchParams.get("batchNo"),
    lowStock: url.searchParams.get("lowStock") === "true"
  };
  return { status: 200, data: listStocks(db, filters) };
}

export async function handleCreateInventory(input, db) {
  if (!input.name || !input.batchNo || input.quantity === undefined) {
    return { status: 400, data: { error: "invalid_input", message: "name、batchNo 和 quantity 为必填字段" } };
  }
  ensureInventoryCollection(db);

  const existing = getStockByBatchNo(db, input.batchNo);
  if (existing) {
    return { status: 409, data: { error: "batch_no_exists", message: `批号 '${input.batchNo}' 已存在` } };
  }

  const now = new Date().toISOString().slice(0, 10);
  const stock = {
    id: input.id || generateStockId(db),
    name: input.name,
    batchNo: input.batchNo,
    quantity: Number(input.quantity),
    unit: input.unit || "kg",
    entryDate: input.entryDate || now,
    supplier: input.supplier || "",
    reorderThreshold: Number(input.reorderThreshold || 0),
    notes: input.notes || "",
    createdAt: now,
    updatedAt: now
  };

  insertStock(db, stock);
  await saveDb(db);
  return { status: 201, data: stock };
}

export async function handleGetInventory(id, db) {
  ensureInventoryCollection(db);
  const stock = getStock(db, id);
  if (!stock) return { status: 404, data: { error: "stock_not_found" } };
  return { status: 200, data: stock };
}

export async function handleUpdateInventory(id, input, db) {
  ensureInventoryCollection(db);
  const stock = getStock(db, id);
  if (!stock) return { status: 404, data: { error: "stock_not_found" } };

  const updates = { updatedAt: new Date().toISOString().slice(0, 10) };
  if (input.quantity !== undefined) updates.quantity = Number(input.quantity);
  if (input.reorderThreshold !== undefined) updates.reorderThreshold = Number(input.reorderThreshold);
  if (input.supplier !== undefined) updates.supplier = input.supplier;
  if (input.notes !== undefined) updates.notes = input.notes;

  const updated = updateStock(db, id, updates);
  await saveDb(db);
  return { status: 200, data: updated };
}

export async function handleDeleteInventory(id, db) {
  ensureInventoryCollection(db);
  const ok = deleteStock(db, id);
  if (!ok) return { status: 404, data: { error: "stock_not_found" } };
  await saveDb(db);
  return { status: 200, data: { deleted: true, id } };
}

export async function handleInventorySummary(db) {
  ensureInventoryCollection(db);
  return { status: 200, data: getInventorySummary(db) };
}

export async function handleBatchNoTiles(batchNo, db) {
  ensureInventoryCollection(db);
  const stock = getStockByBatchNo(db, batchNo);
  if (!stock) return { status: 404, data: { error: "batch_not_found", message: `批号 '${batchNo}' 不存在` } };

  const tiles = findTilesByBatchNo(db, batchNo);
  return {
    status: 200,
    data: {
      batchNo,
      materialName: stock.name,
      currentStock: stock.quantity,
      unit: stock.unit,
      tileCount: tiles.length,
      tiles: tiles.map(t => ({
        id: t.id,
        body: t.body,
        recipe: t.recipe,
        ashSource: t.ashSource,
        peakTemp: t.peakTemp,
        color: t.color,
        score: t.score,
        batchWeight: t.batchWeight || null,
        materialBatchRefs: t.materialBatchRefs || []
      }))
    }
  };
}

export async function handleBatchUsageSummary(batchNo, db) {
  ensureInventoryCollection(db);
  const summary = getBatchUsageSummary(db, batchNo);
  if (!summary) {
    return { status: 404, data: { error: "batch_not_found", message: `批号 '${batchNo}' 不存在` } };
  }
  return { status: 200, data: summary };
}
