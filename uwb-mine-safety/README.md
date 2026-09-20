# 井下人员定位安全系统

基于 UWB（超宽带）精确定位的井下人员安全系统：实时接入人员坐标，**闯入危险区域**或**长时间静止**时自动产生分级告警，并**联动分区广播**（IP 网络音箱 TTS）喊话；同时支持标签 SOS、低电量、离线检测、超时未确认升级、轨迹回放与调度大屏。

详细设计见 [`docs/设计文档.md`](docs/设计文档.md)。

技术栈：Node.js 20 + TypeScript + Express + Prisma + PostgreSQL + WebSocket；Vue 3 + Vite + Element Plus + Pinia；Vitest。

## 功能总览

| 能力 | 说明 |
| --- | --- |
| UWB 定位接入 | `POST /api/v1/positions/ingest`，设备 Key 鉴权，1Hz 批量（≤500 点/批），坐标 `(x,y,z,电量,SOS,测量时间)` |
| 电子围栏 | 多边形区域（射线法判定，边界算进入）+ 所在水平 z 校验；红区 critical / 黄区 warning；界面上点图绘制 |
| 长时间静止 | 锚点簇算法抗 UWB 抖动；3m 半径内持续 120s（可调）→ warning，人员状态置 stationary |
| 自动联动广播 | 闯入/静止/SOS 按区域音箱分组 TTS 播报；低电量/离线只提示不占频道；全程留痕、失败可重发 |
| 告警生命周期 | 待确认 →（调度确认）处置中 →（现场核实）解除；离开区域/恢复移动/重新上线自动解除；SOS 必须人工关闭 |
| 去重与升级 | 同键未决告警数据库唯一索引兜底，抑制窗口内只累加次数；warning 超时未确认升级 critical 并全矿提醒 |
| 其他检测 | 标签 SOS 一键求救、低电量（5% 迟滞）、超时离线 |
| 调度大屏 | SVG 矿图实时人员位置、围栏、实时告警流、人数/班组统计、WebSocket 推送、快捷广播 |
| 轨迹回放 | 人员最近 15 分钟～2 小时轨迹叠加围栏展示，附带近期告警时间线 |
| RBAC | admin（配置/处置）、dispatcher（确认/解除/广播）、viewer（只读大屏） |

## 快速开始

需要 Node.js ≥ 20；使用 Docker 起 PostgreSQL，或用内置的内存数据库模式（零依赖演示）。

### 方式 A：Docker 一键启动（推荐，真实 PostgreSQL）

```bash
cp .env.example .env
docker compose up -d --build
# 前端 http://localhost:8080 ，API http://localhost:3000
```

容器启动时自动执行迁移与种子数据。演示账号 `admin` / `dispatcher` / `viewer`，密码均为 `admin123`。

### 方式 B：本地开发

```bash
# 1. 起数据库（任选）
docker compose up -d postgres

cp .env.example .env
cd backend
npm install
npx prisma migrate deploy
npm run seed          # 打印账号信息，创建固定设备 Key

npm run dev           # 终端 A：API + WebSocket（:3000）
npm run dev:worker    # 终端 B：离线检测 / 围栏对账 / 告警升级扫描

# 终端 C：前端
cd ../frontend && npm install && npm run dev   # http://localhost:5173
```

### 方式 C：没有 Docker？内存数据库演示模式

后端用 PGlite（WASM 版真实 PostgreSQL）跑迁移与种子，无需任何外部服务：

```bash
cd backend && npm install
npm run dev:pglite    # 起 API+WS+worker（:3000），数据仅存内存
# 另开终端：
npm run simulate      # 1Hz 推送 12 个模拟人员，编排闯入/静止/SOS/低电量场景
```

## 对接真实 UWB 定位引擎

定位引擎/网关以 1Hz 批量 POST 坐标，Header 携带管理后台签发的设备凭证：

