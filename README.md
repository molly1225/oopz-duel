# 咱俩练练活动页 — README(给接手的 AI / 工程师)

零依赖原生 HTML/JS 活动页。`dist/` 即源码,无构建步骤。本文件是唯一需要先读的文档;需求与接口清单见 [需求与接口联调文档.md](需求与接口联调文档.md)。最后更新:2026-09-22。

## 运行与部署

```sh
npm run dev -- --port 5173        # = node server.js --port 5173
# 打开 http://localhost:5173
```

- `server.js` 以 `dist/` 为根的静态服务器 + `POST /api/feishu`(飞书同步)。Node ≥ 18,无 npm 依赖。
- **内网(同事用)**:http://192.168.0.105:4318/ —— Molly 公司电脑常驻 `server.js --host 0.0.0.0 --port 4318`,已注册开机自启;`启动活动页.vbs` / `停止活动页.cmd` 手动控制。WLAN 是 DHCP,同事打不开先 `ipconfig` 看 IP 是否变了。
- **公网演示**:https://molly1225.github.io/oopz-duel/(GitHub Pages,仓库 `molly1225/oopz-duel`,根 `index.html` 跳转 `dist/`)。改完跑 `python _deploy_github.py` 全量覆盖推送(令牌读 `github-token.txt`;HTTP 走 curl,不要用 urllib —— 本机 Python 直连 GitHub 会被断流)。
- 纯静态托管只发 `dist/` 即可,`/api/feishu` 会静默失败,不影响页面。

## 文件地图

| 文件 | 作用 |
| --- | --- |
| `dist/index.html` | 页面结构;静态资源引用带 `?v=日期` 版本号,**每次改动必须递增**,否则手机端缓存旧文件 |
| `dist/style.css` | 全部样式,追加式维护(后面覆盖前面) |
| `dist/app.js` | 全部交互逻辑(半压缩长行) |
| `dist/asset-config.js` | 图片路径配置 |
| `dist/assets/` | 图片与本地二维码库 |
| `server.js` / `feishu-config.json` | 静态服务 + 飞书配置(**密钥勿外泄、勿进仓库**) |
| `_deploy_github.py` / `github-token.txt` | GitHub Pages 部署脚本与令牌(本地) |
| `启动活动页.vbs` / `停止活动页.cmd` | 内网站点启停 |

## 关键代码位置(dist/app.js)

- `ME` / `FRIEND`(第 4 行):演示身份,**接后端登录后替换数据来源**,其余不动。
- `records` + `persist()`(第 5、9 行):战绩存 localStorage(`oopz-duel-demo-v1`),接服务端时替换。
- `shareUrl()`(第 13 行):邀请链接 `?record={id}&view=friend`。
- `syncFeishu()`(第 26 行):确认后静默 POST `/api/feishu`,用户无感知。
- `recordForm()`(第 30 行):战绩表单。比赛时间默认当前时刻、无范围限制;凭证 2 张必填。
- `friendForm()`(第 32 行):对手确认;留空大名取昵称、留空留言随机。
- `makePoster()`(第 42 行):Canvas 生成战书/认证书,纯本地;图片启动时预解码(`imagesReady`),不要改回每次生成时解码。
- 初始化(第 53 行):`scrollRestoration='manual'` + 清 hash + 回顶部,刷新不锚定榜单。

## 已定稿的产品行为(不要轻易改)

