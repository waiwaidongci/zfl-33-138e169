import { TILE_STATUSES, INITIAL_STATUS } from "../tile-status-machine.js";
import { createStatusRecord } from "../tile-status-history.js";

export const version = 2;
export const name = "add-tile-status-fields";
export const description = "为试片数据添加状态字段、状态历史记录和批次关联，支持完整的实验审核流转";

export function up(db) {
  const { getCollections, getSchemaVersion } = db._helpers;
  const coll = getCollections(db);

  if (!Array.isArray(coll.tiles)) {
    coll.tiles = [];
  }

  let migratedCount = 0;
  let withScoreCount = 0;
  let withObservationsCount = 0;
  let withColorCount = 0;

  for (const tile of coll.tiles) {
    const originalStatus = tile.status;
    const hasStatus = originalStatus && Object.values(TILE_STATUSES).includes(originalStatus);

    if (!hasStatus) {
      const inferredStatus = inferTileStatus(tile);
      tile.status = inferredStatus;

      if (inferredStatus === TILE_STATUSES.FIRED ||
          inferredStatus === TILE_STATUSES.PENDING_REVIEW ||
          inferredStatus === TILE_STATUSES.ARCHIVED) {
        withScoreCount++;
      }
      if (tile.observations && tile.observations.length > 0) {
        withObservationsCount++;
      }
      if (tile.color) {
        withColorCount++;
      }

      tile.statusHistory = [
        createStatusRecord(
          INITIAL_STATUS,
          inferredStatus,
          "migration",
          `数据迁移自动推断状态：根据现有数据推断为 '${getStatusLabel(inferredStatus)}'`
        )
      ];

      if (inferredStatus !== INITIAL_STATUS) {
        tile.statusHistory.unshift(
          createStatusRecord(
            null,
            INITIAL_STATUS,
            "migration",
            "数据迁移初始化：默认起始状态为 '草稿'"
          )
        );
      }

      if (!tile.batchId) {
        tile.batchId = null;
      }

      if (tile.inventoryDeducted === undefined) {
        tile.inventoryDeducted = false;
      }

      migratedCount++;
    }
  }

  return {
    migrated: true,
    stats: {
      totalTiles: coll.tiles.length,
      migratedTiles: migratedCount,
      inferredAsFiredOrLater: withScoreCount,
      withObservations: withObservationsCount,
      withColor: withColorCount
    },
    result: db
  };
}

export function down(db) {
  const { getCollections } = db._helpers;
  const coll = getCollections(db);

  if (!Array.isArray(coll.tiles)) {
    coll.tiles = [];
  }

  let rolledBackCount = 0;

  for (const tile of coll.tiles) {
    if (tile.status !== undefined) {
      delete tile.status;
      rolledBackCount++;
    }
    if (tile.statusHistory !== undefined) {
      delete tile.statusHistory;
    }
    if (tile.batchId !== undefined) {
      delete tile.batchId;
    }
    if (tile.inventoryDeducted !== undefined) {
      delete tile.inventoryDeducted;
    }
  }

  return {
    rolledBack: true,
    stats: {
      totalTiles: coll.tiles.length,
      rolledBackTiles: rolledBackCount
    },
    result: db
  };
}

export function validate(db) {
  const { getCollections } = db._helpers;
  const errors = [];

  const coll = getCollections(db);
  if (!Array.isArray(coll.tiles)) {
    errors.push("collection 'tiles' must be an array");
    return { valid: false, errors };
  }

  for (let i = 0; i < coll.tiles.length; i++) {
    const tile = coll.tiles[i];
    const tileId = tile.id || `index-${i}`;

    if (!tile.status) {
      errors.push(`tile[${tileId}]: missing 'status' field`);
    } else if (!Object.values(TILE_STATUSES).includes(tile.status)) {
      errors.push(`tile[${tileId}]: invalid status '${tile.status}'`);
    }

    if (!tile.statusHistory) {
      errors.push(`tile[${tileId}]: missing 'statusHistory' field`);
    } else if (!Array.isArray(tile.statusHistory)) {
      errors.push(`tile[${tileId}]: 'statusHistory' must be an array`);
    } else if (tile.statusHistory.length === 0) {
      errors.push(`tile[${tileId}]: 'statusHistory' must not be empty`);
    }

    if (tile.batchId === undefined) {
      errors.push(`tile[${tileId}]: missing 'batchId' field`);
    }

    if (tile.inventoryDeducted === undefined) {
      errors.push(`tile[${tileId}]: missing 'inventoryDeducted' field`);
    }
  }

  return { valid: errors.length === 0, errors };
}

function inferTileStatus(tile) {
  const hasScore = tile.score !== undefined && tile.score > 0;
  const hasColor = tile.color !== undefined && tile.color !== "";
  const hasDefects = tile.defects !== undefined && tile.defects !== "";
  const hasObservations = Array.isArray(tile.observations) && tile.observations.length > 0;
  const hasDefectTags = Array.isArray(tile.defectTags) && tile.defectTags.length > 0;
  const hasFiringCurve = Array.isArray(tile.firingCurve) && tile.firingCurve.length > 0;
  const hasPeakTemp = tile.peakTemp !== undefined && tile.peakTemp > 0;

  const hasFiringResults = hasScore || hasColor || hasDefects || hasDefectTags;
  const hasReviewData = hasObservations && hasScore;

  if (hasReviewData && hasFiringResults && hasColor) {
    return TILE_STATUSES.ARCHIVED;
  }

  if (hasFiringResults || (hasObservations && hasPeakTemp)) {
    return TILE_STATUSES.PENDING_REVIEW;
  }

  if (hasFiringCurve || hasPeakTemp) {
    return TILE_STATUSES.FIRED;
  }

  if (tile.kiln && tile.kiln !== "") {
    return TILE_STATUSES.PENDING_FIRING;
  }

  return INITIAL_STATUS;
}

function getStatusLabel(status) {
  const labels = {
    [TILE_STATUSES.DRAFT]: "草稿",
    [TILE_STATUSES.PENDING_FIRING]: "待烧成",
    [TILE_STATUSES.FIRED]: "已烧成",
    [TILE_STATUSES.PENDING_REVIEW]: "待复盘",
    [TILE_STATUSES.ARCHIVED]: "已归档"
  };
  return labels[status] || status;
}
