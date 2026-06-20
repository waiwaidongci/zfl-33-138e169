export const TILE_STATUSES = {
  DRAFT: "draft",
  PENDING_FIRING: "pending_firing",
  FIRED: "fired",
  PENDING_REVIEW: "pending_review",
  ARCHIVED: "archived"
};

export const TILE_STATUS_LABELS = {
  [TILE_STATUSES.DRAFT]: "草稿",
  [TILE_STATUSES.PENDING_FIRING]: "待烧成",
  [TILE_STATUSES.FIRED]: "已烧成",
  [TILE_STATUSES.PENDING_REVIEW]: "待复盘",
  [TILE_STATUSES.ARCHIVED]: "已归档"
};

export const VALID_TRANSITIONS = {
  [TILE_STATUSES.DRAFT]: [TILE_STATUSES.PENDING_FIRING],
  [TILE_STATUSES.PENDING_FIRING]: [TILE_STATUSES.DRAFT, TILE_STATUSES.FIRED],
  [TILE_STATUSES.FIRED]: [TILE_STATUSES.PENDING_REVIEW],
  [TILE_STATUSES.PENDING_REVIEW]: [TILE_STATUSES.FIRED, TILE_STATUSES.ARCHIVED],
  [TILE_STATUSES.ARCHIVED]: []
};

export const INITIAL_STATUS = TILE_STATUSES.DRAFT;

export function isValidStatus(status) {
  return Object.values(TILE_STATUSES).includes(status);
}

export function isValidTransition(fromStatus, toStatus) {
  if (!isValidStatus(fromStatus) || !isValidStatus(toStatus)) {
    return false;
  }
  const allowed = VALID_TRANSITIONS[fromStatus] || [];
  return allowed.includes(toStatus);
}

export function getAvailableTransitions(currentStatus) {
  if (!isValidStatus(currentStatus)) {
    return [];
  }
  return VALID_TRANSITIONS[currentStatus] || [];
}

export function getTransitionError(fromStatus, toStatus) {
  if (!isValidStatus(fromStatus)) {
    return `当前状态 '${fromStatus}' 不是有效的试片状态`;
  }
  if (!isValidStatus(toStatus)) {
    return `目标状态 '${toStatus}' 不是有效的试片状态`;
  }
  if (fromStatus === toStatus) {
    return `状态未发生变化，当前已为 '${TILE_STATUS_LABELS[fromStatus]}'`;
  }
  const allowed = VALID_TRANSITIONS[fromStatus] || [];
  if (allowed.length === 0) {
    return `'${TILE_STATUS_LABELS[fromStatus]}' 状态下不允许变更状态`;
  }
  const allowedLabels = allowed.map(s => `'${TILE_STATUS_LABELS[s]}'`).join("、");
  return `状态不允许从 '${TILE_STATUS_LABELS[fromStatus]}' 变更为 '${TILE_STATUS_LABELS[toStatus]}'，只允许变更为：${allowedLabels}`;
}

export function canTransitionTo(fromStatus, toStatus) {
  return isValidTransition(fromStatus, toStatus) && fromStatus !== toStatus;
}

export function isEditableStatus(status) {
  return status !== TILE_STATUSES.ARCHIVED;
}

export function isFiredOrLater(status) {
  const order = [
    TILE_STATUSES.DRAFT,
    TILE_STATUSES.PENDING_FIRING,
    TILE_STATUSES.FIRED,
    TILE_STATUSES.PENDING_REVIEW,
    TILE_STATUSES.ARCHIVED
  ];
  return order.indexOf(status) >= order.indexOf(TILE_STATUSES.FIRED);
}
