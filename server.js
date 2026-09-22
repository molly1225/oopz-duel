// 零依赖静态服务器：以 dist 为根目录，支持 --host / --port 参数转发
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf('--' + name);
  if (i !== -1 && args[i + 1]) return args[i + 1];
  const eq = args.find(a => a.startsWith('--' + name + '='));
  return eq ? eq.split('=')[1] : fallback;
}
const HOST = arg('host', '::'); // 默认双栈监听，IPv4/IPv6 均可访问
const PORT = Number(arg('port', 5173));
const ROOT = path.join(__dirname, 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ai': 'application/postscript'
};

// ---- 飞书多维表格同步（可选，配置 feishu-config.json 后启用）----
let feishuConfig = null;
try { feishuConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'feishu-config.json'), 'utf8')); } catch {}
let feishuToken = { value: null, exp: 0 };
async function getFeishuToken() {
  if (feishuToken.value && Date.now() < feishuToken.exp) return feishuToken.value;
  const r = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: feishuConfig.appId, app_secret: feishuConfig.appSecret })
  });
  const d = await r.json();
  if (d.code !== 0) throw new Error(d.msg || 'feishu token failed');
  feishuToken = { value: d.tenant_access_token, exp: Date.now() + (d.expire - 300) * 1000 };
  return feishuToken.value;
}

// 多维表格附件字段：图片需先上传到飞书素材库拿 file_token，再写入附件字段
function dataUrlToBuffer(dataUrl) {
  const m = /^data:(image\/[\w+.-]+);base64,(.+)$/.exec(dataUrl || '');
  if (!m) return null;
  return { buf: Buffer.from(m[2], 'base64'), mime: m[1] };
}
function multipartBody(fields, filename, buf, mime) {
  const boundary = '----fs' + Date.now().toString(16) + Math.random().toString(16).slice(2);
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`));
  parts.push(buf, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}
async function uploadFeishuMedia(token, dataUrl, filename) {
  const img = dataUrlToBuffer(dataUrl);
  if (!img) return null;
  const { body, contentType } = multipartBody({
    file_name: filename,
    parent_type: 'bitable_image',
    parent_node: feishuConfig.appToken,
    size: String(img.buf.length)
  }, filename, img.buf, img.mime);
  const r = await fetch('https://open.feishu.cn/open-apis/drive/v1/medias/upload_all', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': contentType }, body
  });
  const d = await r.json();
  if (d.code !== 0) throw new Error('feishu media upload: ' + (d.msg || d.code));
  return d.data.file_token;
}
// 附件字段不存在时自动创建（type 17 = 附件）
async function ensureFeishuField(token, name) {
  const r = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${feishuConfig.appToken}/tables/${feishuConfig.tableId}/fields?page_size=100`, {
    headers: { Authorization: 'Bearer ' + token }
  });
  const d = await r.json();
  if (d.code !== 0) throw new Error('feishu fields list: ' + (d.msg || d.code));
  if ((d.data.items || []).some(f => f.field_name === name)) return;
  const c = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${feishuConfig.appToken}/tables/${feishuConfig.tableId}/fields`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ field_name: name, type: 17 })
  });
  const cd = await c.json();
  if (cd.code !== 0) throw new Error('feishu field create: ' + (cd.msg || cd.code));
}
async function submitFeishu(rec) {
  if (!feishuConfig?.appId) return { ok: false, error: 'not_configured' };
  const token = await getFeishuToken();
  const F = feishuConfig.fields || {};
  const fields = {};
  fields[F.uid || 'UID'] = rec.uid || '';
  fields[F.pid || 'PID'] = rec.pid || '';
  fields[F.vid || 'VID'] = rec.vid || '';
  fields[F.userName || '用户昵称'] = rec.userName || '';
  fields[F.otherUserName || '接受者用户昵称'] = rec.otherUserName || '';
  fields[F.otherUid || '接受者UID'] = rec.otherUid || '';
  fields[F.otherPid || '接受者PID'] = rec.otherPid || '';
  fields[F.otherVid || '接受者VID'] = rec.otherVid || '';
  const t = new Date(rec.time);
  fields[F.time || '比赛时间'] = isNaN(t) ? Date.now() : t.getTime();
  fields[F.a || '发起方比分'] = Number(rec.a ?? 0);
  fields[F.b || '对手比分'] = Number(rec.b ?? 0);
  fields[F.submittedAt || '提交时间'] = Date.now();
  // 两张凭证图：开黑截图 + 游戏结算图（附件字段）
  const proofs = [['voice', F.voiceProof || '开黑图', '开黑图.jpg'], ['result', F.resultProof || '游戏结算图', '游戏结算图.jpg']];
  for (const [key, fieldName, filename] of proofs) {
    const dataUrl = rec.proofs?.[key];
    if (!dataUrl) continue;
    await ensureFeishuField(token, fieldName);
    const fileToken = await uploadFeishuMedia(token, dataUrl, filename);
    if (fileToken) fields[fieldName] = [{ file_token: fileToken }];
  }
  const r = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${feishuConfig.appToken}/tables/${feishuConfig.tableId}/records`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ fields })
  });
  const d = await r.json();
  if (d.code !== 0) return { ok: false, error: d.msg || 'feishu code ' + d.code };
  return { ok: true };
}

