export const DEFECT_CATALOG = [
  { key: "running_glaze", name: "流釉", aliases: ["流釉", "釉泪", "釉流"] },
  { key: "pinhole", name: "针孔", aliases: ["针孔", "毛孔", "棕眼"] },
  { key: "crawling", name: "缩釉", aliases: ["缩釉", "釉缩", "爬釉"] },
  { key: "color_variation", name: "色差", aliases: ["色差", "颜色不均", "发色不均"] },
  { key: "crackle", name: "开片", aliases: ["开片", "裂纹", "釉裂"] },
  { key: "bubbles", name: "气泡", aliases: ["气泡", "釉泡", "破泡"] },
  { key: "cracking", name: "开裂", aliases: ["开裂", "炸裂", "坯裂"] },
  { key: "matteness", name: "无光", aliases: ["无光", "失光", "不亮", "哑色"] },
  { key: "spots", name: "斑点", aliases: ["斑点", "黑点", "杂色", "污点"] },
  { key: "orange_peel", name: "橘皮", aliases: ["橘皮", "桔皮", "釉面不平"] },
  { key: "missing_glaze", name: "缺釉", aliases: ["缺釉", "漏釉", "露胎"] },
  { key: "streaks", name: "釉缕", aliases: ["釉缕", "流痕", "条纹", "拉丝"] }
];

export const SEVERITY_LEVELS = ["mild", "medium", "severe"];

export const SEVERITY_LABELS = {
  mild: "轻微",
  medium: "中等",
  severe: "严重"
};

export function getDefectCatalog() {
  return DEFECT_CATALOG.map(d => ({
    key: d.key,
    name: d.name,
    aliases: d.aliases
  }));
}

export function isValidDefectName(name) {
  if (!name || typeof name !== "string") return false;
  return DEFECT_CATALOG.some(d =>
    d.name === name.trim() || d.aliases.includes(name.trim())
  );
}

export function normalizeDefectName(name) {
  if (!name || typeof name !== "string") return null;
  const trimmed = name.trim();
  const match = DEFECT_CATALOG.find(d =>
    d.name === trimmed || d.aliases.includes(trimmed)
  );
  return match ? match.name : null;
}

export function getDefectKeyByName(name) {
  if (!name || typeof name !== "string") return null;
  const trimmed = name.trim();
  const match = DEFECT_CATALOG.find(d =>
    d.name === trimmed || d.aliases.includes(trimmed)
  );
  return match ? match.key : null;
}

export function isValidSeverity(severity) {
  return SEVERITY_LEVELS.includes(severity);
}

export function normalizeSeverity(severity) {
  if (!severity) return "medium";
  const s = String(severity).toLowerCase().trim();
  if (SEVERITY_LEVELS.includes(s)) return s;
  if (s === "轻微" || s === "轻" || s === "low") return "mild";
  if (s === "中等" || s === "中" || s === "normal") return "medium";
  if (s === "严重" || s === "重" || s === "high") return "severe";
  return "medium";
}

export function validateDefectTag(tag) {
  const errors = [];
  if (!tag || typeof tag !== "object") {
    return { valid: false, errors: ["缺陷标签必须为对象"] };
  }
  if (!tag.name) {
    errors.push("缺陷标签 name 为必填");
  } else if (!isValidDefectName(tag.name)) {
    errors.push(`未知的缺陷类型: ${tag.name}`);
  }
  if (tag.severity !== undefined && tag.severity !== null && tag.severity !== "") {
    if (!isValidSeverity(tag.severity) &&
        !["轻微", "中等", "严重", "轻", "中", "重", "low", "normal", "high"].includes(String(tag.severity).trim())) {
      errors.push(`严重程度必须为 mild/medium/severe 或 轻微/中等/严重, 当前值: ${tag.severity}`);
    }
  }
  return {
    valid: errors.length === 0,
    errors
  };
}

export function validateDefectTags(tags) {
  if (tags === undefined || tags === null) {
    return { valid: true, errors: [], normalized: [] };
  }
  if (!Array.isArray(tags)) {
    return { valid: false, errors: ["defectTags 必须为数组"], normalized: [] };
  }
  const allErrors = [];
  const normalized = [];
  const seenNames = new Set();
  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i];
    const result = validateDefectTag(tag);
    if (!result.valid) {
      allErrors.push(...result.errors.map(e => `第${i + 1}项: ${e}`));
    } else {
      const normalizedName = normalizeDefectName(tag.name);
      if (seenNames.has(normalizedName)) {
        allErrors.push(`第${i + 1}项: 缺陷类型重复: ${normalizedName}`);
      } else {
        seenNames.add(normalizedName);
        normalized.push({
          name: normalizedName,
          severity: normalizeSeverity(tag.severity),
          note: tag.note || ""
        });
      }
    }
  }
  return {
    valid: allErrors.length === 0,
    errors: allErrors,
    normalized
  };
}

export function tryParseDefectText(defectText) {
  if (!defectText || typeof defectText !== "string") return [];
  const text = defectText.trim();
  if (!text) return [];

  const tags = [];
  const seen = new Set();

  for (const defect of DEFECT_CATALOG) {
    for (const alias of defect.aliases) {
      if (text.includes(alias)) {
        if (!seen.has(defect.name)) {
          let severity = "medium";
          if (text.includes("轻微") || text.includes("轻度") || text.includes("小")) {
            severity = "mild";
          } else if (text.includes("严重") || text.includes("重度") || text.includes("大")) {
            severity = "severe";
          } else if (text.includes("边缘")) {
            severity = "mild";
          }
          tags.push({
            name: defect.name,
            severity,
            note: ""
          });
          seen.add(defect.name);
        }
        break;
      }
    }
  }

  if (tags.length === 0 && text.length > 0) {
    tags.push({
      name: "斑点",
      severity: "medium",
      note: text
    });
  }

  return tags;
}
