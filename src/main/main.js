/**
 * Processo Principal do Electron — Whattz (Controle de Consumo de Energia Elétrica - Maricá/RJ)
 */

const { app, BrowserWindow, Menu, ipcMain, dialog, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { FileStorage } = require('./storage');
const { calculateInvoice } = require('./calculator');

let mainWindow = null;
let storage = null;

// Define o identificador da aplicação para associação correta do ícone no Linux (GNOME Wayland/X11) e Windows
app.setName('whattz');
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('class', 'whattz');
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
  app.setDesktopName('whattz.desktop');
}
app.setAppUserModelId('br.com.whattz.energia');

function buildNativeMenu() {
  const template = [
    {
      label: 'Arquivo',
      submenu: [
        {
          label: 'Recarregar Interface',
          accelerator: 'CmdOrCtrl+R',
          click: () => { if (mainWindow) mainWindow.reload(); }
        },
        { type: 'separator' },
        {
          label: 'Sair',
          accelerator: 'CmdOrCtrl+Q',
          click: () => app.quit()
        }
      ]
    },
    {
      label: 'Créditos & Sobre',
      submenu: [
        {
          label: 'Sobre o Desenvolvedor (Leandro Mendonça)',
          click: () => {
            if (!mainWindow) return;
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Créditos do Desenvolvedor — Whattz E360',
              message: 'Whattz E360 — Controle Diário de Energia Elétrica (v1.0.0)',
              detail:
                'Autor / Desenvolvedor: Leandro Mendonça\n' +
                'Ano de Criação: 2026\n' +
                'Copyright © 2026 Leandro Mendonça. Todos os direitos reservados.\n' +
                'Licença: MIT License\n\n' +
                'Aplicativo desktop desenvolvido em Electron para controle diário do medidor de energia elétrica e cálculo tarifário preciso da Enel Distribuição Rio no município de Maricá (RJ).'
            });
          }
        },
        { type: 'separator' },
        {
          label: 'Ferramentas do Desenvolvedor (DevTools)',
          accelerator: 'F12',
          click: () => {
            if (mainWindow) mainWindow.webContents.toggleDevTools();
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createWindow() {
  const userDataDir = path.join(app.getPath('userData'), 'data');
  storage = new FileStorage(userDataDir);
  buildNativeMenu();

  const iconPath = path.join(__dirname, '../../assets/icon.png');
  const appIcon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : undefined;

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1024,
    minHeight: 700,
    title: 'Whattz E360 — Controle de Energia Elétrica (Maricá / Enel RJ)',
    icon: appIcon || iconPath,
    backgroundColor: '#f8fafc',
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

function registerIpcHandlers() {
  ipcMain.handle('whattz:getState', async () => {
    return storage.getFullState();
  });

  ipcMain.handle('whattz:setActivePeriod', async (_event, periodId) => {
    return storage.setActivePeriod(periodId);
  });

  ipcMain.handle('whattz:upsertReading', async (_event, { periodId, reading }) => {
    return storage.upsertReading(periodId, reading);
  });

  ipcMain.handle('whattz:deleteReading', async (_event, { periodId, date }) => {
    return storage.deleteReading(periodId, date);
  });

  ipcMain.handle('whattz:updatePeriodMetadata', async (_event, { periodId, metadata }) => {
    return storage.updatePeriodMetadata(periodId, metadata);
  });

  ipcMain.handle('whattz:createNewPeriod', async (_event, payload) => {
    return storage.createNewPeriod(payload);
  });

  ipcMain.handle('whattz:updateTariffConfig', async (_event, { periodId, config, applyAsGlobalDefault }) => {
    return storage.updateTariffConfig(periodId, config, applyAsGlobalDefault);
  });

  ipcMain.handle('whattz:simulateInvoice', async (_event, { consumoKwh, config, options }) => {
    return calculateInvoice(consumoKwh, config, options);
  });

  ipcMain.handle('whattz:loadSampleData', async () => {
    return storage.loadSampleData();
  });

  ipcMain.handle('whattz:exportBackup', async () => {
    const json = storage.exportBackupJson();
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Exportar Backup de Leituras e Tarifas (Whattz)',
      defaultPath: `whattz-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'Arquivo JSON', extensions: ['json'] }]
    });

    if (canceled || !filePath) {
      return { exported: false };
    }

    fs.writeFileSync(filePath, json, 'utf-8');
    return { exported: true, filePath };
  });

  ipcMain.handle('whattz:importBackup', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Importar Backup de Leituras e Tarifas (Whattz)',
      properties: ['openFile'],
      filters: [{ name: 'Arquivo JSON', extensions: ['json'] }]
    });

    if (canceled || !filePaths || filePaths.length === 0) {
      return { imported: false };
    }

    const raw = fs.readFileSync(filePaths[0], 'utf-8');
    const state = storage.importBackupJson(raw);
    return { imported: true, state };
  });
}
