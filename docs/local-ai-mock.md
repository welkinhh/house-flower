# House花生 · 当前能力记录

更新：2026-09-30。此文记录新版页面、当前 AI 调用方式和部署依赖。

## 页面与本地数据

- 小程序入口仍在 miniprogram/pages/flower/index。
- 首页三个入口：拾光成花、识花成笺、花映生活；底部导航：首页、灵感、作品。
- 自定义花束画布已移除。花束生成、照片识花、场景融合为独立流程。
- 作品集、重要日子和花历目前保存在本机。旧版 flower.works 与下载清单会在首次打开时迁移。
- 新增卧室和玄关两张场景原图，WebP 资源由 scripts/build-editorial-assets.py 压缩，十张展示图片合计约 0.66 MiB。

## AI 流程

- 拾光成花、识花和场景融合统一提交 `flowerBackend.create-task`，由 `flowerTaskWorker` 调用服务端模型并转存结果。
- 三条 AI 流程现在通过 CloudBase 持久任务执行；每日 10 次额度由服务端按北京时间管理，前端只展示服务端余额。

## 部署要求

CloudBase 环境 ID 保存在 miniprogram/utils/cloud-env.ts。小程序启动时会尝试初始化后端身份和额度查询；AI 任务仅在服务端资源开关启用后执行。

需要将 cloudfunctions/flowerBackend、flowerTaskWorker 和 houseflowerMaintenance 部署到该环境。worker 使用 wx-server-sdk 与 @cloudbase/node-sdk；模型资源及账号权限仍需在实际调用中确认。函数未部署或模型不可用时，页面保留所选图片并显示失败状态，不返回固定模拟结果。

生成作品同时记录 CloudBase fileID 和本地持久化图片路径，临时预览 URL 过期后，作品列表仍可以从本地查看。

