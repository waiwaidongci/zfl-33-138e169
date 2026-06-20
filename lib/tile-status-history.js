import { TILE_STATUS_LABELS } from "./tile-status-machine.js";

export function createStatusRecord(fromStatus, toStatus, operator, note) {
  return {
    from: fromStatus,
    to: toStatus,
    fromLabel: TILE_STATUS_LABELS[fromStatus] || fromStatus,
    toLabel: TILE_STATUS_LABELS[toStatus] || toStatus,
    operator: operator || "system",
    note: note || generateDefaultNote(fromStatus, toStatus),
    at: new Date().toISOString()
  };
}

function generateDefaultNote(fromStatus, toStatus) {
  const fromLabel = TILE_STATUS_LABELS[fromStatus] || fromStatus;
  const toLabel = TILE_STATUS_LABELS[toStatus] || toStatus;
  return `状态从 '${fromLabel}' 变更为 '${toLabel}'`;
}

export function addStatusHistory(tile, record) {
  if (!tile.statusHistory) {
    tile.statusHistory = [];
  }
  tile.statusHistory.push(record);
  return tile.statusHistory;
}

export function getStatusHistory(tile) {
  return tile.statusHistory || [];
}

export function getFirstStatus(tile) {
  const history = getStatusHistory(tile);
  if (history.length === 0) return tile.status;
  return history[0].from;
}

export function getLastTransition(tile) {
  const history = getStatusHistory(tile);
  if (history.length === 0) return null;
  return history[history.length - 1];
}

export function getStatusAt(tile, index) {
  const history = getStatusHistory(tile);
  if (index < 0 || index >= history.length) return null;
  return history[index];
}

export function getStatusChangesCount(tile) {
  return getStatusHistory(tile).length;
}

export function hasBeenInStatus(tile, status) {
  const history = getStatusHistory(tile);
  for (const record of history) {
    if (record.from === status || record.to === status) {
      return true;
    }
  }
  return tile.status === status;
}

export function getStatusDuration(tile, status) {
  const history = getStatusHistory(tile);
  let totalMs = 0;
  let currentStart = null;

  if (tile.status === status && history.length > 0) {
    const lastRecord = history[history.length - 1];
    if (lastRecord.to === status) {
      currentStart = new Date(lastRecord.at);
      totalMs += Date.now() - currentStart.getTime();
    }
  }

  for (let i = 0; i < history.length; i++) {
    const record = history[i];
    if (record.to === status) {
      const start = new Date(record.at);
      const endRecord = history.find((r, idx) => idx > i && r.from === status);
      const end = endRecord ? new Date(endRecord.at) : new Date();
      totalMs += end.getTime() - start.getTime();
    }
  }

  return {
    milliseconds: totalMs,
    seconds: Math.floor(totalMs / 1000),
    minutes: Math.floor(totalMs / (1000 * 60)),
    hours: Math.floor(totalMs / (1000 * 60 * 60)),
    days: Math.floor(totalMs / (1000 * 60 * 60 * 24))
  };
}

export function formatStatusHistory(history) {
  return history.map(record => ({
    ...record,
    durationLabel: formatDuration(record.at)
  }));
}

function formatDuration(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) return `${diffDays}天前`;
  if (diffHours > 0) return `${diffHours}小时前`;
  if (diffMinutes > 0) return `${diffMinutes}分钟前`;
  return "刚刚";
}

export function getStatusProgress(tile) {
  const order = ["draft", "pending_firing", "fired", "pending_review", "archived"];
  const currentIndex = order.indexOf(tile.status);
  return {
    current: tile.status,
    currentIndex,
    total: order.length,
    progress: Math.round(((currentIndex + 1) / order.length) * 100),
    completed: order.slice(0, currentIndex + 1),
    remaining: order.slice(currentIndex + 1)
  };
}
