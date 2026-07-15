// noitamap.com 反向代理(玩家属性「从地图选点」,功能设计见 2026-07-20 会话):
// 跨域 iframe 受同源策略限制,父页面既读不到其 #coordinate 悬浮框、也收不到
// 其内部的右键事件;经本地反代后 iframe 与编辑器同源,前端可直接进入文档
// 拦截 contextmenu 并读坐标,无需向对方页面注入任何脚本。
//
// 上游固定为 noitamap.com(仅 GET),不构成开放代理;服务本身也只绑 127.0.0.1。
// 站点页面资源全为相对路径(自然经过本路由),重量级地图瓦片走
// *.acidflow.stream 绝对 URL + `Access-Control-Allow-Origin: *`(2026-07-20
// 实测),由浏览器直连,不占本服务带宽。
//
// 响应头按白名单复制:天然丢弃 CSP/上报类头,以及 content-encoding /
// content-length —— undici fetch 已透明解压,原样透传会让浏览器二次解压失败。

import { Hono } from 'hono';

const UPSTREAM = 'https://noitamap.com';

// 条件请求头一并透传:复开弹窗时静态资源可走 etag 协商缓存(304)
const PASS_REQUEST_HEADERS = ['accept', 'accept-language', 'if-none-match', 'if-modified-since'];
const PASS_RESPONSE_HEADERS = ['content-type', 'cache-control', 'etag', 'last-modified'];

export const noitamapRoutes = new Hono();

noitamapRoutes.get('/noitamap', (c) => c.redirect('/noitamap/'));

noitamapRoutes.get('/noitamap/*', async (c) => {
  const rest = c.req.path.slice('/noitamap'.length) || '/';
  const { search } = new URL(c.req.url);

  const headers = {};
  for (const name of PASS_REQUEST_HEADERS) {
    const value = c.req.header(name);
    if (value) headers[name] = value;
  }

  let upstream;
  try {
    upstream = await fetch(UPSTREAM + rest + search, {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    return c.text(`noitamap.com 请求失败(该功能需要联网): ${e.cause?.code || e.name || e}`, 502);
  }

  const out = {};
  for (const name of PASS_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) out[name] = value;
  }
  if (upstream.status === 304) return c.body(null, 304, out);
  return c.body(upstream.body, upstream.status, out);
});
