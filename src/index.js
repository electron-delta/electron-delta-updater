const { EventEmitter } = require("events");
const electron = require("electron");

const path = require("path");
const url = require("url");
const fs = require("fs-extra");
const fetch = require("cross-fetch");
const { spawnSync } = require("child_process");

const { downloadFile, niceBytes } = require("./download");

const { app, BrowserWindow } = electron;

const oneMinute = 60 * 1000;
const tenMinutes = 10 * oneMinute;
const fifteenMinutes = 15 * oneMinute;
const oneHour = 6 * tenMinutes;

class DeltaUpdater extends EventEmitter {
  constructor(options) {
    super();
    this.logger = options.logger || console;
    this.autoUpdater =
      options.autoUpdater || require("electron-updater").autoUpdater;

    this._prepareUpdater();
    this._attachListeners();
  }

  _getChannel() {
    const version = app.getVersion();
    const preRelease = semver.prerelease(version);
    if (!preRelease) return "latest";

    return preRelease[0];
  }

  _getAppName() {
    return app.getName();
  }

  _prepareUpdater() {
    if (process.platform === "win32") {
      const channel = this._getChannel();
      if (!channel) return;

      this.logger.info("[Updater]  CHANNEL = ", channel);

      this.autoUpdater.channel = channel;
      this.autoUpdater.allowDowngrade = false;
      this.autoUpdater.autoDownload = false;
      this.autoUpdater.autoInstallOnAppQuit = false;
      this.autoUpdater.logger = this.logger;
    }
  }

  _attachListeners() {
    this._pollForUpdates();

    this.logger.log("[Updater] Attaching listeners");

    this.autoUpdater.on("error", (error) => {
      this.logger.error("[Updater] Error: ", error);
    });

    this.logger.log("get feed url ", this.autoUpdater.getFeedURL());
  }

  async bootApp() {}

  _checkForUpdates() {
    autoUpdater.checkForUpdates();
  }

  _pollForUpdates() {
    checkForUpdates();
    setInterval(() => {
      checkForUpdates();
    }, fifteenMinutes);
  }

  _ensureSafeQuitAndInstall() {
    this.logger.info("[Updater] Ensure safe-quit and install");
    app.removeAllListeners("window-all-closed");
    var browserWindows = BrowserWindow.getAllWindows();
    browserWindows.forEach((browserWindow) => {
      browserWindow.removeAllListeners("close");
      if (!browserWindow.isDestroyed()) {
        browserWindow.close();
      }
    });
  }

  async downloadUpdate() {}

  async quitAndInstall() {}
}
