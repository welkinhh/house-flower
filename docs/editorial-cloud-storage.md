# 编辑图片云存储

## 当前资源

- CloudBase 环境：`huasheng-d1gevhc4b9cc370ca`
- 私有云存储目录：`editorial/`
- 已上传 60 张高清 JPEG 和 1 份资源清单，总图片体积约 10.97 MiB。
- 云存储权限维持现有私有读写规则；没有开放匿名读取。
- `cloudfunctions/flowerBackend/editorial-assets.json` 保存图片 key 到 CloudBase fileID 的白名单。

## 运行方式

1. 小程序启动后调用 `get-editorial-asset-urls`，后端仅接受 `editorial-assets.json` 白名单里的 key。
2. 后端使用 CloudBase `getTempFileURL` 为图片生成 1 小时有效的临时链接。
3. 小程序把链接缓存 55 分钟，首页、灵感卡片、案例详情和空间模板都使用高清云图；卡片在滚动到附近时再加载图片。
4. 案例图片作为 AI 输入时，先下载到小程序临时目录，再沿用现有的用户私有素材上传流程。

前端只接收后端签发的临时链接，不能提交任意 fileID 读取其他对象。临时链接在有效期内可直接访问，因此只在小程序内存和带过期时间的本地缓存中使用，不作为长期地址写入作品记录。

## 增加或替换案例图片

1. 把源图放进 `flower-assets/editorial/source/`，并更新 `scripts/build-editorial-cloud-assets.mjs` 中的素材清单。
2. 运行 `npm run assets:cloud` 生成 `flower-assets/editorial/cloud-ready/` 下的 JPEG 与 `asset-manifest.json`。
3. 将 `cloud-ready/` 文件上传到同一环境的 `editorial/` 目录，保持原文件名。
4. 运行 `npm run assets:miniprogram` 重建映射；`storage-prefix.json` 中保存的是当前环境的非密钥 fileID 前缀。如果新增灵感案例，还要更新页面中的标题、分类和描述。
5. 部署 `flowerBackend`；新增图片不再增加小程序包体积。

替换已有文件时保留原文件名和 key，后端 mapping 无需变化；发布前需确认新图片及其授权信息。

## 图片规格

- 首页主图：1448×1086 px，JPEG 质量 88。
- 案例参考图与花束图：源图单幅 768×1024 px，JPEG 质量 86；其他单图最长边最高 1600 px。
- 花材清单的小图仍保留在 `assets/materials-ui/`，最长边 192×288 px，显示尺寸约 48×58 CSS px。
- 案例详情和列表均读高清版本；本地不再打包编辑案例图或高清分包。

`flowerBackend` 高清图片接口已部署并保持 Active。小程序代码已在本地构建通过；还需在微信开发者工具重新编译预览或上传新版本后，客户端才会使用云端图片。
