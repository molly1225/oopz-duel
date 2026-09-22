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
  const r = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${feishuConfig.appToken}/tables/${feishuConfig.tableId}/records`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ fields })
  });
  const d = await r.json();
  if (d.code !== 0) return { ok: false, error: d.msg || 'feishu code ' + d.code };
  return { ok: true };
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
    req.on('data', c => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', async () => {
      try {
        const out = await submitFeishu(JSON.parse(body || '{}'));
        res.writeHead(out.ok ? 200 : 502, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(out));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
      }
    });
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