// ---- 排行榜：直接以飞书表为数据源计分（不落数据库），30s 缓存防触发频率限制 ----
let lbCache = { rows: null, exp: 0 };
const feishuText = v => Array.isArray(v) ? v.map(s => s?.text || '').join('') : (v ?? '');
async function getLeaderboard() {
  if (lbCache.rows && Date.now() < lbCache.exp) return lbCache.rows;
  const token = await getFeishuToken();
  const items = [];
  let pageToken = '';
  do {
    const u = `https://open.feishu.cn/open-apis/bitable/v1/apps/${feishuConfig.appToken}/tables/${feishuConfig.tableId}/records?page_size=500` + (pageToken ? `&page_token=${pageToken}` : '');
    const d = await (await fetch(u, { headers: { Authorization: 'Bearer ' + token } })).json();
    if (d.code !== 0) throw new Error('feishu records list: ' + (d.msg || d.code));
    items.push(...(d.data.items || []));
    pageToken = d.data.has_more ? d.data.page_token : '';
  } while (pageToken);
  const players = new Map(), seen = new Set();
  for (const it of items) {
    const f = it.fields || {};
    const name = String(feishuText(f['用户昵称'])).trim();
    const other = String(feishuText(f['接受者用户昵称'])).trim();
    if (!name || !other) continue;
    const ms = Number(f['比赛时间']) || 0;
    const day = ms ? new Date(ms + 8 * 3600e3).toISOString().slice(0, 10) : ''; // 北京时间日期
    const pairKey = [name, other].sort().join('↔') + '@' + day;
    if (seen.has(pairKey)) continue; // 同一对手、同一天只计最先确认的一场
    seen.add(pairKey);
    const a = Number(f['发起方比分']) || 0, b = Number(f['对手比分']) || 0;
    for (const [n, win] of [[name, a > b], [other, b > a]]) {
      const p = players.get(n) || { name: n, games: 0, wins: 0, points: 0 };
      p.games++; p.points++; if (win) { p.wins++; p.points++; } // 参赛 1 分，胜方再 +1，平局各 1
      players.set(n, p);
    }
  }
  const rows = [...players.values()].sort((x, y) => y.points - x.points || y.wins - x.wins).slice(0, 50);
  lbCache = { rows, exp: Date.now() + 30e3 };
  return rows;
}

http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400).end('Bad Request');
    return;
  }
  if (req.method === 'POST' && urlPath === '/api/feishu') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 25e6) req.destroy(); }); // 含两张凭证图 base64，放宽到 25MB
    req.on('end', async () => {
      try {
        const out = await submitFeishu(JSON.parse(body || '{}'));
        if (out.ok) lbCache.exp = 0; // 新战绩确认后让榜单缓存立刻失效
        res.writeHead(out.ok ? 200 : 502, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(out));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
      }
    });
    return;
  }
  if (req.method === 'GET' && urlPath === '/api/leaderboard') {
    (async () => {
      try {
        if (!feishuConfig?.appId) throw new Error('not_configured');
        const rows = await getLeaderboard();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, rows }));
      } catch (e) {
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
      }
    })();
    return;
  }
  let file = path.normalize(path.join(ROOT, urlPath));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('Forbidden'); return; }
  if (urlPath.endsWith('/')) file = path.join(file, 'index.html');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      file = path.join(ROOT, 'index.html');
      if (!fs.existsSync(file)) { res.writeHead(404).end('Not Found'); return; }
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*'
    });
    fs.createReadStream(file).pipe(res);
  });
}).listen(PORT, HOST, () => {
  console.log(`咱俩练练活动页: http://localhost:${PORT}/`);
});