```bash
curl -X POST http://localhost:3000/api/v1/positions/ingest \
  -H 'content-type: application/json' \
  -H 'x-ingest-key: <后台「接入凭证」处生成>' \
  -d '{
    "positions": [
      { "tagId": "TAG-001", "x": 350.2, "y": 120.7, "z": 0, "batteryPct": 82, "measuredAt": 1726000000000 },
      { "tagId": "TAG-002", "x": 351.0, "y": 119.8, "z": 0, "sos": false }
    ]
  }'
```

返回 `{ ok, accepted, rejected, alarmsFired }`。未登记标签进 `rejected` 且**不落库**；测量时间在未来（时钟漂移）也会被拒绝。

### 对接矿上广播主机

默认 `BROADCAST_DRIVER=console`（喊话内容写日志，便于演示与无硬件调试）。生产设置：

```
BROADCAST_DRIVER=webhook
BROADCAST_WEBHOOK_URL=http://广播主机地址/tts
```

系统会向其 POST `{ "group": "zone-001", "text": "警告：王大力（综采一队）已进入中央变电所，请立即撤离！" }`，2xx 视为已下发；失败留痕并可在界面重发。每个区域可独立配置音箱分组与 TTS 模板（`{name}` `{team}` `{zone}` 占位符）。

## 验证

```bash
cd backend
npm run typecheck && npm test
cd ../frontend
npm run typecheck && npm run build
```

当前共 **39 个后端测试全部通过**，其中 21 个跑在真实 PostgreSQL（PGlite 执行真实迁移 SQL）上，覆盖：

- 几何：射线法（内/外/边界/凹多边形）、2D/3D 距离
- 静止：锚点簇抗抖动、先动后停、未满时长不误报
- 围栏：闯入告警+自动广播、重复抑制、离开自动解除、黄区级别、跨水平不告警、未登记标签拒绝
- 静止/SOS/低电量迟滞/离线恢复/超时升级（info 不升级）/并发去重唯一索引
- HTTP 端到端：登录、RBAC、422 校验、设备 Key、推送→告警→确认→解除→广播留痕

模拟器编排的真实链路已实际跑通（`dev:pglite` + `simulate`）：闯变电所 17s 告警喊话、采空区静止 38s 告警、60s SOS、低电量提示、离开区域自动解除。

## 关键设计取舍

- **告警去重靠数据库部分唯一索引** `alarm_open_dedup_uniq`（同一 dedupKey 只允许一条 active/acked），并发批次冲突走 P2002 累加次数，而不是"先查后插"。
- **静止判定用锚点簇而非两点比较**：UWB 有 0.1~0.5m 抖动，逐点比较会把站立误判成移动。
- **规则状态在内存、事实在数据库**：进程重启后围栏靠 worker 周期对账收敛，静止最坏一个阈值周期重新检出；定位与告警记录永远落库可追责。
- **位置证据优先**：位置落库与告警写入解耦，告警/广播故障不影响位置数据入库。
- **广播噪音治理**：只有闯入/静止/SOS 自动喊话；同告警抑制窗口内不重复喊；低电量/离线仅调度台提示；info 不升级。
- **SOS 不可自动解除**，必须调度员核实后手工关闭。

## 目录

```
uwb-mine-safety/
├── backend/
│   ├── prisma/                 schema + 迁移（含手写部分唯一索引）
│   └── src/
│       ├── modules/            auth/persons/anchors/zones/positions/alarms/broadcasts/stats 路由
│       ├── services/
│       │   ├── geo/            多边形判定（纯函数）
│       │   ├── tracking/       静止锚点簇算法 + 阈值配置
│       │   ├── ingest/         定位入库 + 规则引擎主流水线
│       │   ├── alarm/          告警去重/升级/自动解除
│       │   ├── broadcast/      TTS 驱动（console/webhook）
│       │   └── realtime/       WebSocket 推送中心
│       ├── worker.ts           周期安全扫描进程
│       └── scripts/            seed / simulate / dev-pglite
├── frontend/                   Vue3：调度大屏、告警台、人员、围栏绘制、广播
└── docs/设计文档.md
```
