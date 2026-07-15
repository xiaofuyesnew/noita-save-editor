// Electron 主进程(M6 桌面壳):在本机随机端口起 Hono 服务,
// BrowserWindow 加载 http://127.0.0.1:<port>/。前端与浏览器模式
// 完全同源复用,无 preload/IPC —— 渲染进程就是一个普通网页。
//
// 环境变量:
//  - NOITA_EDITOR_PORT  固定服务端口(默认 0 = 系统随机分配)
//  - NOITA_SMOKE=1      冒烟模式:只起服务不开窗口(打包产物自动化验证用)

import { app, BrowserWindow, Menu, shell } from 'electron';

// 双开会得到两份互不知情的编辑缓冲,后写盘者覆盖先写者 —— 锁单实例。
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(startDesktop);
}

/** @type {BrowserWindow | undefined} */
let mainWindow;

async function startDesktop() {
  // asar 内不可写:config.local.json 与默认备份目录改挂 userData。
  // 必须在动态 import 服务端代码之前设置(config.js 在模块加载时读取)。
  process.env.NOITA_EDITOR_DATA_DIR ??= app.getPath('userData');

  const { startServer } = await import('../server/app.js');
  const { host, port } = await startServer({
    port: Number(process.env.NOITA_EDITOR_PORT || 0),
  });
  const url = `http://${host}:${port}/`;
  console.log(`Noita 存档编辑器(桌面): ${url}`);

  if (process.env.NOITA_SMOKE === '1') return; // 服务已就绪,冒烟脚本走 HTTP 验证

  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  // 无菜单后保留两个开发者习惯键:F5 刷新、F12 开发者工具
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F5') {
      mainWindow.webContents.reload();
      event.preventDefault();
    } else if (input.key === 'F12') {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  // 页面内的外部链接交给系统浏览器,不在应用里开新窗
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\//.test(target)) shell.openExternal(target);
    return { action: 'deny' };
  });

  await mainWindow.loadURL(url);
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('window-all-closed', () => {
  if (process.env.NOITA_SMOKE !== '1') app.quit();
});
