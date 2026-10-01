# House花生 CloudBase 首批部署清单

环境 ID：`huasheng-d1gevhc4b9cc370ca`

本清单配合 `cloudfunctions/flowerBackend`、`cloudfunctions/flowerTaskWorker`、`houseflowerMaintenance` 和 `houseflowerNotification` 使用。当前 CloudBase 函数、集合、权限规则与 worker 定时触发器均已部署；这份文档记录实际配置和剩余的识花/客户端验收状态。

根目录的 `cloudbaserc.json` 用于 CloudBase CLI/VS Code 部署。2026-10-01 已只读核验当前环境：Hunyuan Inspire 计划的 Token 与生图额度有效，`hunyuan-image` 的图生图模型已启用；因此当前配置允许生图/场景融合。识花的视觉模型不在该免费计划已启用项中，`AI_VISION_ENABLED` 保持 `false`，以免误触额外计费。

## 云函数

部署以下函数，并确保函数环境与小程序环境一致：

| 函数 | 入口 | 用途 |
| --- | --- | --- |
| `flowerBackend` | `cloudfunctions/flowerBackend` | 用户、上传登记、额度、任务和作品查询 |
| `flowerTaskWorker` | `cloudfunctions/flowerTaskWorker` | 每分钟领取排队任务和补偿过期租约 |
| `houseflowerMaintenance` | `cloudfunctions/houseflowerMaintenance` | 删除账号资源、清理未完成上传 |
| `houseflowerNotification` | `cloudfunctions/houseflowerNotification` | 发送重要日子和 AI 完成订阅消息 |

`flowerTaskWorker/config.json` 已包含每分钟定时触发器。worker 使用 `AI_RESOURCES_ENABLED=true` 处理当前已开通的生图/场景资源；识花另由 `AI_VISION_ENABLED=false` 单独保护。只有用户确认开通一个有明确计价的视觉模型后，才将该视觉开关设为 `true` 并部署。

AI 只由 `flowerTaskWorker` 调用。全局 AI 资源开关关闭时，worker 会释放任务额度且不调用模型；视觉开关关闭时，backend 会在创建识花任务前拒绝请求，不上传照片、不预占额度。

## 数据库集合

以下 13 个集合已创建并设为 ADMINONLY，由云函数服务端读写：

- `users`
- `identities`
- `daily_quotas`
- `quota_ledger`
- `ai_tasks`
- `assets`
- `works`
- `recognitions`
- `important_dates`
- `asset_refs`
- `analytics_events`
- `subscription_records`
- `notification_jobs`

维护函数每小时清理已申请删除账号的作品、任务、额度流水、日期和云存储文件；清理超过 24 小时仍未完成的上传记录；并在 AI 任务完成 24 小时后清理未保存作品引用的任务输入图、场景垫图和生成结果图。保存到作品集、头像或其他任务仍在使用的图片会保留。其他超过 7 天且没有任何引用的孤儿资源也会清理。2026-10-01 已核验 `flowerBackend`、`flowerTaskWorker`、`houseflowerMaintenance` 均为 Active，维护触发器为每小时运行；本轮未手动调用维护函数。

作品和日期同步依赖 `works`、`important_dates` 的 owner 字段；AI 任务依赖 `assets` 的 `assetId/status/fileID` 字段。

建议索引：

| 集合 | 索引 |
| --- | --- |
| `identities` | `appId + openId` |
| `daily_quotas` | `userId + dateKey` |
| `quota_ledger` | `ownerId + createdAt`、`reservationId` |
| `ai_tasks` | `ownerId + idempotencyKey`、`status + nextRunAt`、`ownerId + createdAt` |
| `assets` | `ownerId + createdAt`、`ownerId + status` |
| `works` | `ownerId + updatedAt` |
| `important_dates` | `ownerId + date` |
| `analytics_events` | `createdAt`、`eventName + createdAt`、`ownerId + createdAt` |
| `subscription_records` | `ownerId + templateId` |
| `notification_jobs` | `status + dueAt`、`ownerId + createdAt` |

唯一约束必须由服务端幂等键和事务逻辑共同保证。控制台索引能力与套餐差异需要在实际环境确认，不能只依赖客户端去重。

## 存储目录

