export function ensureInventoryCollection(db) {
  if (!db.materialStocks) db.materialStocks = [];
}

export function getStockIds(db) {
  ensureInventoryCollection(db);
  return new Set(db.materialStocks.map(s => s.id));
}

export function generateStockId(db) {
  ensureInventoryCollection(db);
  let counter = db.materialStocks.length + 1;
  let id;
  const existing = getStockIds(db);
  do {
    id = `MAT-${String(counter).padStart(3, "0")}`;
    counter++;
  } while (existing.has(id));
  return id;
}

export function listStocks(db, filters) {
  ensureInventoryCollection(db);
  let rows = db.materialStocks.slice();
  if (filters.name) rows = rows.filter(s => s.name === filters.name);
  if (filters.batchNo) rows = rows.filter(s => s.batchNo === filters.batchNo);
  if (filters.lowStock) {
    rows = rows.filter(s => s.quantity <= s.reorderThreshold);
  }
  return rows.sort((a, b) => (b.entryDate || "").localeCompare(a.entryDate || ""));
}

export function getStock(db, id) {
  ensureInventoryCollection(db);
  return db.materialStocks.find(s => s.id === id) || null;
}

export function getStockByBatchNo(db, batchNo) {
  ensureInventoryCollection(db);
  return db.materialStocks.find(s => s.batchNo === batchNo) || null;
}

export function findStockByNameAndBatchNo(db, name, batchNo) {
  ensureInventoryCollection(db);
  return db.materialStocks.find(s => s.name === name && s.batchNo === batchNo) || null;
}

export function insertStock(db, stock) {
  ensureInventoryCollection(db);
  db.materialStocks.push(stock);
  return stock;
}

export function updateStock(db, id, updates) {
  ensureInventoryCollection(db);
  const idx = db.materialStocks.findIndex(s => s.id === id);
  if (idx < 0) return null;
  db.materialStocks[idx] = { ...db.materialStocks[idx], ...updates };
  return db.materialStocks[idx];
}

export function deleteStock(db, id) {
  ensureInventoryCollection(db);
  const idx = db.materialStocks.findIndex(s => s.id === id);
  if (idx < 0) return false;
  db.materialStocks.splice(idx, 1);
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
    if (stock.quantity < requiredQuantity) {
      errors.push({
        ingredientName: ingredient.name,
        batchNo: ref.batchNo,
        error: "insufficient_stock",
        message: `原料 '${ingredient.name}'(批号:${ref.batchNo}) 库存不足: 需要 ${requiredQuantity}${stock.unit}, 当前 ${stock.quantity}${stock.unit}`,
        required: requiredQuantity,
        available: stock.quantity,
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
      unit: d.unit
    });
  }
  return deducted;
}

export function findTilesByBatchNo(db, batchNo) {
  if (!db.tiles) return [];
  return db.tiles.filter(t =>
    Array.isArray(t.materialBatchRefs) && t.materialBatchRefs.some(r => r.batchNo === batchNo)
  );
}

export function getInventorySummary(db) {
  ensureInventoryCollection(db);
  const byName = {};
  for (const stock of db.materialStocks) {
    if (!byName[stock.name]) {
      byName[stock.name] = { name: stock.name, totalQuantity: 0, unit: stock.unit, batches: [] };
    }
    byName[stock.name].totalQuantity = Number((byName[stock.name].totalQuantity + stock.quantity).toFixed(2));
    byName[stock.name].batches.push({
      id: stock.id,
      batchNo: stock.batchNo,
      quantity: stock.quantity,
      entryDate: stock.entryDate,
      supplier: stock.supplier || ""
    });
  }
  return Object.values(byName);
}
