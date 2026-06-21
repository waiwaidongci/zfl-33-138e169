import { TILE_STATUSES } from "../tile-status-machine.js";

export const version = 3;
export const name = "add-inventory-reservation";
export const description = "引入库存预留机制，将即时扣减改为预留/确认消耗/退回释放三阶段，增加库存流水集合";

export function up(db) {
  const { getCollections } = db._helpers;
  const coll = getCollections(db);

  if (!Array.isArray(coll.inventoryTransactions)) {
    coll.inventoryTransactions = [];
  }

  if (!Array.isArray(coll.materialStocks)) {
    coll.materialStocks = [];
  }

  for (const stock of coll.materialStocks) {
    if (stock.reservedQuantity === undefined) {
      stock.reservedQuantity = 0;
    }
  }

  if (!Array.isArray(coll.tiles)) {
    coll.tiles = [];
  }

  let reserveCount = 0;
  let confirmCount = 0;

  for (const tile of coll.tiles) {
    if (tile.reservationIds === undefined) {
      tile.reservationIds = [];
    }

    if (!tile.inventoryDeducted) {
      tile.inventoryReserved = false;
      tile.inventoryConsumed = false;
      continue;
    }

    const refs = tile.materialBatchRefs || [];
    const batchWeight = tile.batchWeight || 0;

    if (tile.status === TILE_STATUSES.PENDING_FIRING) {
      tile.inventoryReserved = true;
      tile.inventoryConsumed = false;

      for (const ref of refs) {
        const stock = coll.materialStocks.find(
          s => s.name === ref.ingredientName && s.batchNo === ref.batchNo
        );
        if (!stock) continue;

        const deducted = ref.deducted || 0;
        if (deducted > 0) {
          stock.quantity = Number((stock.quantity + deducted).toFixed(2));
          stock.reservedQuantity = Number((stock.reservedQuantity + deducted).toFixed(2));
        }

        const txnId = generateTransactionId(coll);
        const txn = {
          id: txnId,
          tileId: tile.id,
          stockId: stock.id,
          ingredientName: ref.ingredientName,
          batchNo: ref.batchNo,
          quantity: deducted,
          unit: stock.unit,
          type: "reserve",
          status: "active",
          relatedTransactionId: null,
          createdAt: new Date().toISOString(),
          note: "数据迁移：将即时扣减转为预留（待烧成状态）"
        };
        coll.inventoryTransactions.push(txn);
        tile.reservationIds.push(txnId);
        reserveCount++;
      }
    } else if (
      tile.status === TILE_STATUSES.FIRED ||
      tile.status === TILE_STATUSES.PENDING_REVIEW ||
      tile.status === TILE_STATUSES.ARCHIVED
    ) {
      tile.inventoryReserved = false;
      tile.inventoryConsumed = true;

      for (const ref of refs) {
        const stock = coll.materialStocks.find(
          s => s.name === ref.ingredientName && s.batchNo === ref.batchNo
        );
        if (!stock) continue;

        const deducted = ref.deducted || 0;
        if (deducted > 0) {
          const reserveTxnId = generateTransactionId(coll);
          coll.inventoryTransactions.push({
            id: reserveTxnId,
            tileId: tile.id,
            stockId: stock.id,
            ingredientName: ref.ingredientName,
            batchNo: ref.batchNo,
            quantity: deducted,
            unit: stock.unit,
            type: "reserve",
            status: "completed",
            relatedTransactionId: null,
            createdAt: new Date().toISOString(),
            note: "数据迁移：回溯预留记录（已烧成或之后状态）"
          });

          const confirmTxnId = generateTransactionId(coll);
          coll.inventoryTransactions.push({
            id: confirmTxnId,
            tileId: tile.id,
            stockId: stock.id,
            ingredientName: ref.ingredientName,
            batchNo: ref.batchNo,
            quantity: deducted,
            unit: stock.unit,
            type: "confirm",
            status: "completed",
            relatedTransactionId: reserveTxnId,
            createdAt: new Date().toISOString(),
            note: "数据迁移：回溯确认消耗记录（已烧成或之后状态）"
          });

          tile.reservationIds.push(reserveTxnId, confirmTxnId);
          confirmCount++;
        }
      }
    } else {
      tile.inventoryReserved = false;
      tile.inventoryConsumed = false;
    }
  }

  return {
    migrated: true,
    stats: {
      totalTiles: coll.tiles.length,
      reserveTransactions: reserveCount,
      confirmTransactions: confirmCount,
      totalTransactions: coll.inventoryTransactions.length
    },
    result: db
  };
}

export function down(db) {
  const { getCollections } = db._helpers;
  const coll = getCollections(db);

  if (Array.isArray(coll.inventoryTransactions)) {
    for (const tile of coll.tiles) {
      if (!tile.inventoryDeducted) continue;
      const refs = tile.materialBatchRefs || [];

      if (tile.status === TILE_STATUSES.PENDING_FIRING) {
        for (const ref of refs) {
          const stock = coll.materialStocks.find(
            s => s.name === ref.ingredientName && s.batchNo === ref.batchNo
          );
          if (!stock) continue;
          const deducted = ref.deducted || 0;
          if (deducted > 0) {
            stock.reservedQuantity = Number((stock.reservedQuantity - deducted).toFixed(2));
            stock.quantity = Number((stock.quantity - deducted).toFixed(2));
          }
        }
      }
    }

    delete coll.inventoryTransactions;
  }

  for (const stock of coll.materialStocks) {
    if (stock.reservedQuantity !== undefined) {
      delete stock.reservedQuantity;
    }
  }

  for (const tile of coll.tiles) {
    if (tile.reservationIds !== undefined) delete tile.reservationIds;
    if (tile.inventoryReserved !== undefined) delete tile.inventoryReserved;
    if (tile.inventoryConsumed !== undefined) delete tile.inventoryConsumed;
  }

  return {
    rolledBack: true,
    stats: {
      totalTiles: coll.tiles.length
    },
    result: db
  };
}

export function validate(db) {
  const { getCollections } = db._helpers;
  const errors = [];

  const coll = getCollections(db);

  if (!Array.isArray(coll.inventoryTransactions)) {
    errors.push("collection 'inventoryTransactions' must be an array");
  }

  if (!Array.isArray(coll.materialStocks)) {
    errors.push("collection 'materialStocks' must be an array");
  } else {
    for (const stock of coll.materialStocks) {
      if (stock.reservedQuantity === undefined) {
        errors.push(`stock[${stock.id}]: missing 'reservedQuantity' field`);
      } else if (typeof stock.reservedQuantity !== "number" || stock.reservedQuantity < 0) {
        errors.push(`stock[${stock.id}]: 'reservedQuantity' must be a non-negative number`);
      }
    }
  }

  if (Array.isArray(coll.tiles)) {
    for (const tile of coll.tiles) {
      if (tile.reservationIds === undefined) {
        errors.push(`tile[${tile.id}]: missing 'reservationIds' field`);
      }
      if (tile.inventoryReserved === undefined) {
        errors.push(`tile[${tile.id}]: missing 'inventoryReserved' field`);
      }
      if (tile.inventoryConsumed === undefined) {
        errors.push(`tile[${tile.id}]: missing 'inventoryConsumed' field`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

function generateTransactionId(coll) {
  const existing = new Set(
    (coll.inventoryTransactions || []).map(t => t.id)
  );
  let counter = (coll.inventoryTransactions || []).length + 1;
  let id;
  do {
    id = `IT-${String(counter).padStart(3, "0")}`;
    counter++;
  } while (existing.has(id));
  return id;
}
