import { contextBridge, ipcRenderer } from 'electron';

// The only bridge between the sandboxed UI and the main process.
contextBridge.exposeInMainWorld('antibiome', {
  call: (method: string, params?: unknown) => ipcRenderer.invoke('api', method, params),
  /** A phone changed data: refresh open views. */
  onChanged: (fn: () => void) => { const h = () => fn(); ipcRenderer.on('changed', h); return () => { ipcRenderer.removeListener('changed', h); }; },
});
