# 咱俩练练活动页 — README(给接手的 AI / 工程师)

零依赖原生 HTML/JS 活动页。`dist/` 即源码,无构建步骤。本文件是唯一需要先读的文档;需求与接口清单见 [需求与接口联调文档.md](需求与接口联调文档.md)。最后更新:2026-09-23。

## 运行与部署

```sh
npm run dev -- --port 5173        # = node server.js --port 5173
# 打开 http://localhost:5173
```

- `server.js` 以 `dist/` 为根的静态服务器 + 飞书接口组(战绩/确认/榜单/凭证图代理)。Node ≥ 18,无 npm 依赖。
- **内网(同事用)**:http://192.168.0.105:4318/ —— Molly 公司电脑常驻 `server.js --host 0.0.0.0 --port 4318`,已注册开机自启;`启动活动页.vbs` / `停止活动页.cmd` 手动控制。WLAN 是 DHCP,同事打不开先 `ipconfig` 看 IP 是否变了。
- **公网演示**:https://molly1225.github.io/oopz-duel/(GitHub Pages,仓库 `molly1225/oopz-duel`,根 `index.html` 跳转 `dist/`)。改完跑 `python _deploy_github.py` 全量覆盖推送(令牌读 `github-token.txt`;HTTP 走 curl,不要用 urllib —— 本机 Python 直连 GitHub 会被断流)。
- 纯静态托管只发 `dist/` 即可:所有 `/api/*` 静默失败,前端自动回退 localStorage 单机演示,页面不报错。

## 文件地图

| 文件 | 作用 |
| --- | --- |
| `dist/index.html` | 页面结构;静态资源引用带 `?v=日期` 版本号,**每次改动必须递增**,否则手机端缓存旧文件 |
| `dist/style.css` | 全部样式,追加式维护(后面覆盖前面) |
| `dist/app.js` | 全部交互逻辑(半压缩长行) |
| `dist/asset-config.js` | 图片路径配置 |
| `dist/assets/` | 图片与本地二维码库 |
| `server.js` / `feishu-config.json` | 静态服务 + 飞书战绩库/榜单(**密钥勿外泄、勿进仓库**) |
| `_deploy_github.py` / `github-token.txt` | GitHub Pages 部署脚本与令牌(本地) |
| `启动活动页.vbs` / `停止活动页.cmd` | 内网站点启停 |

## 后端架构:飞书表即数据库(2026-09-23 起)

不落任何数据库,`server.js` 直接读写飞书多维表格:

| 接口 | 说明 |
| --- | --- |
| `POST /api/records` | 创建/更新战绩(以「记录ID」为键;已确认拒绝 `already_confirmed`)。含两张凭证图上传飞书附件字段 |
| `GET /api/records?id=` | 按记录ID查战绩(邀请链接跨设备打开) |
| `POST /api/records/confirm` | 确认:写接受者大名/留言、状态→已确认、提交时间;重复确认拒绝 |
| `GET /api/media/:token` | 凭证图代理(飞书素材需鉴权) |
| `GET /api/leaderboard` | 榜单:读全表计分,**只计已确认**,30s 缓存,确认后缓存失效 |

- 表字段:文本 `记录ID/UID/PID/VID/用户昵称/接受者用户昵称/接受者UID/接受者PID/接受者VID/发起方留言/接受者留言/状态` + 日期(ms) `比赛时间/提交时间` + 数字 `发起方比分/对手比分` + 附件 `开黑图/游戏结算图`。缺字段服务端自动创建(`ensureRecordFields`)。
- 凭证图:前端 base64(≤1000px JPEG)随战绩 POST → `drive/v1/medias/upload_all`(parent_type=`bitable_image`)换 file_token → 附件字段。请求体上限 25MB。
- 已端到端实测(2026-09-23):创建→跨设备查询→图片代理→确认→榜单计分→重复确认/确认后修改拦截,全通过。
- ⚠️ **上线前待做:身份校验**。当前写接口无鉴权(内网够用,公网不行)。正式环境前端传 Oopz 登录态,server 验签后把真实 uid/pid/vid 写入表格。等技术给身份接口文档。

## 关键代码位置(dist/app.js)

- `ME` / `FRIEND`(第 4 行):演示身份,**接后端登录后替换数据来源**,其余不动。
- `records` + `persist()`(第 5、9 行):战绩本地缓存(localStorage `oopz-duel-demo-v1`),远端为准,本地用于海报生成和演示回退。
- `shareUrl()`(第 13 行):邀请链接 `?record={id}&view=friend`。
- `saveRemote()`(约第 27 行):保存战绩后静默 POST `/api/records`,失败无感知。
- `proofsHtml()`(约第 25 行):凭证图展示,本地 dataURL 与远端 `/api/media/:token` 双源。
- `recordForm()`(约第 34 行):战绩表单。比赛时间默认当前时刻、无范围限制;凭证 2 张必填;提交后 `saveRemote`。
- `friendForm()`(约第 37 行):对手确认。**本地查不到就 fetch 远端**(跨设备);已确认的链接直接生成认证书;确认 POST `/api/records/confirm`,远端失败且纯远端记录则阻止。留空大名取昵称、留空留言随机。
- `loadBoard()`(约第 16 行):拉 `/api/leaderboard`,成功则用真实榜单,失败回退演示数据。
- `makePoster()`:Canvas 生成战书/认证书,纯本地;图片启动时预解码(`imagesReady`),不要改回每次生成时解码。
- 初始化(文件尾部):`scrollRestoration='manual'` + 清 hash + 回顶部,刷新不锚定榜单;`?record=` 参数自动打开好友确认。

