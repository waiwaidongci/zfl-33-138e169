import { saveDb, getCollections } from "./db.js";
import {
  ensureBatchCollection,
  generateBatchId,
  getBatch,
  insertBatch,
  updateBatch,
  listBatches,
  isValidStatusTransition,
  addTileToBatch,
  removeTileFromBatch,
  addBatchObservation,
  generateBatchSummary
} from "./batch-repository.js";
import { isFieldAllowed } from "./tile-permission-rules.js";
import { recordEvent, ensureEventCollection, EVENT_TYPES, ENTITY_TYPES } from "./event-log.js";

export async function handleListBatches(url, db) {
  ensureBatchCollection(db);
  const filters = {
    kiln: url.searchParams.get("kiln"),
    status: url.searchParams.get("status"),
    plannedDate: url.searchParams.get("plannedDate"),
    targetAtmosphere: url.searchParams.get("targetAtmosphere")
  };
  return { status: 200, data: listBatches(db, filters) };
}

export async function handleCreateBatch(input, db) {
  if (!input.kiln) {
    return { status: 400, data: { error: "invalid_input", message: "kiln 为必填字段" } };
  }
  ensureBatchCollection(db);

  const now = new Date().toISOString().slice(0, 10);
  const batch = {
    id: input.id || generateBatchId(db),
    name: input.name || `实验批次-${now}`,
    kiln: input.kiln,
    plannedDate: input.plannedDate || now,
    targetAtmosphere: input.targetAtmosphere || "氧化",
    tileIds: Array.isArray(input.tileIds) ? input.tileIds : [],
    status: "planned",
    observations: [],
    createdAt: now,
    updatedAt: now
  };

  insertBatch(db, batch);
  ensureEventCollection(db);
  recordEvent(db, {
    type: EVENT_TYPES.BATCH_CREATED,
    entityId: batch.id,
    entityType: ENTITY_TYPES.BATCH,
    payload: {
      name: batch.name,
      kiln: batch.kiln,
      plannedDate: batch.plannedDate,
      targetAtmosphere: batch.targetAtmosphere,
      tileCount: batch.tileIds.length
    },
    operator: "user",
    note: `创建批次 ${batch.name}`
  });
  await saveDb(db);
  return { status: 201, data: batch };
}

export async function handleGetBatch(id, db) {
  ensureBatchCollection(db);
  const batch = getBatch(db, id);
  if (!batch) return { status: 404, data: { error: "batch_not_found" } };

  const coll = getCollections(db);
  const tiles = batch.tileIds
    .map(tid => coll.tiles.find(t => t.id === tid))
    .filter(Boolean);

  return { status: 200, data: { ...batch, tiles } };
}

export async function handleAddBatchTiles(id, input, db) {
  ensureBatchCollection(db);
  if (!Array.isArray(input.tileIds) || input.tileIds.length === 0) {
    return { status: 400, data: { error: "invalid_input", message: "tileIds 必须为非空数组" } };
  }

  const batch = getBatch(db, id);
  if (!batch) return { status: 404, data: { error: "batch_not_found" } };

  const coll = getCollections(db);
  const existingIds = new Set(coll.tiles.map(t => t.id));
  const notFound = input.tileIds.filter(tid => !existingIds.has(tid));
  if (notFound.length > 0) {
    return { status: 400, data: { error: "tile_not_found", message: `试片不存在: ${notFound.join(", ")}` } };
  }

  const added = [];
  const duplicated = [];
  const forbidden = [];
  for (const tid of input.tileIds) {
    const tile = coll.tiles.find(t => t.id === tid);
    if (tile && !isFieldAllowed(tile.status, "batchId")) {
      forbidden.push({ id: tid, status: tile.status });
      continue;
    }

    const result = addTileToBatch(db, id, tid);
    if (result.duplicate) {
      duplicated.push(tid);
    } else {
      if (tile) tile.batchId = id;
      added.push(tid);
    }
  }

  ensureEventCollection(db);
  if (added.length > 0) {
    recordEvent(db, {
      type: EVENT_TYPES.BATCH_TILES_ADDED,
      entityId: id,
      entityType: ENTITY_TYPES.BATCH,
      payload: { tileIds: added },
      operator: "user",
      note: `批次 ${id} 添加 ${added.length} 个试片`
    });
  }

  await saveDb(db);

  return {
    status: 200,
    data: {
      added,
      duplicated,
      forbidden,
      batch: getBatch(db, id)
    }
  };
}

