// Noita 存档编辑器 —— CLI 启动壳(浏览器模式,`pnpm start`)。
// 应用组装在 app.js 的 createApp() 中(M6 拆分,Electron 主进程复用);
// 这里仅保留直接运行时的监听逻辑,并继续导出 app 供测试 fetch 驱动。
// 仅绑定 127.0.0.1(本机单用户工具)。

import { argv } from 'node:process';
import { pathToFileURL } from 'node:url';

import { config } from './config.js';
import { createApp, startServer } from './app.js';

const app = createApp();

// 直接运行时才监听(便于测试中导入 app 而不占端口)
const invokedDirectly =
  argv[1] && import.meta.url === pathToFileURL(argv[1]).href;
if (invokedDirectly) {
  startServer({ app }).then(({ host, port }) => {
    console.log(`Noita 存档编辑器: http://${host}:${port}`);
    console.log(`工作区存档: ${config.workspaceSave}`);
  });
}

export { app };