业务代码使用以下目录前缀：

- `users/<openid>/houseflower/private/inspiration/`（小程序直传输入）
- `users/<openid>/houseflower/private/recognition/`（小程序直传输入）
- `users/<openid>/houseflower/private/scene/`（小程序直传输入）
- `houseflower/private/<userId>/ai-output/`（worker 服务端输出）
- `houseflower/private/<userId>/work-cover/`
- `houseflower/private/<userId>/materials-export/`

旧版兼容函数仍可能产生 `flower-ai/input/<safeOpenId>/` 和 `flower-ai/output/<safeOpenId>/`，待线上任务链路稳定后再清理，不作为新任务的主路径。

用户目录默认私有。客户端不能自行指定目录；上传路径只能由 `flowerBackend.prepare-upload` 返回。

数据库建议先关闭小程序端对业务集合的直接读写，统一通过云函数访问；云存储只允许已登录用户向 `users/<openid>/houseflower/private/` 自己的目录上传，读取通过 `get-asset-urls` 返回短期地址，删除由服务端执行。上传登记时，服务端会核对实际字节数并拒绝、删除超过 10 MB 的文件。不要给小程序端开放任意路径写入或全桶读取。

运营和订阅需要在函数环境变量中配置：

- `ADMIN_OPENIDS`：允许查看运营数据的微信 OpenID，逗号分隔。
- `SUBSCRIBE_TEMPLATE_DATE`：重要日子提醒模板 ID。
- `SUBSCRIBE_TEMPLATE_TASK`：AI 任务完成模板 ID。
- `SUBSCRIBE_FIELD_MAP_JSON`：模板字段映射，例如 `{"important_date":{"thing1":"title","time2":"date","phrase3":"note"},"ai_task":{"thing1":"title","phrase3":"note"}}`。

模板 ID 和字段必须与微信公众平台实际模板一致，否则发送会失败；代码不会把模板字段写死成平台保证可用的格式。

## 2026-10-01 实际联调状态

- 已在 `huasheng-d1gevhc4b9cc370ca` 部署 4 个事件云函数并确认 Active，`flowerTaskWorker` 定时触发器已恢复。
- 已创建文档库所需 13 个集合；集合权限为 ADMINONLY，业务读写只经过云函数。
- 云存储权限为自定义规则：仅登录用户可写 `users/<openid>/...` 本人目录，客户端不可直读，结果图片通过后端临时 URL 返回。桶规则不再检查文件大小（该条件在小程序上传时持续误拒绝）；小程序上传前及 `flowerBackend.complete-upload` 都限制 10 MB，服务端超限时删除对象并拒绝登记。直接绕过小程序工作流的上传没有桶级大小上限，需避免把此规则用于公开生产流量或后续改用受限签名上传。
- `AI_RESOURCES_ENABLED=true` 使用当前 Hunyuan Inspire 免费生图额度；Hunyuan I2I 模型已完成真实调用测试，任务与额度均成功结算。
- `AI_VISION_ENABLED=false`。当前免费计划不包含已配置的视觉识花模型；用户选择“免费先用”，所以识花照片会在本地提示模型未启用，不上传、不预占次数，也不会调用付费模型。
- 花入空间使用同一 I2I Worker，但尚未单独用场景合成图做真实模型验收；须在微信客户端登录后再验证真实相册上传、场景合成和权限规则。

前端使用 `flowerBackend.create-task` 创建持久任务；worker 领取任务、生成结果并写回素材与额度账本。端到端生图用的是项目内置示例图，测试数据已经清理。

不要把 Publishable Key、SecretId、SecretKey 或自建 API Key 写入小程序源码、数据库文档或聊天记录。需要的服务端凭据配置在 CloudBase 受保护的环境变量中。

## 第一批联调验收

- 两个测试微信身份各自初始化成功，互相不能读取作品和素材。
- 每个用户首次当天看到 `10/10`；完成成功任务后变为 `9/10`。
- 失败任务释放预占；跨北京时间 00:00 创建新额度记录。
- 同一个 `idempotencyKey` 重复提交只得到同一个任务。
- worker 关闭 AI 开关时任务失败并返还额度，不生成演示结果。
- 关闭小程序后重新进入，可以查询本人未完成任务。
