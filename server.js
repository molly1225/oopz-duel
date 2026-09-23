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

// ---- 飞书多维表格：既当战绩库（创建/查询/确认），也当榜单数据源，不落数据库 ----
let feishuConfig = null;
try { feishuConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'feishu-config.json'), 'utf8')); } catch {}
const feishuReady = () => !!feishuConfig?.appId;
const bitableBase = () => `https://open.feishu.cn/open-apis/bitable/v1/apps/${feishuConfig.appToken}/tables/${feishuConfig.tableId}`;

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

// 图片需先上传到飞书素材库拿 file_token，再写入附件字段
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

// 字段不存在时自动创建（type 17 = 附件，1 = 文本）
let fieldsEnsured = false;
async function ensureFeishuField(token, name, type = 17, existing) {
  if (existing?.some(f => f.field_name === name)) return;
  const c = await fetch(`${bitableBase()}/fields`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ field_name: name, type })
  });
  const cd = await c.json();
  if (cd.code !== 0) throw new Error('feishu field create ' + name + ': ' + (cd.msg || cd.code));
}
async function ensureRecordFields(token) {
  if (fieldsEnsured) return;
  const r = await fetch(`${bitableBase()}/fields?page_size=100`, { headers: { Authorization: 'Bearer ' + token } });
  const d = await r.json();
  if (d.code !== 0) throw new Error('feishu fields list: ' + (d.msg || d.code));
  const items = d.data.items || [];
  for (const n of ['记录ID', '发起方留言', '接受者留言', '状态']) await ensureFeishuField(token, n, 1, items);
  for (const n of ['开黑图', '游戏结算图']) await ensureFeishuField(token, n, 17, items);
  fieldsEnsured = true;
}

const feishuText = v => Array.isArray(v) ? v.map(s => s?.text || '').join('') : (v ?? '');
const firstToken = v => Array.isArray(v) ? (v[0]?.file_token || '') : '';

async function findRecordByRid(token, rid) {
  const r = await fetch(`${bitableBase()}/records/search`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ filter: { conjunction: 'and', conditions: [{ field_name: '记录ID', operator: 'is', value: [rid] }] }, page_size: 5 })
  });
  const d = await r.json();
  if (d.code !== 0) throw new Error('feishu search: ' + (d.msg || d.code));
  return d.data.items?.[0] || null;
}

// 创建/更新战绩（确认前可改；已确认拒绝）
async function saveFeishuRecord(rec) {
  const token = await getFeishuToken();
  await ensureRecordFields(token);
  const t = new Date(rec.time);
  const fields = {
    '记录ID': String(rec.id || ''),
    'UID': rec.uid || '', 'PID': rec.pid || '', 'VID': rec.vid || '',
    '用户昵称': rec.name || '',
    '比赛时间': isNaN(t) ? Date.now() : t.getTime(),
    '发起方比分': Number(rec.a ?? 0),
    '对手比分': Number(rec.b ?? 0),
    '发起方留言': rec.message || '',
    '状态': '待确认'
  };
  const proofs = [['voice', '开黑图', '开黑图.jpg'], ['result', '游戏结算图', '游戏结算图.jpg']];
  for (const [key, fieldName, filename] of proofs) {
    const dataUrl = rec.proofs?.[key];
    if (!dataUrl) continue;
    const fileToken = await uploadFeishuMedia(token, dataUrl, filename);
    if (fileToken) fields[fieldName] = [{ file_token: fileToken }];
  }
  const existing = await findRecordByRid(token, fields['记录ID']);
  if (existing) {
    const status = String(feishuText(existing.fields['状态'])).trim();
    if (status === '已确认') return { ok: false, error: 'already_confirmed' };
    delete fields['状态'];
    const r = await fetch(`${bitableBase()}/records/${existing.record_id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ fields })
    });
    const d = await r.json();
    if (d.code !== 0) return { ok: false, error: d.msg || 'feishu code ' + d.code };
    return { ok: true, updated: true };
  }
  const r = await fetch(`${bitableBase()}/records`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ fields })
  });
  const d = await r.json();
  if (d.code !== 0) return { ok: false, error: d.msg || 'feishu code ' + d.code };
  return { ok: true };
}

// 查询战绩（邀请链接跨设备打开用）
async function getFeishuRecord(rid) {
  const token = await getFeishuToken();
  await ensureRecordFields(token);
  const it = await findRecordByRid(token, rid);
  if (!it) return { ok: false, error: 'not_found' };
  const f = it.fields || {};
  return {
    ok: true,
    record: {
      id: String(feishuText(f['记录ID'])),
      name: String(feishuText(f['用户昵称'])),
      time: Number(f['比赛时间']) || 0,
      a: Number(f['发起方比分']) || 0,
      b: Number(f['对手比分']) || 0,
      message: String(feishuText(f['发起方留言'])),
      otherName: String(feishuText(f['接受者用户昵称'])),
      otherMessage: String(feishuText(f['接受者留言'])),
      confirmed: String(feishuText(f['状态'])).trim() === '已确认',
      proofTokens: { voice: firstToken(f['开黑图']), result: firstToken(f['游戏结算图']) }
    }
  };
}

// 确认战绩（锁定，防重复确认）
async function confirmFeishuRecord(rid, otherName, otherMessage) {
  const token = await getFeishuToken();
  await ensureRecordFields(token);
  const it = await findRecordByRid(token, rid);
  if (!it) return { ok: false, error: 'not_found' };
  if (String(feishuText(it.fields['状态'])).trim() === '已确认') return { ok: false, error: 'already_confirmed' };
  const r = await fetch(`${bitableBase()}/records/${it.record_id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ fields: { '接受者用户昵称': otherName || '', '接受者留言': otherMessage || '', '状态': '已确认', '提交时间': Date.now() } })
  });
  const d = await r.json();
  if (d.code !== 0) return { ok: false, error: d.msg || 'feishu code ' + d.code };
  lbCache.exp = 0; // 榜单缓存立刻失效
  return { ok: true };
}

