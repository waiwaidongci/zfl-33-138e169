import { saveDb, getCollections } from "./db.js";
import {
  TILE_STATUSES,
  TILE_STATUS_LABELS,
  isValidStatus,
  canTransitionTo,
  getTransitionError,
  getAvailableTransitions,
  INITIAL_STATUS
} from "./tile-status-machine.js";
import {
  validateFieldsForStatus,
  requiresInventoryDeduction,
  requiresInventoryRestore
} from "./tile-permission-rules.js";
import {
  createStatusRecord,
  addStatusHistory,
  getStatusHistory,
  getStatusProgress
} from "./tile-status-history.js";
import {
  ensureInventoryCollection,
  validateStockForDeduction,
  deductStock,
  findStockByNameAndBatchNo
} from "./inventory-repository.js";
import { parseIngredients } from "./recipe-repository.js";
import { ensureBatchCollection, getBatch, addTileToBatch } from "./batch-repository.js";

export function getStatusInfo() {
  return {
    statuses: Object.entries(TILE_STATUS_LABELS).map(([value, label]) => ({
      value,
      label
    })),
    transitions: Object.fromEntries(
      Object.entries(TILE_STATUSES).map(([key, value]) => [
        value,
        getAvailableTransitions(value).map(t => ({
          value: t,
          label: TILE_STATUS_LABELS[t]
        }))
      ])
    )
  };
}

export async function handleGetTileStatus(id, db) {
  const coll = getCollections(db);
  const tile = coll.tiles.find(t => t.id === id);
  if (!tile) {
    return { status: 404, data: { error: "tile_not_found", message: "试片不存在" } };
  }

  return {
    status: 200,
    data: {
      id: tile.id,
      status: tile.status,
      statusLabel: TILE_STATUS_LABELS[tile.status] || tile.status,
      availableTransitions: getAvailableTransitions(tile.status).map(t => ({
        value: t,
        label: TILE_STATUS_LABELS[t]
      })),
      statusHistory: getStatusHistory(tile),
      progress: getStatusProgress(tile)
    }
  };
}

export async function handleTransitionStatus(id, input, db) {
  const coll = getCollections(db);
  const tile = coll.tiles.find(t => t.id === id);

  if (!tile) {
    return { status: 404, data: { error: "tile_not_found", message: "试片不存在" } };
  }

  const { targetStatus, note, operator } = input;

  if (!targetStatus) {
    return {
      status: 400,
      data: {
        error: "missing_target_status",
        message: "targetStatus 为必填字段"
      }
    };
  }

  if (!isValidStatus(targetStatus)) {
    return {
      status: 400,
      data: {
        error: "invalid_status",
        message: `'${targetStatus}' 不是有效的试片状态`,
        validStatuses: Object.values(TILE_STATUSES)
      }
    };
  }

  if (!canTransitionTo(tile.status, targetStatus)) {
    return {
      status: 400,
      data: {
        error: "invalid_transition",
        message: getTransitionError(tile.status, targetStatus),
        currentStatus: tile.status,
        currentStatusLabel: TILE_STATUS_LABELS[tile.status],
        targetStatus,
        targetStatusLabel: TILE_STATUS_LABELS[targetStatus],
        allowedTransitions: getAvailableTransitions(tile.status).map(t => ({
          value: t,
          label: TILE_STATUS_LABELS[t]
        }))
      }
    };
  }

  if (requiresInventoryDeduction(tile.status, targetStatus)) {
    const deductionResult = await handleInventoryDeduction(tile, db);
    if (!deductionResult.success) {
      return deductionResult.response;
    }
  }

  if (requiresInventoryRestore(tile.status, targetStatus)) {
    const restoreResult = await handleInventoryRestore(tile, db);
    if (!restoreResult.success) {
      return restoreResult.response;
    }
  }

  if (targetStatus === TILE_STATUSES.PENDING_REVIEW && !validateFiringResult(tile)) {
    return {
      status: 400,
      data: {
        error: "missing_firing_results",
        message: "进入待复盘前，请先录入烧成结果（颜色、缺陷、评分等）"
      }
    };
  }

  if (targetStatus === TILE_STATUSES.ARCHIVED && !validateForArchiving(tile)) {
    return {
      status: 400,
      data: {
        error: "not_ready_for_archive",
        message: "归档前请确保已录入评分和观察记录"
      }
    };
  }

  const fromStatus = tile.status;
  tile.status = targetStatus;

  const statusRecord = createStatusRecord(
    fromStatus,
    targetStatus,
    operator || "user",
    note
  );
  addStatusHistory(tile, statusRecord);

  if (targetStatus === TILE_STATUSES.PENDING_FIRING && input.batchId) {
    ensureBatchCollection(db);
    const batch = getBatch(db, input.batchId);
    if (batch) {
      tile.batchId = input.batchId;
      addTileToBatch(db, input.batchId, id);
    }
  }

  await saveDb(db);

  return {
    status: 200,
    data: {
      id: tile.id,
      from: fromStatus,
      fromLabel: TILE_STATUS_LABELS[fromStatus],
      to: targetStatus,
      toLabel: TILE_STATUS_LABELS[targetStatus],
      statusRecord,
      availableTransitions: getAvailableTransitions(targetStatus).map(t => ({
        value: t,
        label: TILE_STATUS_LABELS[t]
      })),
      progress: getStatusProgress(tile)
    }
  };
}

