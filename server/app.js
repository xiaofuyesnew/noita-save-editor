// Hono 应用工厂(M6):createApp() 组装全部路由与静态托管,
// startServer() 供 CLI 壳(index.js)与 Electron 主进程复用。
// 静态目录用基于本文件位置的绝对路径,不依赖进程 CWD ——
// 桌面打包(asar)与从任意目录启动均可正常工作。

import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { config, saveLocalConfig } from './config.js';
import { saveManager } from './services/saveManager.js';
import { wandRoutes } from './routes/wands.js';
import { effectRoutes } from './routes/effects.js';
import { extraRoutes } from './routes/extras.js';
import { noitamapRoutes } from './routes/noitamap.js';
import {
  readBasics,
  applyBasics,
  readDamageMultipliers,
  applyDamageMultipliers,
  readInvincibility,
  applyInvincibility,
} from './model/playerBasics.js';

// M8 双轨:vite 构建产物(frontend/dist)存在则托管之,否则回退旧 web/。
// 迁移验收完成(M8.3)后回退分支与 web/ 一并移除。
const frontendDist = fileURLToPath(new URL('../frontend/dist', import.meta.url));
const legacyWeb = fileURLToPath(new URL('../web', import.meta.url));
const defaultWebRoot = existsSync(join(frontendDist, 'index.html')) ? frontendDist : legacyWeb;

/**
 * 组装完整的编辑器 Hono 应用。
 * @param {{webRoot?: string}} [opts] webRoot: 静态前端目录(绝对路径),默认 editor/web
 */