1. UI 不写规则性文案:留空默认昵称、留空随机留言保留行为但不解释。
2. 凭证上传:仅「选择文件」唤起选择器;桌面端框可聚焦 Ctrl+V 粘贴、可拖拽,框内写「或拖拽上传」;移动端框不可点、隐藏拖拽文案;✕ 删除;JPG/PNG/WebP ≤ 9.5MB;失败 toast 只说「上传失败」;缺图提交红框;框右上角灰色小字 `*必填`。
3. 示例图:桌面 hover,移动 tap;移动端弹层 `position:fixed` 居中、**显式 `width:92vw`**(不给宽度 iOS 会缩成小点);点空白关闭;触屏禁用 `:hover` 触发。
4. toast 两个元素(`#toast` / `#toast-modal`),页面居中黑底微透 0.8s。
5. 弹窗:打开时锁背景滚动、焦点在弹窗本体(不选 ✕)、`overflow-x:hidden`、`overscroll-behavior:contain`。
6. 战绩列表最多 3 行滚动;排行榜最多 50 条、可见 7 行容器内滚动、表头吸顶;顶部导航 sticky。
7. 保存海报:移动端走系统分享面板(可存相册),桌面端下载 PNG;认证书按钮上方文案「保存战绩认证发布到抖音,即可领取7天无限公民会员。」。

## 已踩过的坑(改代码前必读)

1. CSS 自定义 display 覆盖 `hidden` 属性 → 补 `选择器[hidden]{display:none}`。
2. 特异性战争:`.proof-item span{display:block}`(0,1,1) 会压过媒体查询里的单类选择器(0,1,0) —— 移动端覆盖要用 `.proof-item span.xxx` 同级或更高特异性。
3. iOS:`position:fixed` 弹层必须给显式宽度;datetime-local 有固有宽度,需 `min-width:0` + `appearance:none`;`:hover` 在触屏上会粘住。
4. 无头 Edge 最小窗口宽度 518px,设 390 会右侧裁切;外网字体用 `--host-resolver-rules="MAP fonts.googleapis.com 127.0.0.1, MAP fonts.gstatic.com 127.0.0.1"` 屏蔽防卡死。
5. GitHub Pages 静态资源有约 10 分钟缓存 —— 靠 `?v=` 版本号破。

## 验证套路(无头实测,勿只做语法检查)

```sh
node --check dist/app.js && node --check server.js
node server.js --port 8901
# 复制 dist/index.html 为 dist/test-x.html,尾部注入自动打开目标弹窗的 <script>:
"/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless --disable-gpu \
  --user-data-dir=/tmp/edge-test \
  --host-resolver-rules="MAP fonts.googleapis.com 127.0.0.1, MAP fonts.gstatic.com 127.0.0.1" \
  --screenshot=绝对路径.png --window-size=518,1400 --hide-scrollbars \
  --virtual-time-budget=8000 "http://localhost:8901/test-x.html"
# 瞬时状态(toast/计算样式)用 --dump-dom 抓文本;把结果写进 document.title 再 grep
# 验证完必须:删 dist/test-x.html、杀 8901 端口进程
```

## 飞书同步

- 已配通(2026-09-22):`feishu-config.json` → tenant_access_token(缓存)→ 写多维表格一条记录。
- 表字段:`UID/PID/VID/用户昵称/接受者用户昵称/接受者UID/接受者PID/接受者VID/比赛时间(ms)/发起方比分/对手比分/提交时间(ms)` + 附件字段 `开黑图`、`游戏结算图`(type 17);各类 ID 留空,等后端登录态。
- 凭证图链路:前端 base64(≤1000px JPEG)随战绩 POST → `server.js` 调 `drive/v1/medias/upload_all`(parent_type=`bitable_image`)换 file_token → 写入附件字段;字段不存在会自动创建(已实测,2026-09-22)。请求体上限已放宽到 25MB。
- 未配置时返回 `not_configured`,页面无感知。

## 待办(正式接入清单)

1. Oopz 真实登录 → 替换 `ME`/`FRIEND`;
2. 服务端战绩存储 + 跨设备邀请查询;
3. 确认权限、服务端锁定、并发处理;
4. 服务端计分与真实榜单;
5. 凭证图上传对象存储(现为 base64 存 localStorage);
6. 抖音 7 天无限公民会员:纯运营发放,无开发量(页面只有权益文案);
7. 铭牌发放(平台侧,页面无依赖)。

详见 [需求与接口联调文档.md](需求与接口联调文档.md) 第 4 节接口表。
