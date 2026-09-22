# 咱俩练练活动页 — README(给接手的 AI / 工程师)

零依赖原生 HTML/JS 活动页。`dist/` 即源码,无构建步骤。本文件是唯一需要先读的文档;需求与接口清单见 [需求与接口联调文档.md](需求与接口联调文档.md)。

## 运行

```sh
npm run dev -- --port 5173        # = node server.js --port 5173
# 打开 http://localhost:5173
```

- `server.js` 以 `dist/` 为根目录的静态服务器,另含 `POST /api/feishu`(飞书多维表格同步)。
- Node ≥ 18(用了全局 `fetch`)。没有任何 npm 依赖,不用 `npm install`。
- 只用静态托管时,直接发布 `dist/`;`/api/feishu` 会静默失败,不影响页面。

## 文件地图

| 文件 | 作用 |
| --- | --- |
| `dist/index.html` | 页面结构、固定文案、活动规则入口 |
| `dist/style.css` | 全部样式。追加式维护:同属性后面的规则覆盖前面的 |
| `dist/app.js` | 全部交互逻辑(半压缩长行,一行一个函数区域) |
| `dist/asset-config.js` | 图片路径配置(logo/hero/铭牌/头像/示例图) |
| `dist/assets/` | 图片与 `qrcode.js`(本地二维码库) |
| `server.js` | 静态服务 + 飞书同步接口 |
| `feishu-config.json` | 飞书应用凭证与表格 ID(**勿外泄,勿提交公开仓库**) |

## 关键代码位置(dist/app.js)

- `ME` / `FRIEND`(第 4 行):写死的演示身份。**接后端登录后替换这两个对象的数据来源**,其余逻辑不动。
- `records` + `persist()`(第 5、9 行):战绩存 localStorage,键 `oopz-duel-demo-v1`。接服务端战绩接口时替换这里。
- `shareUrl()`(第 13 行):邀请链接格式 `?record={id}&view=friend`。
- `syncFeishu()`(第 26 行):战绩确认后静默 POST `/api/feishu`,前端不提示。
- `recordForm()`(第 30 行):战绩表单(大名/时间/比分/留言/2 张凭证)。时间默认当前时刻。
- `friendForm()`(第 32 行):对手确认;留空大名取昵称、留空留言随机一句。
- `makePoster()`(第 40 行):Canvas 生成战书 900×1250 / 认证书 900×1280,纯本地,不调模型。
- `TAUNTS` / `MESSAGES`:狠话库与随机留言库。

## 已踩过的坑(改代码前必读)

1. **CSS 自定义 display 会覆盖 `hidden` 属性**:任何加 `hidden` 的元素若仍显示,补一条 `选择器[hidden]{display:none}`。已有先例:`.proof-preview-wrap[hidden]`、`.nameplate-image[hidden]`。
2. **toast 有两个元素**:页面级 `#toast` 与弹窗内 `#toast-modal`,`toast()` 按 `modal.open` 自动选目标。样式统一:页面居中、圆角黑底微透、0.8s 消失。新增提示直接调 `toast()`,不要自建。
3. **UI 不写规则性文案**:留空默认昵称、留空随机留言等行为要保留,但界面上不解释(产品要求)。
4. **凭证上传交互已定稿**:仅「选择文件」按钮唤起文件框;框可点选获焦后 Ctrl+V 粘贴;支持拖拽;红色 ✕ 删除;JPG/PNG/WebP ≤ 9.5MB;失败 toast 只说「上传失败」;缺图提交红框。不要轻易改这套交互。
5. **示例图**:PC 仅 hover 弹出,移动端点击;② 号示例弹层右对齐,不许超出弹窗。
6. **战绩列表**最多 3 行,超出滚动(`.match-list`)。
7. 战书/认证书海报上的演示字样已按产品要求去除,不要再加回。

## 验证套路(无头浏览器实测,勿只做语法检查)

```sh
node --check dist/app.js && node --check server.js
node server.js --port 8901          # 临时验证端口
# 复制 dist/index.html 为 dist/test-x.html,尾部注入自动打开目标弹窗的 <script>,
# 再用 Edge 无头截图:
"/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless --disable-gpu \
  --user-data-dir=/tmp/edge-test --screenshot=绝对路径.png --window-size=1000,1700 \
  --hide-scrollbars --virtual-time-budget=9000 "http://localhost:8901/test-x.html"
# 瞬时状态(toast)用 --dump-dom 抓文本。注意:虚拟时间过长会让 0.8s toast 消失。
# 验证完必须:删 dist/test-x.html、杀掉 8901 端口进程。
```

## 飞书同步

- 已配通并实测(2026-09-22):`server.js` 读 `feishu-config.json` → 换 tenant_access_token(带缓存)→ 写入多维表格一条记录。
- 表格字段:`UID / PID / VID / 用户昵称 / 接受者用户昵称 / 接受者UID / 接受者PID / 接受者VID / 比赛时间(ms 时间戳)/ 发起方比分 / 对手比分(数字)/ 提交时间(ms)`。
- 各类 ID 字段当前留空,等后端登录态接入后由前端随记录带上。
- 未配置 `feishu-config.json` 时接口返回 `not_configured`,页面无感知,安全。

## 待办(正式接入清单)

1. Oopz 真实登录 → 替换 `ME`/`FRIEND`;
2. 服务端战绩存储 + 跨设备邀请查询 → 替换 localStorage;
3. 确认权限、服务端锁定、并发处理;
4. 服务端计分与真实榜单;
5. 凭证图上传到对象存储(现为 base64 存 localStorage);
6. 铭牌发放(平台侧,页面无依赖)。

详见 [需求与接口联调文档.md](需求与接口联调文档.md) 第 4 节接口表。