## 已定稿的产品行为(不要轻易改)

1. UI 不写规则性文案:留空默认昵称、留空随机留言保留行为但不解释。
2. 凭证上传:仅「选择文件」唤起选择器;桌面端框可聚焦 Ctrl+V 粘贴、可拖拽,框内写「或拖拽上传」;移动端框不可点、隐藏拖拽文案;✕ 删除;JPG/PNG/WebP ≤ 9.5MB;失败 toast 只说「上传失败」;缺图提交红框;框右上角灰色小字 `*必填`。
3. 示例图入口在说明小字行(绿色 11px);桌面 hover、移动 tap 均为视口居中浮层;移动端开黑示例用竖屏专用图 `proof-example-voice-mobile.webp`(`recordForm` 里按 `(max-width:700px)` 切换);弹层图必须 `object-fit:contain` + `max-height`,竖屏截图才不会被裁;点空白关闭。
4. toast 两个元素(`#toast` / `#toast-modal`),页面居中黑底微透 0.8s。
5. 弹窗:打开时锁背景滚动、焦点在弹窗本体(不选 ✕)、`overflow-x:hidden`、`overscroll-behavior:contain`。
6. 战绩列表最多 3 行滚动;排行榜最多 50 条、可见 7 行容器内滚动、表头吸顶;顶部导航 sticky。
7. 保存海报:移动端走系统分享面板(可存相册),桌面端下载 PNG;认证书按钮上方文案「保存图片分享到抖音,领 **无限公民会员*7天**,活动详情(绿色下划线链接 https://oopz.cn/i/TakELZ)」。
8. 邀请弹窗只有「复制邀请链接」一个按钮(无切换视角)。

## 已踩过的坑(改代码前必读)

1. CSS 自定义 display 覆盖 `hidden` 属性 → 补 `选择器[hidden]{display:none}`。
2. 特异性战争:`.proof-item span{display:block}`(0,1,1) 会压过媒体查询里的单类选择器(0,1,0) —— 移动端覆盖要用 `.proof-item span.xxx` 同级或更高特异性。
3. iOS:`position:fixed` 弹层必须给显式宽度;datetime-local 有固有宽度,需 `min-width:0` + `appearance:none`;**`:hover` 在触屏上点击会粘住,会把 JS 点开的 `.show` 弹层盖掉 —— 必须补 `@media(hover:none){.proof-example.show:hover .example-pop{display:block}}`**。
4. 无头 Edge 最小窗口宽度 518px,设 390 会右侧裁切;外网字体用 `--host-resolver-rules="MAP fonts.googleapis.com 127.0.0.1, MAP fonts.gstatic.com 127.0.0.1"` 屏蔽防卡死;`--virtual-time-budget` 过大可能挂起,截图分开跑、加 `timeout`。
5. GitHub Pages 静态资源有约 10 分钟缓存 —— 靠 `?v=` 版本号破。
6. 复制兜底:`showModal` 后 `document.body` 是 inert,execCommand 复制的 textarea **必须挂进 modal 元素内**,否则返回 true 但剪贴板为空;`navigator.clipboard.writeText` 在 HTTP/无权限环境可能挂起,需 `Promise.race` 加 800ms 超时再降级。

## 验证套路(无头实测,勿只做语法检查)

```sh
node --check dist/app.js && node --check server.js
# 复制 dist/index.html 为 dist/test-x.html,尾部注入自动打开目标弹窗的 <script>:
"/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless --disable-gpu \
  --user-data-dir=/tmp/edge-test \
  --host-resolver-rules="MAP fonts.googleapis.com 127.0.0.1, MAP fonts.gstatic.com 127.0.0.1" \
  --screenshot=绝对路径.png --window-size=518,1400 --hide-scrollbars \
  --virtual-time-budget=8000 "http://localhost:4318/test-x.html"
# 瞬时状态(toast/计算样式)用 --dump-dom 抓文本;把结果写进 document.title 再 grep
# 验证完必须:删 dist/test-x.html、删截图
# 接口链路用脚本打 http://localhost:4318/api/* 实测,测试记录写完删(参考 git 历史中的 _test_*.js)
```

## 待办(正式接入清单)

1. **Oopz 身份接口(唯一待办)**:替换 `ME`/`FRIEND`;server.js 写接口加登录态校验,真实 uid/pid/vid 入表;
2. 战绩/榜单/凭证图:已由飞书表承接(见上),后端可保留或重写替换;
3. 抖音 7 天无限公民会员:纯运营发放,无开发量(页面只有权益文案);
4. 铭牌发放(平台侧,页面无依赖)。

详见 [需求与接口联调文档.md](需求与接口联调文档.md) 第 4 节接口表。
