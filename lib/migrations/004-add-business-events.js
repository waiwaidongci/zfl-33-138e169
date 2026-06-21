import { TILE_STATUSES } from "../tile-status-machine.js";

export const version = 4;
export const name = "add-business-events";
export const description = "引入统一业务事件集合，将试片创建、状态流转、库存扣减/恢复、批次调整、缺陷标签变更和配方版本创建写入审计日志";

const EVENT_TYPE_LABELS = {
  tile_created: "创建试片",
  status_transitioned: "状态流转",
  inventory_reserved: "库存预留",
  inventory_confirmed: "库存确认消耗",
  inventory_released: "库存释放",
  batch_created: "创建批次",
  batch_tiles_added: "批次添加试片",
  batch_status_changed: "批次状态变更",
  defect_tags_changed: "缺陷标签变更",
  recipe_version_created: "配方版本创建"
};

function generateEventId(coll) {
  const existing = new Set((coll.businessEvents || []).map(e => e.id));
  let counter = (coll.businessEvents || []).length + 1;
  let id;
  do {
    id = `EVT-${String(counter).padStart(5, "0")}`;
    counter++;
  } while (existing.has(id));
  return id;
}

function pushEvent(coll, event) {
  if (!Array.isArray(coll.businessEvents)) coll.businessEvents = [];
  coll.businessEvents.push(event);
}