export function createApp({ webRoot = defaultWebRoot } = {}) {
  const app = new Hono();

  // ---- 本机安全护栏(CSRF / DNS-rebinding) --------------------------------
  // 服务只绑 127.0.0.1,但浏览器里的恶意页面仍可跨站 POST(CSRF),或用
  // DNS-rebinding 把自己的域名重绑到 127.0.0.1 后同源读写。两道校验挡住:
  //  1) Host 头必须是 localhost/127.0.0.1(rebinding 后 Host 是攻击者域名 → 拒);
  //  2) 写方法若带 Origin,其 host 也必须是本机(挡跨站表单/fetch)。
  // 放行缺失 Origin(同源 GET、curl、测试 app.request 均无 Origin)。
  const isLocalHost = (host) => {
    if (!host) return true; // Hono test client 等可能不带 Host
    const name = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    return name === 'localhost' || name === '127.0.0.1' || name === '::1';
  };
  app.use('/*', async (c, next) => {
    if (!isLocalHost(c.req.header('host'))) {
      return c.json({ ok: false, error: '非法 Host(仅允许本机访问)' }, 403);
    }
    const method = c.req.method;
    if (method !== 'GET' && method !== 'HEAD') {
      const origin = c.req.header('origin');
      if (origin) {
        let ok = false;
        try {
          ok = isLocalHost(new URL(origin).host);
        } catch {
          ok = false;
        }
        if (!ok) return c.json({ ok: false, error: '跨站请求被拒绝(Origin 非本机)' }, 403);
      }
    }
    await next();
  });

  // ---- API ----------------------------------------------------------------

  const api = new Hono();

  api.get('/status', (c) => c.json(saveManager.status()));

  // ---- 路径配置(功能③):存档/实时路径可编辑,持久化到 config.local.json --------

  api.get('/config/paths', (c) =>
    c.json({ saveDir: saveManager.saveDir, liveDir: saveManager.liveDir }));

  api.put('/config/paths', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    try {
      const result = saveManager.setPaths(body);
      if (result.changed) {
        saveLocalConfig({ workspaceSave: saveManager.saveDir, liveSave: saveManager.liveDir });
      }
      return c.json({ ok: true, ...result, status: saveManager.status() });
    } catch (e) {
      return c.json(
        { ok: false, error: String(e.message || e), requiresForce: e.requiresForce === true },
        e.requiresForce ? 409 : 400,
      );
    }
  });

  api.post('/save/reload', (c) => {
    saveManager.reload();
    return c.json(saveManager.status());
  });

  api.post('/save/write', async (c) => {
    try {
      const result = await saveManager.commit();
      return c.json({ ok: true, ...result, status: saveManager.status() });
    } catch (e) {
      return c.json({ ok: false, error: String(e.message || e) }, 400);
    }
  });

  api.get('/backups', (c) => c.json({ backups: saveManager.listBackups() }));

  api.post('/backups', (c) => {
    const name = saveManager.backup();
    return c.json({ ok: true, name });
  });

  api.post('/backups/:name/restore', async (c) => {
    try {
      const result = await saveManager.restore(c.req.param('name'));
      return c.json({ ok: true, ...result });
    } catch (e) {
      return c.json({ ok: false, error: String(e.message || e) }, 400);
    }
  });

  api.delete('/backups/:name', (c) => {
    try {
      return c.json({ ok: true, ...saveManager.deleteBackup(c.req.param('name')) });
    } catch (e) {
      return c.json({ ok: false, error: String(e.message || e) }, 400);
    }
  });

  api.get('/backups/:name/export', (c) => {
    try {
      const { fileName, data } = saveManager.exportBackup(c.req.param('name'));
      return c.body(data, 200, {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="${fileName}"`,
      });
    } catch (e) {
      return c.json({ ok: false, error: String(e.message || e) }, 400);
    }
  });

  api.post('/sync/pull', async (c) => {
    try {
      const result = await saveManager.pull();
      return c.json({ ok: true, ...result });
    } catch (e) {
      return c.json({ ok: false, error: String(e.message || e) }, 400);
    }
  });

  api.post('/sync/push', async (c) => {
    const force = c.req.query('force') === '1';
    try {
      const result = await saveManager.push({ force });
      return c.json({ ok: true, ...result });
    } catch (e) {
      return c.json({ ok: false, error: String(e.message || e) }, 400);
    }
  });

  app.route('/api', api);

  // ---- 玩家(M1) -------------------------------------------------------------

  const player = new Hono();

  // 统一取树 + 版本乐观校验 + 错误包装 + 写操作事务化。
  // write 为真时:先解析 body、校验 version(与其余路由一致的乐观锁),
  // 再把模型调用放进 saveManager.mutate 事务(中途抛错回滚 player+world 缓冲)。
  function withPlayerTree(fn, { write = false } = {}) {
    return async (c) => {
      const tree = saveManager.getTree('player.xml');
      if (!tree) return c.json({ ok: false, error: '未找到 player.xml' }, 404);

      let body;
      if (write) {
        body = await c.req.json().catch(() => ({}));
        const version = body?.version ?? c.req.query('v');
        if (version !== undefined && Number(version) !== saveManager.version) {
          return c.json({
            ok: false,
            error: `版本不一致(客户端 ${version},服务端 ${saveManager.version}),请刷新后重试`,
          }, 409);
        }
      }

      try {
        if (write) {
          return saveManager.mutate(['player.xml', 'world_state.xml'], () => fn(c, tree, body));
        }
        return await fn(c, tree, body);
      } catch (e) {
        return c.json({ ok: false, error: String(e.message || e) }, 400);
      }
    };
  }

  player.get('/basics', withPlayerTree((c, tree) =>
    c.json({ ...readBasics(tree), version: saveManager.version })));

  player.put('/basics', withPlayerTree((c, tree, body) => {
    const patch = body ?? {};
    const worldTree = saveManager.getTree('world_state.xml');
    const result = applyBasics(tree, worldTree, patch);
    if (result.playerChanged) saveManager.markDirty('player.xml');
    if (result.worldChanged) saveManager.markDirty('world_state.xml');
    return c.json({ ok: true, ...result, basics: readBasics(tree), version: saveManager.version });
  }, { write: true }));

  player.get('/damage-multipliers', withPlayerTree((c, tree) =>
    c.json({ ...readDamageMultipliers(tree), version: saveManager.version })));

  player.put('/damage-multipliers', withPlayerTree((c, tree, body) => {
    const result = applyDamageMultipliers(tree, body ?? {});
    if (result.changed) saveManager.markDirty('player.xml');
    return c.json({ ok: true, ...result, multipliers: readDamageMultipliers(tree), version: saveManager.version });
  }, { write: true }));

  player.get('/invincibility', withPlayerTree((c, tree) =>
    c.json(readInvincibility(tree))));

  player.post('/invincibility', withPlayerTree((c, tree, body) => {
    const result = applyInvincibility(tree, body ?? {});
    if (result.changed) saveManager.markDirty('player.xml');
    return c.json({ ok: true, ...result, version: saveManager.version });
  }, { write: true }));

  app.route('/api/player', player);

  // ---- 法杖/法术/字典(M2) ----------------------------------------------------

  app.route('/api', wandRoutes);

  // ---- 特殊效果/天赋(M3) -----------------------------------------------------

  app.route('/api', effectRoutes);

  // ---- 药水/世界状态/进度解锁/遗骨法杖(M4) -----------------------------------

  app.route('/api', extraRoutes);

  // ---- noitamap 反向代理(玩家「从地图选点」) --------------------------------
  // 必须挂在下方 no-store 中间件之前:后注册的中间件不包裹先注册的路由,
  // 代理响应才能保留上游缓存头(与 /api 同理)。

  app.route('/', noitamapRoutes);

  // ---- 静态前端 -------------------------------------------------------------

  // 无构建步骤,web/ 下的 ES module 改动需要即时生效:禁用浏览器缓存,
  // 否则 import 的模块会被启发式缓存,刷新页面仍加载旧代码。
  app.use('/*', async (c, next) => {
    await next();
    c.res.headers.set('cache-control', 'no-store');
  });
  app.use('/*', serveStatic({ root: webRoot }));

  return app;
}

/**
 * 启动 HTTP 服务(仅绑定本机)。port=0 时由系统分配随机端口,
 * 从返回值 port 取实际端口 —— Electron 主进程用它 loadURL。
 * @param {{port?: number, host?: string, app?: import('hono').Hono}} [opts]
 * @returns {Promise<{server: import('node:http').Server, port: number, host: string}>}
 */
export function startServer({ port = config.port, host = config.host, app = createApp() } = {}) {
  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, hostname: host, port }, (info) => {
      resolve({ server, port: info.port, host });
    });
  });
}