export async function handleRemoveBatchTiles(id, input, db) {
  ensureBatchCollection(db);
  if (!Array.isArray(input.tileIds) || input.tileIds.length === 0) {
    return { status: 400, data: { error: "invalid_input", message: "tileIds 必须为非空数组" } };
  }

  const batch = getBatch(db, id);
  if (!batch) return { status: 404, data: { error: "batch_not_found" } };

  const coll = getCollections(db);
  const removed = [];
  const notInBatch = [];
  const forbidden = [];
  for (const tid of input.tileIds) {
    const tile = coll.tiles.find(t => t.id === tid);
    if (tile && !isFieldAllowed(tile.status, "batchId")) {
      forbidden.push({ id: tid, status: tile.status });
      continue;
    }

    const result = removeTileFromBatch(db, id, tid);
    if (result.notFound) {
      notInBatch.push(tid);
    } else {
      if (tile) tile.batchId = null;
      removed.push(tid);
    }
  }

  ensureEventCollection(db);
  if (removed.length > 0) {
    recordEvent(db, {
      type: EVENT_TYPES.BATCH_TILES_REMOVED,
      entityId: id,
      entityType: ENTITY_TYPES.BATCH,
      payload: { tileIds: removed },
      operator: "user",
      note: `批次 ${id} 移除 ${removed.length} 个试片`
    });
  }

  await saveDb(db);

  return {
    status: 200,
    data: {
      removed,
      notInBatch,
      forbidden,
      batch: getBatch(db, id)
    }
  };
}

export async function handleAdvanceBatchStatus(id, input, db) {
  ensureBatchCollection(db);
  if (!input.status) {
    return { status: 400, data: { error: "invalid_input", message: "status 为必填字段" } };
  }

  const batch = getBatch(db, id);
  if (!batch) return { status: 404, data: { error: "batch_not_found" } };

  if (!isValidStatusTransition(batch.status, input.status)) {
    return {
      status: 400,
      data: {
        error: "invalid_transition",
        message: `状态不允许从 '${batch.status}' 变更为 '${input.status}'，只能保持当前或推进到下一阶段`
      }
    };
  }

  const now = new Date().toISOString().slice(0, 10);
  const observation = {
    at: now,
    note: input.note || `状态从 '${batch.status}' 变更为 '${input.status}'`
  };

  const updated = updateBatch(db, id, { status: input.status, updatedAt: now });
  addBatchObservation(db, id, observation);

  ensureEventCollection(db);
  recordEvent(db, {
    type: EVENT_TYPES.BATCH_STATUS_CHANGED,
    entityId: id,
    entityType: ENTITY_TYPES.BATCH,
    payload: {
      from: batch.status,
      to: input.status
    },
    operator: "user",
    note: input.note || `批次状态从 '${batch.status}' 变更为 '${input.status}'`
  });

  await saveDb(db);

  return { status: 200, data: getBatch(db, id) };
}

export async function handleAddBatchObservation(id, input, db) {
  ensureBatchCollection(db);
  if (!input.note) {
    return { status: 400, data: { error: "invalid_input", message: "note 为必填字段" } };
  }

  const batch = getBatch(db, id);
  if (!batch) return { status: 404, data: { error: "batch_not_found" } };

  const observation = {
    at: input.at || new Date().toISOString().slice(0, 10),
    note: input.note
  };

  addBatchObservation(db, id, observation);
  await saveDb(db);

  return { status: 201, data: getBatch(db, id) };
}

export async function handleGetBatchSummary(id, db) {
  ensureBatchCollection(db);
  const summary = generateBatchSummary(db, id);
  if (!summary) return { status: 404, data: { error: "batch_not_found" } };
  return { status: 200, data: summary };
}