export async function handleUpdateTileWithStatus(id, input, db) {
  const coll = getCollections(db);
  const tile = coll.tiles.find(t => t.id === id);

  if (!tile) {
    return { status: 404, data: { error: "tile_not_found", message: "试片不存在" } };
  }

  const fields = Object.keys(input).filter(k => k !== "id");
  const validation = validateFieldsForStatus(tile.status, fields);

  if (!validation.valid) {
    return {
      status: 400,
      data: {
        error: "fields_not_allowed",
        message: validation.errors.map(e => e.message).join("; "),
        errors: validation.errors,
        currentStatus: tile.status,
        currentStatusLabel: TILE_STATUS_LABELS[tile.status],
        allowedFields: validation.allowedFields
      }
    };
  }

  for (const field of fields) {
    if (field === "observations" && Array.isArray(input[field])) {
      tile[field] = [...(tile[field] || []), ...input[field]];
    } else if (field === "defectTags") {
      tile[field] = input[field];
    } else {
      tile[field] = input[field];
    }
  }

  await saveDb(db);

  return {
    status: 200,
    data: {
      id: tile.id,
      status: tile.status,
      statusLabel: TILE_STATUS_LABELS[tile.status],
      updatedFields: fields,
      tile
    }
  };
}

export async function handleGetStatusHistory(id, db) {
  const coll = getCollections(db);
  const tile = coll.tiles.find(t => t.id === id);

  if (!tile) {
    return { status: 404, data: { error: "tile_not_found", message: "试片不存在" } };
  }

  return {
    status: 200,
    data: {
      id: tile.id,
      currentStatus: tile.status,
      currentStatusLabel: TILE_STATUS_LABELS[tile.status],
      history: getStatusHistory(tile)
    }
  };
}

export async function handleBatchStatusTransition(input, db) {
  const { tileIds, targetStatus, note, operator } = input;

  if (!Array.isArray(tileIds) || tileIds.length === 0) {
    return {
      status: 400,
      data: {
        error: "invalid_input",
        message: "tileIds 必须为非空数组"
      }
    };
  }

  const results = {
    success: [],
    failed: []
  };

  for (const tileId of tileIds) {
    const result = await handleTransitionStatus(
      tileId,
      { targetStatus, note, operator },
      db
    );
    if (result.status === 200) {
      results.success.push({ id: tileId, ...result.data });
    } else {
      results.failed.push({ id: tileId, ...result.data });
    }
  }

  return {
    status: 200,
    data: {
      total: tileIds.length,
      successCount: results.success.length,
      failedCount: results.failed.length,
      success: results.success,
      failed: results.failed
    }
  };
}

async function handleInventoryDeduction(tile, db) {
  if (tile.inventoryDeducted) {
    return { success: true };
  }

  if (!tile.materialBatchRefs || !tile.batchWeight) {
    return {
      success: false,
      response: {
        status: 400,
        data: {
          error: "missing_inventory_info",
          message: "提交待烧成前，请先指定原料批次和总重量"
        }
      }
    };
  }

  ensureInventoryCollection(db);
  const ingredients = parseIngredients(tile.recipe);

  const validation = validateStockForDeduction(
    db,
    tile.materialBatchRefs,
    ingredients,
    tile.batchWeight
  );

  if (!validation.valid) {
    return {
      success: false,
      response: {
        status: 409,
        data: {
          error: "insufficient_stock",
          message: "原料库存不足，无法提交待烧成",
          details: validation.errors
        }
      }
    };
  }

  const deductionResult = deductStock(db, validation.deductions);
  tile.inventoryDeducted = true;

  return { success: true, deductionResult };
}

async function handleInventoryRestore(tile, db) {
  if (!tile.inventoryDeducted) {
    return { success: true };
  }

  if (!tile.materialBatchRefs) {
    return { success: true };
  }

  ensureInventoryCollection(db);
  const ingredients = parseIngredients(tile.recipe);

  for (const ref of tile.materialBatchRefs) {
    const ingredient = ingredients.find(i => i.name === ref.ingredientName);
    if (ingredient && ref.deducted) {
      const stock = findStockByNameAndBatchNo(db, ref.ingredientName, ref.batchNo);
      if (stock) {
        stock.quantity = Number((stock.quantity + ref.deducted).toFixed(2));
      }
    }
  }

  tile.inventoryDeducted = false;

  return { success: true };
}

function validateFiringResult(tile) {
  const hasColor = tile.color && tile.color !== "";
  const hasScore = tile.score > 0;
  const hasDefects = (tile.defects && tile.defects !== "") ||
    (Array.isArray(tile.defectTags) && tile.defectTags.length > 0);
  return hasColor || hasScore || hasDefects;
}

function validateForArchiving(tile) {
  const hasScore = tile.score > 0;
  const hasObservations = Array.isArray(tile.observations) && tile.observations.length > 0;
  return hasScore && hasObservations;
}
