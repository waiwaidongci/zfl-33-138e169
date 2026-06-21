import { ensureEventCollection, getTimeline, getEventsByType, getEventStats, EVENT_TYPES } from "./event-log.js";

export { EVENT_TYPES };

export async function handleGetEntityTimeline(entityId, url, db) {
  ensureEventCollection(db);

  const options = {
    type: url.searchParams.get("type") || undefined,
    entityType: url.searchParams.get("entityType") || undefined,
    from: url.searchParams.get("from") || undefined,
    to: url.searchParams.get("to") || undefined,
    limit: Math.max(1, Math.min(500, Number(url.searchParams.get("limit") || 100))),
    offset: Math.max(0, Number(url.searchParams.get("offset") || 0)),
    desc: url.searchParams.get("order") === "desc"
  };

  const result = getTimeline(db, entityId, options);
  return { status: 200, data: result };
}

export async function handleGetEventsByType(type, url, db) {
  ensureEventCollection(db);

  if (!Object.values(EVENT_TYPES).includes(type)) {
    return { status: 400, data: { error: "invalid_event_type", message: `未知事件类型: ${type}`, validTypes: Object.values(EVENT_TYPES) } };
  }

  const options = {
    limit: Math.max(1, Math.min(500, Number(url.searchParams.get("limit") || 50))),
    offset: Math.max(0, Number(url.searchParams.get("offset") || 0))
  };

  const result = getEventsByType(db, type, options);
  return { status: 200, data: result };
}

export async function handleGetEventStats(db) {
  ensureEventCollection(db);
  const stats = getEventStats(db);
  return { status: 200, data: stats };
}

export async function handleGetEventTypes() {
  return {
    status: 200,
    data: {
      types: Object.entries(EVENT_TYPES).map(([key, value]) => ({
        key,
        value,
        label: {
          tile_created: "创建试片",
          status_transitioned: "状态流转",
          inventory_reserved: "库存预留",
          inventory_confirmed: "库存确认消耗",
          inventory_released: "库存释放",
          batch_created: "创建批次",
          batch_tiles_added: "批次添加试片",
          batch_tiles_removed: "批次移除试片",
          batch_status_changed: "批次状态变更",
          defect_tags_changed: "缺陷标签变更",
          recipe_version_created: "配方版本创建"
        }[value]
      }))
    }
  };
}
