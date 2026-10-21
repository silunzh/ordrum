import { getChatGPTUser } from "../chatgpt-auth";

export const dynamic = "force-dynamic";

function allowedSource(value: string | null, path: string | null) {
  if (!value) return null;
  if (value === "https://silunzh.github.io") {
    return path === "/ordrum/" ? {origin: value, path, label: "GitHub 网页", address: `${value}${path}`} : null;
  }
  if (path !== null) return null;
  try {
    const url = new URL(value);
    const port = Number(url.port || "80");
    return url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname)
      && url.origin === value && !url.username && !url.password
      && Number.isInteger(port) && port >= 1 && port <= 65535 ? {origin: value, path: "", label: "本地网页", address: value} : null;
  } catch { return null; }
}

function escapeHTML(value: string) {
  return value.replace(/[&<>"']/g, character => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[character]!);
}

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const source = allowedSource(url.searchParams.get("origin"), url.searchParams.get("path"));
  const channel = url.searchParams.get("channel") || "";
  if (!source || !/^[a-f0-9]{64}$/.test(channel)
    || url.searchParams.getAll("origin").length !== 1 || url.searchParams.getAll("channel").length !== 1
    || url.searchParams.getAll("path").length > 1) {
    return new Response("同步地址无效。请从 Ordrum 学习网页重新连接。", {
      status: 400, headers: {...privateHeaders, "Content-Type": "text/plain; charset=utf-8"},
    });
  }
  let user;
  try { user = await getChatGPTUser(); }
  catch {
    return new Response("暂时无法确认登录状态。请稍后从 Ordrum 单词室重新连接。", {
      status: 503, headers: {...privateHeaders, "Content-Type": "text/plain; charset=utf-8"},
    });
  }
  const returnTo = `/sync-bridge?${new URLSearchParams({origin: source.origin, channel, ...(source.path ? {path: source.path} : {})}).toString()}`;
  const signIn = `/signin-with-chatgpt?return_to=${encodeURIComponent(returnTo)}`;
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>连接 Ordrum 学习进度</title>
<style>html{color-scheme:light}body{margin:0;background:#f6f7f2;color:#243c36;font:16px/1.65 system-ui,-apple-system,sans-serif}main{max-width:480px;margin:8vh auto;padding:32px}h1{font-size:28px;line-height:1.3;margin:12px 0 20px}p{margin:14px 0}code{display:block;padding:12px 16px;border:1px solid #d5e1d9;border-radius:12px;background:white;overflow-wrap:anywhere;font-size:14px}button,.button{display:inline-block;padding:12px 20px;border:0;border-radius:12px;background:#285d4e;color:#fff;text-decoration:none;font:inherit;font-weight:600;cursor:pointer}button:disabled{opacity:.55;cursor:default}[hidden]{display:none!important}.eyebrow{font-size:12px;font-weight:700;letter-spacing:.12em;color:#657c70}.muted{font-size:14px;color:#66796f}#bridge-status{min-height:52px}a{color:#285d4e}button:focus-visible,a:focus-visible{outline:3px solid #d7a74a;outline-offset:4px}</style>
<script src="/sync-bridge.js${source.path ? "?source=github-pages-v1" : ""}" defer></script></head>
<body data-authenticated="${user ? "true" : "false"}" data-local-origin="${escapeHTML(source.origin)}" data-source-path="${escapeHTML(source.path)}" data-channel="${channel}" data-signin="${escapeHTML(signIn)}"><main>
<div class="eyebrow">ORDRUM · 学习进度同步</div><h1>${source.path ? "连接 GitHub 单词室" : "连接本地单词室"}</h1>
<p>${source.label}地址：</p><code id="bridge-origin">${escapeHTML(source.address)}</code>
<p id="bridge-status" role="status">${user ? `确认连接后，这个${source.label}可以同步当前账号的学习任务、浏览进度、掌握记录和错题。` : `请先登录与你在线学习时相同的账号，再连接${source.label}。`}</p>
<button id="bridge-connect" type="button" ${user ? "" : "hidden"}>连接此${source.path ? " GitHub 网页" : "本地网页"}</button>
<a id="bridge-signin" class="button" href="${escapeHTML(signIn)}" ${user ? "hidden" : ""}>登录并继续</a>
<p class="muted">连接期间请保持此窗口打开。登录信息只由在线单词室管理，${source.label}不会获取你的登录凭据。</p>
<p class="muted">只连接你自己打开的 Ordrum 网页。关闭此窗口即可断开连接；学习记录仍保存在原处。</p>
</main></body></html>`;
  return new Response(html, {headers: {...privateHeaders, "Content-Type": "text/html; charset=utf-8"}});
}
