const { ipcRenderer } = require('electron');

const RENDERER_MESSAGE = '@electron-delta/updater:renderer';
const MAIN_MESSAGE = '@electron-delta/updater:main';

process.once('loaded', () => {
  window.addEventListener(RENDERER_MESSAGE, (event) => {
    ipcRenderer.send(RENDERER_MESSAGE, event.detail);
  });

  ipcRenderer.removeAllListeners(MAIN_MESSAGE);

  ipcRenderer.on(MAIN_MESSAGE, (event, data) => {
    window.dispatchEvent(new CustomEvent(MAIN_MESSAGE, { detail: data }));
  });
});
