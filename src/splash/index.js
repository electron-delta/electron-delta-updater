const { BrowserWindow } = require('electron');
const path = require('path');
const url = require('url');

const MAIN_MESSAGE = '@electron-delta/updater:main';

const getWindow = () => new BrowserWindow({
  width: 350,
  height: 120,
  resizable: false,
  frame: false,
  show: true,
  titleBarStyle: 'hidden',
  backgroundColor: '#f64f59',
  fullscreenable: false,
  skipTaskbar: false,
  center: true,
  movable: false,
  webPreferences: {
    nodeIntegration: false,
    contextIsolation: true,
    enableRemoteModule: false,
    disableBlinkFeatures: 'Auxclick',
    sandbox: true,
    preload: path.join(__dirname, 'preload.js'),
  },
});

function getStartURL() {
  return url
    .pathToFileURL(path.join(__dirname, 'splash.html'))
    .toString();
}

function dispatchEvent(updaterWindow, eventName, payload) {
  if (updaterWindow && !updaterWindow.isDestroyed()) {
    updaterWindow.webContents.send(MAIN_MESSAGE, { eventName, payload });
  }
}

module.exports = { getWindow, getStartURL, dispatchEvent };
