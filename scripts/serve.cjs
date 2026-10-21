'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = fs.realpathSync(path.resolve(__dirname, '../public'));
const port = Number(process.env.ORDRUM_PORT || process.env.PORT || 8765);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('端口必须是 1–65535 的整数。');
  process.exit(1);
}
const mime = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.md': 'text/plain; charset=utf-8', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
function freshLaunchHtml(html, token) {
  const assetUrl = (value, extension) => {
    // Rewrite authored relative assets only. Auth, account bridge and service
    // worker addresses keep their exact URLs and existing security boundaries.
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value)) return value;
    let target;
    try { target = decodeURIComponent(new URL(value, 'http://local.invalid/').pathname); }
    catch (_) { return value; }
    if (!target.endsWith(extension) || target.split('/').includes('..') ||
      ['service-worker.js', 'sync-bridge.js'].includes(path.posix.basename(target)) ||
      /^\/(?:api(?:\/|$)|signin-with-chatgpt|signout-with-chatgpt|callback|sync-bridge(?:\/|$))/.test(target)) return value;
    const hashIndex = value.indexOf('#');
    const base = hashIndex < 0 ? value : value.slice(0, hashIndex);
    const hash = hashIndex < 0 ? '' : value.slice(hashIndex);
    return `${base}${base.includes('?') ? '&amp;' : '?'}launch=${token}${hash}`;
  };
  return html.replace(/<script\b[^>]*>|<link\b[^>]*>|<a\b[^>]*>/gi, tag => {
    if (/^<a\b/i.test(tag)) {
      const classes = tag.match(/\sclass\s*=\s*(["'])(.*?)\1/i)?.[2] || '';
      return classes.split(/\s+/).includes('brand')
        ? tag.replace(/(\shref\s*=\s*)(["'])\.\/\2/i, (_, prefix, quote) => `${prefix}${quote}./?launch=${token}${quote}`) : tag;
    }
    const script = /^<script\b/i.test(tag);
    const rel = tag.match(/\srel\s*=\s*(["'])(.*?)\1/i)?.[2] || '';
    if (!script && !rel.toLowerCase().split(/\s+/).includes('stylesheet')) return tag;
    const attribute = script ? /(\ssrc\s*=\s*)(["'])(.*?)\2/i : /(\shref\s*=\s*)(["'])(.*?)\2/i;
    return tag.replace(attribute, (_, prefix, quote, value) => `${prefix}${quote}${assetUrl(value, script ? '.js' : '.css')}${quote}`);
  });
}
const server = http.createServer(async (request, response) => {
  const fail = (status, message) => {
    response.writeHead(status, {'Content-Type': 'text/plain; charset=utf-8'});
    response.end(request.method === 'HEAD' ? undefined : message);
  };
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.setHeader('Allow', 'GET, HEAD');
    return fail(405, '仅支持读取网页。');
  }
  try {
    const url = new URL(request.url, 'http://localhost');
    const tokens = url.searchParams.getAll('launch');
    if (tokens.length && (tokens.length !== 1 || !/^[A-Za-z0-9_-]{1,64}$/.test(tokens[0]))) return fail(400, '启动地址不正确，请重新启动网页。');
    const token = tokens[0];
    const pathname = decodeURIComponent(url.pathname);
    const requested = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!requested.startsWith(root + path.sep)) return fail(403, '无法读取此文件。');
    const filename = await fs.promises.realpath(requested);
    if (!filename.startsWith(root + path.sep)) return fail(403, '无法读取此文件。');
    const stat = await fs.promises.stat(filename);
    if (!stat.isFile()) return fail(404, '文件不存在。');
    const body = token && ['/', '/index.html'].includes(pathname)
      ? Buffer.from(freshLaunchHtml(await fs.promises.readFile(filename, 'utf8'), token)) : null;
    const size = body ? body.length : stat.size;
    const headers = {
      'Content-Type': mime[path.extname(filename)] || 'application/octet-stream',
      'Content-Length': size,
      'Cache-Control': token ? 'no-store' : 'no-cache',
      'Accept-Ranges': 'bytes',
      'X-Content-Type-Options': 'nosniff',
    };
    let start = 0, end = size - 1, status = 200;
    if (request.headers.range) {
      const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
      if (!range || (!range[1] && !range[2])) {
        response.setHeader('Content-Range', `bytes */${size}`);
        return fail(416, '无法读取此范围。');
      }
      start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start > end || start >= size || end < 0) {
        response.setHeader('Content-Range', `bytes */${size}`);
        return fail(416, '无法读取此范围。');
      }
      status = 206;
      headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
      headers['Content-Length'] = end - start + 1;
    }
    response.writeHead(status, headers);
    if (request.method === 'HEAD' || !size) return response.end();
    if (body) return response.end(body.subarray(start, end + 1));
    fs.createReadStream(filename, {start, end}).on('error', () => response.destroy()).pipe(response);
  } catch (error) {
    fail(error instanceof URIError ? 400 : 404, '文件不存在或地址不正确。');
  }
});
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE'
    ? `端口 ${port} 正在使用。请关闭之前的启动窗口，或设置 ORDRUM_PORT 换一个端口。`
    : `网页启动失败：${error.message}`);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  console.log(`瑞典语单词室：http://127.0.0.1:${port}`);
  console.log('按 Control+C 停止。');
});