export function up(db) {
  const { getCollections } = db._helpers;
  const coll = getCollections(db);

  if (!Array.isArray(coll.businessEvents)) {
    coll.businessEvents = [];
  }

  const stats = {
    tileCreatedEvents: 0,
    statusTransitionEvents: 0,
    inventoryReserveEvents: 0,
    inventoryConfirmEvents: 0,
    inventoryReleaseEvents: 0,
    batchCreatedEvents: 0,
    defectTagEvents: 0,
    recipeVersionEvents: 0,
    totalEvents: 0
  };

  const migrationTimestamp = new Date().toISOString();

  if (Array.isArray(coll.recipeVersions)) {
    for (const version of coll.recipeVersions) {
      const at = version.createdAt || migrationTimestamp;
      pushEvent(coll, {
        id: generateEventId(coll),
        type: "recipe_version_created",
        typeLabel: EVENT_TYPE_LABELS.recipe_version_created,
        entityId: version.id,
        entityType: "recipe_version",
        payload: {
          recipeId: version.recipeId,
          version: version.version,
          text: version.text,
          parentVersionId: version.parentVersionId || null,
          ingredientCount: (version.ingredients || []).length
        },
        operator: "migration",
        note: version.note || "数据迁移：回溯配方版本创建事件",
        at
      });
      stats.recipeVersionEvents++;
    }
  }

  if (Array.isArray(coll.tiles)) {
    for (const tile of coll.tiles) {
      pushEvent(coll, {
        id: generateEventId(coll),
        type: "tile_created",
        typeLabel: EVENT_TYPE_LABELS.tile_created,
        entityId: tile.id,
        entityType: "tile",
        payload: {
          body: tile.body,
          recipe: tile.recipe,
          recipeVersionId: tile.recipeVersionId || null,
          ashSource: tile.ashSource,
          kiln: tile.kiln,
          peakTemp: tile.peakTemp
        },
        operator: "migration",
        note: "数据迁移：回溯试片创建事件",
        at: tile.statusHistory && tile.statusHistory[0] && tile.statusHistory[0].at
          ? tile.statusHistory[0].at
          : migrationTimestamp
      });
      stats.tileCreatedEvents++;

      if (Array.isArray(tile.statusHistory)) {
        for (const record of tile.statusHistory) {
          if (record.from === null && record.to === tile.status) {
            if (record.operator === "migration" || record.operator === "system") continue;
          }
          pushEvent(coll, {
            id: generateEventId(coll),
            type: "status_transitioned",
            typeLabel: EVENT_TYPE_LABELS.status_transitioned,
            entityId: tile.id,
            entityType: "tile",
            payload: {
              from: record.from,
              to: record.to,
              fromLabel: record.fromLabel || record.from,
              toLabel: record.toLabel || record.to
            },
            operator: record.operator || "migration",
            note: record.note || "数据迁移：回溯状态流转事件",
            at: record.at || migrationTimestamp
          });
          stats.statusTransitionEvents++;
        }
      }

      if (tile.inventoryReserved) {
        pushEvent(coll, {
          id: generateEventId(coll),
          type: "inventory_reserved",
          typeLabel: EVENT_TYPE_LABELS.inventory_reserved,
          entityId: tile.id,
          entityType: "tile",
          payload: {
            materialBatchRefs: tile.materialBatchRefs || [],
            batchWeight: tile.batchWeight || null
          },
          operator: "migration",
          note: "数据迁移：回溯库存预留事件（待烧成状态）",
          at: migrationTimestamp
        });
        stats.inventoryReserveEvents++;
      }

      if (tile.inventoryConsumed) {
        pushEvent(coll, {
          id: generateEventId(coll),
          type: "inventory_confirmed",
          typeLabel: EVENT_TYPE_LABELS.inventory_confirmed,
          entityId: tile.id,
          entityType: "tile",
          payload: {
            materialBatchRefs: tile.materialBatchRefs || [],
            batchWeight: tile.batchWeight || null
          },
          operator: "migration",
          note: "数据迁移：回溯库存确认消耗事件（已烧成或之后状态）",
          at: migrationTimestamp
        });
        stats.inventoryConfirmEvents++;
      }

      if (Array.isArray(tile.defectTags) && tile.defectTags.length > 0) {
        pushEvent(coll, {
          id: generateEventId(coll),
          type: "defect_tags_changed",
          typeLabel: EVENT_TYPE_LABELS.defect_tags_changed,
          entityId: tile.id,
          entityType: "tile",
          payload: {
            action: "set",
            defectTags: tile.defectTags
          },
          operator: "migration",
          note: "数据迁移：回溯缺陷标签变更事件",
          at: migrationTimestamp
        });
        stats.defectTagEvents++;
      }
    }
  }

  if (Array.isArray(coll.batches)) {
    for (const batch of coll.batches) {
      pushEvent(coll, {
        id: generateEventId(coll),
        type: "batch_created",
        typeLabel: EVENT_TYPE_LABELS.batch_created,
        entityId: batch.id,
        entityType: "batch",
        payload: {
          name: batch.name,
          kiln: batch.kiln,
          plannedDate: batch.plannedDate,
          targetAtmosphere: batch.targetAtmosphere,
          tileCount: (batch.tileIds || []).length
        },
        operator: "migration",
        note: "数据迁移：回溯批次创建事件",
        at: batch.createdAt || migrationTimestamp
      });
      stats.batchCreatedEvents++;

      if (batch.status && batch.status !== "planned") {
        pushEvent(coll, {
          id: generateEventId(coll),
          type: "batch_status_changed",
          typeLabel: EVENT_TYPE_LABELS.batch_status_changed,
          entityId: batch.id,
          entityType: "batch",
          payload: {
            from: "planned",
            to: batch.status
          },
          operator: "migration",
          note: "数据迁移：回溯批次状态变更事件",
          at: batch.updatedAt || migrationTimestamp
        });
        stats.batchCreatedEvents++;
      }
    }
  }

  if (Array.isArray(coll.inventoryTransactions)) {
    for (const txn of coll.inventoryTransactions) {
      if (txn.type === "release" && txn.status === "completed") {
        pushEvent(coll, {
          id: generateEventId(coll),
          type: "inventory_released",
          typeLabel: EVENT_TYPE_LABELS.inventory_released,
          entityId: txn.tileId,
          entityType: "tile",
          payload: {
            stockId: txn.stockId,
            ingredientName: txn.ingredientName,
            batchNo: txn.batchNo,
            quantity: txn.quantity,
            unit: txn.unit
          },
          operator: "migration",
          note: "数据迁移：回溯库存释放事件",
          at: txn.createdAt || migrationTimestamp
        });
        stats.inventoryReleaseEvents++;
      }
    }
  }

  stats.totalEvents = coll.businessEvents.length;

  return {
    migrated: true,
    stats,
    collectionsCount: {
      businessEvents: coll.businessEvents.length,
      tiles: (coll.tiles || []).length,
      batches: (coll.batches || []).length,
      recipeVersions: (coll.recipeVersions || []).length
    },
    result: db
  };
}

export function down(db) {
  const { getCollections } = db._helpers;
  const coll = getCollections(db);

  delete coll.businessEvents;

  return {
    rolledBack: true,
    stats: {
      removedEvents: true
    },
    result: db
  };
}

export function validate(db) {
  const { getCollections } = db._helpers;
  const errors = [];

  const coll = getCollections(db);

  if (!Array.isArray(coll.businessEvents)) {
    errors.push("collection 'businessEvents' must be an array");
    return { valid: false, errors };
  }

  const seenIds = new Set();
  for (const event of coll.businessEvents) {
    if (!event.id) {
      errors.push("event missing 'id' field");
    } else if (seenIds.has(event.id)) {
      errors.push(`duplicate event id: ${event.id}`);
    } else {
      seenIds.add(event.id);
    }

    if (!event.type) {
      errors.push(`event[${event.id}]: missing 'type' field`);
    }
    if (!event.entityId) {
      errors.push(`event[${event.id}]: missing 'entityId' field`);
    }
    if (!event.entityType) {
      errors.push(`event[${event.id}]: missing 'entityType' field`);
    }
    if (!event.at) {
      errors.push(`event[${event.id}]: missing 'at' field`);
    }
  }

  return { valid: errors.length === 0, errors };
}
