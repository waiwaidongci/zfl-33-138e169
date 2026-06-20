# 香灰釉试片实验室API

运行：

```bash
npm start
```

默认端口`3033`。数据保存在`data/ash-glaze.json`。

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | 服务信息与端点列表 |
| GET | `/tiles?ashSource=&minTemp=` | 查询试片列表 |
| POST | `/tiles` | 新增单个试片 |
| GET | `/tiles/:id` | 查询单个试片 |
| POST | `/tiles/:id/observations` | 添加观察记录 |
| GET | `/reports/recipes` | 配方汇总报告 |
| POST | `/import/preview` | 批量导入预览 |
| POST | `/import/commit` | 确认批量导入写入 |

---

## 批量导入使用示例

### 1. 步骤一：提交数据获取预览

支持 **CSV** 和 **JSON** 两种格式，可以通过 **raw body** 直传，也可以通过 **multipart/form-data 上传文件**。格式通过 `Content-Type`、文件名后缀或内容首字符自动识别。

#### 方式 A：直接上传文件（multipart/form-data，推荐）

```bash
# 准备 CSV 文件
cat > /tmp/tiles.csv << 'EOF'
id,body,recipe,ashSource,peakTemp,color,score
AG-002,粗陶坯,松灰45 长石30 石英20 高岭5,南山松灰,1240,青灰,78
AG-003,细瓷坯,稻灰40 长石40 石英18 红土2,东北稻灰,1260,月白,85
AG-001,粗陶坯,已存在记录,xxx,1200,xx,60
EOF

# 通过 -F file=@路径 上传
curl -X POST http://localhost:3033/import/preview \
  -F "file=@/tmp/tiles.csv"
```

JSON 文件同理：

```bash
curl -X POST http://localhost:3033/import/preview \
  -F "file=@/tmp/tiles.json"
```

> 字段名约定为 `file`。通过文件名后缀 `.csv` / `.json` 自动判定格式，无需额外设置 Content-Type。

#### 方式 B：Raw Body 直接提交 CSV

```bash
curl -X POST http://localhost:3033/import/preview \
  -H "Content-Type: text/csv" \
  -d 'id,body,recipe,ashSource,peakTemp,color,score
AG-002,粗陶坯,松灰45 长石30 石英20 高岭5,南山松灰,1240,青灰,78
AG-003,细瓷坯,稻灰40 长石40 石英18 红土2,东北稻灰,1260,月白,85
AG-001,粗陶坯,已有id记录,xxx,1200,xx,60'
```

#### 方式 C：Raw Body 直接提交 JSON

```bash
curl -X POST http://localhost:3033/import/preview \
  -H "Content-Type: application/json" \
  -d '[
    {"id":"AG-004","body":"粗陶坯","recipe":"竹灰42 长石35 石英18 红土5","ashSource":"莫干山竹灰","peakTemp":1235,"color":"灰青","score":80},
    {"id":"AG-005","body":"细瓷坯","recipe":"木灰50 长石30 石英18 高岭2","ashSource":"果木灰","peakTemp":1250,"color":"乳白","score":88},
    {"id":"AG-001","body":"粗陶坯","recipe":"已存在的id","ashSource":"xx","peakTemp":1200,"color":"","score":0}
  ]'
```

#### 预览返回字段说明

```jsonc
{
  "format": "csv",
  "source": { "type": "file", "name": "tiles.csv" },  // raw 或 file
  "headers": {
    "recognized": ["id","body","recipe","ashSource","peakTemp","color","score"],
    "unrecognized": [],        // 未识别列名（警告，不阻断）
    "missingRequired": []      // 缺失必填列：id, body, recipe
  },
  "counts": {
    "totalRows": 3,
    "importableRows": 3,       // 校验通过、可导入的行数
    "errorRows": 0             // 含错误的行数
  },
  "duplicateIds": ["AG-001"],                     // 全部重复 id 汇总
  "duplicateWithinImport": [],                    // 本次导入文件内部重复的 id（属于错误，不会导入）
  "duplicateWithExisting": ["AG-001"],            // 与数据库已有记录重复的 id（属于警告，可导入时按策略处理）
  "errorSummary": [],
  "errors": [],
  "previewToken": "prev_1_17xxx",                 // 10 分钟内有效
  "previewRows": [ ... ]                          // 前 5 条可导入数据
}
```

> **关于重复 id 的修正说明**：
> - `duplicateWithinImport`（导入内部重复）：同一份提交数据里出现两次相同 id → 视为错误行，不进入 `importableRows`，必须先修正才能导入。
> - `duplicateWithExisting`（与现有重复）：提交数据里的 id 在 `data/ash-glaze.json` 中已存在 → **不是错误**，会计入 `importableRows`，真正写入时根据 `duplicateStrategy` 决定是跳过（`skip`）还是覆盖（`overwrite`）。

---

### 2. 步骤二：确认写入数据库

拿到 `previewToken` 后，调用 `/import/commit` 正式写入 `data/ash-glaze.json`：

```bash
curl -X POST http://localhost:3033/import/commit \
  -H "Content-Type: application/json" \
  -d '{
    "previewToken": "prev_1_17xxxxxxxxx",
    "confirm": true,
    "duplicateStrategy": "skip"
  }'
```

#### 参数说明

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `previewToken` | string | ✅ | 预览接口返回的 token，10 分钟内有效 |
| `confirm` | boolean | ✅ | 必须显式设为 `true` 才会真正写入 |
| `duplicateStrategy` | string | - | 与数据库已有 id 重复时的处理策略：<br>`skip`（默认）重复 id 全部跳过，不修改已有记录<br>`overwrite` 删除数据库中同 id 旧记录后写入新记录 |

#### 写入成功返回

```json
{
  "insertedCount": 2,
  "skippedCount": 1,
  "overwrittenCount": 0,
  "insertedIds": ["AG-002", "AG-003"],
  "skippedIds": ["AG-001"],
  "overwrittenIds": []
}
```

> 若使用 `duplicateStrategy: "overwrite"`，被替换的 id 会出现在 `overwrittenIds` 和 `overwrittenCount` 中，`insertedIds` 同样包含这些被覆盖后重新写入的 id。

---

## 字段定义

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | ✅ | 试片唯一编号，重复会被跳过或覆盖 |
| body | string | ✅ | 坯体类型 |
| recipe | string | ✅ | 釉方配方 |
| ashSource | string | - | 灰来源 |
| glazeThickness | string | - | 施釉厚度 |
| kiln | string | - | 窑位/窑号 |
| firingCurve | array | - | 烧成曲线 `[{temp, minutes}]` |
| peakTemp | number | - | 烧成最高温度 |
| color | string | - | 釉色 |
| defects | string | - | 缺陷描述 |
| score | number | - | 评分 0-100 |
| observations | array | - | 观察记录 `[{at, note}]` |

> **CSV 提示**：`firingCurve`、`observations` 等数组字段在 CSV 中请以 JSON 字符串表示，并用双引号包裹，例如 `"[{""temp"":900,""minutes"":60}]"`。