// ---- 排行榜：直接以飞书表为数据源计分（只计已确认），30s 缓存防触发频率限制 ----
let lbCache = { rows: null, exp: 0 };
async function getLeaderboard() {
  if (lbCache.rows && Date.now() < lbCache.exp) return lbCache.rows;
  const token = await getFeishuToken();
  const items = [];
  let pageToken = '';
  do {
    const u = `${bitableBase()}/records?page_size=500` + (pageToken ? `&page_token=${pageToken}` : '');
    const d = await (await fetch(u, { headers: { Authorization: 'Bearer ' + token } })).json();
    if (d.code !== 0) throw new Error('feishu records list: ' + (d.msg || d.code));
    items.push(...(d.data.items || []));
    pageToken = d.data.has_more ? d.data.page_token : '';
  } while (pageToken);
  const players = new Map(), seen = new Set();
  for (const it of items) {
    const f = it.fields || {};
    if (String(feishuText(f['状态'])).trim() === '待确认') continue; // 未确认不计分
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

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

http.createServer((req, res) => {
  let urlPath;
  let query;
  try {
    const u = new URL(req.url, 'http://x');
    urlPath = decodeURIComponent(u.pathname);
    query = u.searchParams;
  } catch {
    res.writeHead(400).end('Bad Request');
    return;
  }
  const api = (fn) => (async () => {
    try {
      if (!feishuReady()) throw new Error('not_configured');
      await fn();
    } catch (e) {
      sendJson(res, 502, { ok: false, error: String(e?.message || e) });
    }
  })();

  // 创建/更新战绩（确认前可改）
  if (req.method === 'POST' && urlPath === '/api/records') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 25e6) req.destroy(); }); // 含两张凭证图 base64，放宽到 25MB
    req.on('end', () => api(async () => {
      let rec;
      try { rec = JSON.parse(body || '{}'); } catch { return sendJson(res, 400, { ok: false, error: 'bad_json' }); }
      if (!rec.id) return sendJson(res, 400, { ok: false, error: 'missing_id' });
      sendJson(res, 200, await saveFeishuRecord(rec));
    }));
    return;
  }
  // 查询战绩（邀请链接打开）
  if (req.method === 'GET' && urlPath === '/api/records') {
    api(async () => sendJson(res, 200, await getFeishuRecord(String(query.get('id') || ''))));
    return;
  }
  // 确认战绩
  if (req.method === 'POST' && urlPath === '/api/records/confirm') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => api(async () => {
      let rec;
      try { rec = JSON.parse(body || '{}'); } catch { return sendJson(res, 400, { ok: false, error: 'bad_json' }); }
      sendJson(res, 200, await confirmFeishuRecord(String(rec.id || ''), rec.otherName, rec.otherMessage));
    }));
    return;
  }
  // 凭证图代理（飞书素材需鉴权，前端经这里取图）
  if (req.method === 'GET' && urlPath.startsWith('/api/media/')) {
    (async () => {
      try {
        if (!feishuReady()) throw new Error('not_configured');
        const ft = await getFeishuToken();
        const fileToken = urlPath.slice('/api/media/'.length);
        const r = await fetch(`https://open.feishu.cn/open-apis/drive/v1/medias/${encodeURIComponent(fileToken)}/download`, {
          headers: { Authorization: 'Bearer ' + ft }
        });
        if (!r.ok) { res.writeHead(404).end('Not Found'); return; }
        res.writeHead(200, { 'Content-Type': r.headers.get('content-type') || 'image/jpeg', 'Cache-Control': 'public, max-age=86400' });
        res.end(Buffer.from(await r.arrayBuffer()));
      } catch { res.writeHead(502).end('Bad Gateway'); }
    })();
    return;
  }
  // 排行榜（飞书表数据源）
  if (req.method === 'GET' && urlPath === '/api/leaderboard') {
    api(async () => sendJson(res, 200, { ok: true, rows: await getLeaderboard() }));
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
