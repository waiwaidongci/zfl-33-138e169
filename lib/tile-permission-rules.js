import { TILE_STATUSES } from "./tile-status-machine.js";

const ALL_TILE_FIELDS = [
  "id", "body", "recipe", "recipeVersionId", "ashSource", "glazeThickness",
  "kiln", "firingCurve", "peakTemp", "color", "defects", "defectTags",
  "score", "observations", "fromPlanId", "materialBatchRefs", "batchWeight",
  "batchId", "status", "statusHistory", "inventoryDeducted"
];

const BASIC_INFO_FIELDS = [
  "body", "recipe", "recipeVersionId", "ashSource", "glazeThickness",
  "kiln", "firingCurve", "peakTemp", "materialBatchRefs", "batchWeight"
];

const FIRING_RESULT_FIELDS = [
  "color", "defects", "defectTags", "score", "observations"
];

const REVIEW_FIELDS = [
  "score", "observations", "defectTags"
];

const ALLOWED_FIELDS_BY_STATUS = {
  [TILE_STATUSES.DRAFT]: [
    ...BASIC_INFO_FIELDS,
    "fromPlanId", "color", "defects", "defectTags", "score", "observations"
  ],
  [TILE_STATUSES.PENDING_FIRING]: [
    "kiln", "observations"
  ],
  [TILE_STATUSES.FIRED]: [
    ...FIRING_RESULT_FIELDS,
    "batchId"
  ],
  [TILE_STATUSES.PENDING_REVIEW]: [
    ...REVIEW_FIELDS
  ],
  [TILE_STATUSES.ARCHIVED]: []
};

const FIELDS_REQUIRING_INVENTORY_DEDUCTION = ["materialBatchRefs", "batchWeight"];

export function getAllowedFields(status) {
  return ALLOWED_FIELDS_BY_STATUS[status] || [];
}

export function isFieldAllowed(status, field) {
  const allowed = getAllowedFields(status);
  return allowed.includes(field);
}

export function validateFieldsForStatus(status, fields) {
  const allowed = getAllowedFields(status);
  const disallowed = fields.filter(f => !allowed.includes(f));
  const invalidFields = fields.filter(f => !ALL_TILE_FIELDS.includes(f));

  const errors = [];
  if (invalidFields.length > 0) {
    errors.push({
      error: "unknown_fields",
      message: `包含未知字段: ${invalidFields.join(", ")}`,
      fields: invalidFields
    });
  }
  if (disallowed.length > 0) {
    const statusLabel = getStatusLabel(status);
    errors.push({
      error: "fields_not_allowed",
      message: `当前状态为 '${statusLabel}'，不允许修改字段: ${disallowed.join(", ")}`,
      fields: disallowed,
      allowedFields: allowed
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    allowedFields: allowed
  };
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

export function requiresInventoryDeduction(fromStatus, toStatus) {
  return fromStatus === TILE_STATUSES.DRAFT && toStatus === TILE_STATUSES.PENDING_FIRING;
}

export function requiresInventoryRestore(fromStatus, toStatus) {
  return fromStatus === TILE_STATUSES.PENDING_FIRING && toStatus === TILE_STATUSES.DRAFT;
}

export function shouldValidateFiringResult(status) {
  return status === TILE_STATUSES.FIRED || status === TILE_STATUSES.PENDING_REVIEW || status === TILE_STATUSES.ARCHIVED;
}

export function shouldLockBasicInfo(status) {
  return status !== TILE_STATUSES.DRAFT;
}

export function getFieldCategory(field) {
  if (BASIC_INFO_FIELDS.includes(field)) return "basic";
  if (FIRING_RESULT_FIELDS.includes(field)) return "firing_result";
  if (REVIEW_FIELDS.includes(field)) return "review";
  if (field === "batchId") return "batch";
  return "other";
}

export function getStatusFieldRules() {
  return {
    [TILE_STATUSES.DRAFT]: {
      description: "草稿状态：可编辑所有基础信息",
      editable: BASIC_INFO_FIELDS,
      locked: []
    },
    [TILE_STATUSES.PENDING_FIRING]: {
      description: "待烧成：基础信息已锁定，仅可调整窑炉和添加观察记录",
      editable: ["kiln", "observations"],
      locked: BASIC_INFO_FIELDS.filter(f => f !== "kiln")
    },
    [TILE_STATUSES.FIRED]: {
      description: "已烧成：可录入烧成结果（颜色、缺陷、评分、观察记录）",
      editable: FIRING_RESULT_FIELDS.concat(["batchId"]),
      locked: BASIC_INFO_FIELDS
    },
    [TILE_STATUSES.PENDING_REVIEW]: {
      description: "待复盘：仅可调整评分、观察记录和缺陷标签",
      editable: REVIEW_FIELDS,
      locked: BASIC_INFO_FIELDS.concat(["color", "defects"])
    },
    [TILE_STATUSES.ARCHIVED]: {
      description: "已归档：所有字段只读",
      editable: [],
      locked: ALL_TILE_FIELDS
    }
  };
}
