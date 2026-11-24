/**
 * Preload Script — Ponte Segura (contextBridge) entre Renderer e Processo Principal do Electron
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('whattzAPI', {
  getState: () => ipcRenderer.invoke('whattz:getState'),
  setActivePeriod: (periodId) => ipcRenderer.invoke('whattz:setActivePeriod', periodId),
  upsertReading: (periodId, reading) => ipcRenderer.invoke('whattz:upsertReading', { periodId, reading }),
  deleteReading: (periodId, date) => ipcRenderer.invoke('whattz:deleteReading', { periodId, date }),
  updatePeriodMetadata: (periodId, metadata) => ipcRenderer.invoke('whattz:updatePeriodMetadata', { periodId, metadata }),
  createNewPeriod: (payload) => ipcRenderer.invoke('whattz:createNewPeriod', payload),
  deletePeriod: (periodId) => ipcRenderer.invoke('whattz:deletePeriod', periodId),
  updateTariffConfig: (periodId, config, applyAsGlobalDefault = true) =>
    ipcRenderer.invoke('whattz:updateTariffConfig', { periodId, config, applyAsGlobalDefault }),
  simulateInvoice: (consumoKwh, config, options) =>
    ipcRenderer.invoke('whattz:simulateInvoice', { consumoKwh, config, options }),
  loadSampleData: () => ipcRenderer.invoke('whattz:loadSampleData'),
  exportBackup: () => ipcRenderer.invoke('whattz:exportBackup'),
  importBackup: () => ipcRenderer.invoke('whattz:importBackup')
});
