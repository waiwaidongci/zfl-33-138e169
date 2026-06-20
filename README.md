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

支持 **CSV** 和 **JSON** 两种格式，通过 `Content-Type` 自动识别，或按内容首字符推断。

#### 以 CSV 格式导入

```bash
curl -X POST http://localhost:3033/import/preview \
  -H "Content-Type: text/csv" \
  -d 'id,body,recipe,ashSource,peakTemp,color,score
AG-002,粗陶坯,松灰45 长石30 石英20 高岭5,南山松灰,1240,青灰,78
AG-003,细瓷坯,稻灰40 长石40 石英18 红土2,东北稻灰,1260,月白,85
AG-001,粗陶坯,已有重复id配方,xxx,1200,xx,60'
```

#### 以 JSON 格式导入

```bash
curl -X POST http://localhost:3033/import/preview \
  -H "Content-Type: application/json" \
  -d '[
    {"id":"AG-004","body":"粗陶坯","recipe":"竹灰42 长石35 石英18 红土5","ashSource":"莫干山竹灰","peakTemp":1235,"color":"灰青","score":80,"firingCurve":[{"temp":900,"minutes":60}]},
    {"id":"AG-005","body":"细瓷坯","recipe":"木灰50 长石30 石英18 高岭2","ashSource":"果木灰","peakTemp":1250,"color":"乳白","score":88},
    {"id":"AG-002","body":"粗陶坯","recipe":"xx","ashSource":"xx","peakTemp":1200,"color":"","score":0}
  ]'
```

#### 预览返回字段说明

```jsonc
{
  "format": "csv",           // 识别出的格式 csv/json
  "headers": {
    "recognized": ["id","body","recipe","ashSource","peakTemp","color","score"],
    "unrecognized": [],       // 无法识别的列名（警告但不阻断）
    "missingRequired": []     // 缺失的必填列：id, body, recipe
  },
  "counts": {
    "totalRows": 3,
    "importableRows": 2,      // 可正常导入的行数
    "errorRows": 1            // 含错误的行数
  },
  "duplicateIds": ["AG-001"], // 与现有数据或导入内部重复的id
  "errorSummary": [           // 错误类型汇总
    { "message": "与现有数据重复id:AG-001", "count": 1, "exampleLines": [] }
  ],
  "errors": [                 // 前20条错误明细
    { "line": 4, "id": "AG-001", "errors": ["与现有数据重复id:AG-001"] }
  ],
  "previewToken": "prev_1_17xxx",  // 10分钟内有效，用于确认导入
  "previewRows": [ ... ]      // 前5条可导入数据的预览
}
```

### 2. 步骤二：确认写入数据库

拿到 `previewToken` 后，调用 `/import/commit` 正式写入：

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
| `previewToken` | string | 是 | 预览接口返回的 token |
| `confirm` | boolean | 是 | 必须显式设为 `true` 确认写入 |
| `duplicateStrategy` | string | 否 | 重复 id 处理策略：`skip`(默认) 跳过，`overwrite` 覆盖 |

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
