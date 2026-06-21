import { getCollections } from "./db.js";

export const EVENT_TYPES = {
  TILE_CREATED: "tile_created",
  STATUS_TRANSITIONED: "status_transitioned",
  INVENTORY_RESERVED: "inventory_reserved",
  INVENTORY_CONFIRMED: "inventory_confirmed",
  INVENTORY_RELEASED: "inventory_released",
  BATCH_CREATED: "batch_created",
  BATCH_TILES_ADDED: "batch_tiles_added",
  BATCH_TILES_REMOVED: "batch_tiles_removed",
  BATCH_STATUS_CHANGED: "batch_status_changed",
  DEFECT_TAGS_CHANGED: "defect_tags_changed",
  RECIPE_VERSION_CREATED: "recipe_version_created"
};

export const ENTITY_TYPES = {
  TILE: "tile",
  BATCH: "batch",
  RECIPE: "recipe",
  RECIPE_VERSION: "recipe_version",
  STOCK: "stock"
};

const EVENT_TYPE_LABELS = {
  [EVENT_TYPES.TILE_CREATED]: "创建试片",
  [EVENT_TYPES.STATUS_TRANSITIONED]: "状态流转",
  [EVENT_TYPES.INVENTORY_RESERVED]: "库存预留",
  [EVENT_TYPES.INVENTORY_CONFIRMED]: "库存确认消耗",
  [EVENT_TYPES.INVENTORY_RELEASED]: "库存释放",
  [EVENT_TYPES.BATCH_CREATED]: "创建批次",
  [EVENT_TYPES.BATCH_TILES_ADDED]: "批次添加试片",
  [EVENT_TYPES.BATCH_TILES_REMOVED]: "批次移除试片",
  [EVENT_TYPES.BATCH_STATUS_CHANGED]: "批次状态变更",
  [EVENT_TYPES.DEFECT_TAGS_CHANGED]: "缺陷标签变更",
  [EVENT_TYPES.RECIPE_VERSION_CREATED]: "配方版本创建"
};

export function ensureEventCollection(db) {
  const coll = getCollections(db);
  if (!coll.businessEvents) coll.businessEvents = [];
}

function generateEventId(db) {
  ensureEventCollection(db);
  const coll = getCollections(db);
  const existing = new Set(coll.businessEvents.map(e => e.id));
  let counter = coll.businessEvents.length + 1;
  let id;
  do {
    id = `EVT-${String(counter).padStart(5, "0")}`;
    counter++;
  } while (existing.has(id));
  return id;
}

export function recordEvent(db, { type, entityId, entityType, payload, operator, note, at }) {
  ensureEventCollection(db);
  const coll = getCollections(db);

  const event = {
    id: generateEventId(db),
    type,
    typeLabel: EVENT_TYPE_LABELS[type] || type,
    entityId,
    entityType,
    payload: payload || {},
    operator: operator || "system",
    note: note || "",
    at: at || new Date().toISOString()
  };

  coll.businessEvents.push(event);
  return event;
}

export function getTimeline(db, entityId, options = {}) {
  ensureEventCollection(db);
  const coll = getCollections(db);

  let events = coll.businessEvents.filter(e => e.entityId === entityId);

  if (options.type) {
    events = events.filter(e => e.type === options.type);
  }

  if (options.entityType) {
    events = events.filter(e => e.entityType === options.entityType);
  }

  if (options.from) {
    events = events.filter(e => e.at >= options.from);
  }

  if (options.to) {
    events = events.filter(e => e.at <= options.to);
  }

  events.sort((a, b) => {
    const cmp = a.at.localeCompare(b.at);
    if (cmp !== 0) return cmp;
    return a.id.localeCompare(b.id);
  });

  if (options.desc) {
    events.reverse();
  }

  const limit = options.limit || 100;
  const offset = options.offset || 0;
  const total = events.length;
  const sliced = events.slice(offset, offset + limit);

  return {
    entityId,
    total,
    offset,
    limit,
    events: sliced
  };
}

export function getEventsByType(db, type, options = {}) {
  ensureEventCollection(db);
  const coll = getCollections(db);

  let events = coll.businessEvents.filter(e => e.type === type);

  events.sort((a, b) => {
    const cmp = b.at.localeCompare(a.at);
    if (cmp !== 0) return cmp;
    return b.id.localeCompare(a.id);
  });

  const limit = options.limit || 50;
  const offset = options.offset || 0;
  const total = events.length;
  const sliced = events.slice(offset, offset + limit);

  return {
    type,
    total,
    offset,
    limit,
    events: sliced
  };
}

export function getEventStats(db) {
  ensureEventCollection(db);
  const coll = getCollections(db);

  const byType = {};
  const byEntityType = {};
  let earliest = null;
  let latest = null;

  for (const event of coll.businessEvents) {
    byType[event.type] = (byType[event.type] || 0) + 1;
    byEntityType[event.entityType] = (byEntityType[event.entityType] || 0) + 1;

    if (!earliest || event.at < earliest) earliest = event.at;
    if (!latest || event.at > latest) latest = event.at;
  }

  return {
    totalEvents: coll.businessEvents.length,
    byType,
    byEntityType,
    earliest,
    latest
  };
}
