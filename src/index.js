const { EventEmitter } = require('events');
const electron = require('electron');

const path = require('path');
const crypto = require('crypto');
const url = require('url');
const fs = require('fs-extra');
const fetch = require('cross-fetch');
const semver = require('semver');
const { spawnSync } = require('child_process');

const { downloadFile, niceBytes } = require('./download');

const { app, BrowserWindow } = electron;

const oneMinute = 60 * 1000;

const fifteenMinutes = 15 * oneMinute;

const getChannel = () => {
  const version = app.getVersion();
  const preRelease = semver.prerelease(version);
  if (!preRelease) return 'latest';

  return preRelease[0];
};

const getAppName = () => app.getName();

const computeSHA256 = (filePath) => {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const fileBuffer = fs.readFileSync(filePath);
  const sum = crypto.createHash('sha256');
  sum.update(fileBuffer);
  const hex = sum.digest('hex');
  return hex;
};

const isSHACorrect = (filePath, correctSHA) => {
  try {
    const sha = computeSHA256(filePath);

    return sha === correctSHA;
  } catch (e) {
    return false;
  }
};

class DeltaUpdater extends EventEmitter {
  constructor(options) {
    super();
    this.autoUpdateInfo = null;
    this.logger = options.logger || console;
    this.autoUpdater = options.autoUpdater || require('electron-updater').autoUpdater;
    this.hostURL = options.hostURL;

    this.updateDetailsJSON = path.join(
      app.getPath('appData'),
      `../Local/${getAppName()}-updater/update-details.json`,
    );

    this.deltaHolderPath = path.join(
      app.getPath('appData'),
      `../Local/${getAppName()}-updater/deltas`,
    );
    this.prepareUpdater();
    this.attachListeners();
  }

  prepareUpdater() {
    if (process.platform === 'win32') {
      const channel = this.getChannel();
      if (!channel) return;

      this.logger.info('[Updater]  CHANNEL = ', channel);

      this.autoUpdater.channel = channel;
      this.autoUpdater.allowDowngrade = false;
      this.autoUpdater.autoDownload = false;
      this.autoUpdater.autoInstallOnAppQuit = false;
      this.autoUpdater.logger = this.logger;
    }
  }

  async bootApp() {
    const { Provider } = require('electron-updater');
    this.Provider = Provider;

    const latestVersion = await this.Provider.getLatestVersion();
  }

  checkForUpdates() {
    this.autoUpdater.checkForUpdates();
  }

  pollForUpdates() {
    this.checkForUpdates();
    setInterval(() => {
      this.checkForUpdates();
    }, fifteenMinutes);
  }

  ensureSafeQuitAndInstall() {
    this.logger.info('[Updater] Ensure safe-quit and install');
    app.removeAllListeners('window-all-closed');
    const browserWindows = BrowserWindow.getAllWindows();
    browserWindows.forEach((browserWindow) => {
      browserWindow.removeAllListeners('close');
      if (!browserWindow.isDestroyed()) {
        browserWindow.close();
      }
    });
  }

  async writeAutoUpdateDetails({ isDelta, attemptedVersion }) {
    if (process.platform === 'darwin') return;

    const date = new Date();
    const data = {
      isDelta,
      attemptedVersion,
      appVersion: app.getVersion(),
      timestamp: date.getTime(),
      timeHuman: date.toString(),
    };
    try {
      await fs.writeJSON(this.updateDetailsJSON, data);
    } catch (e) {
      this.logger.error('[Updater] ', e);
    }
  }

  async getAutoUpdateDetails() {
    let data = null;
    try {
      data = await fs.readJSON(this.updateDetailsJSON);
    } catch (e) {
      this.logger.error(`[Updater] ${this.updateDetailsJSON} file not found`);
    }
    return data;
  }

  attachListeners() {
    this.autoUpdater.removeAllListeners();
    this.pollForUpdates();

    this.logger.log('[Updater] Attaching listeners');

    this.autoUpdater.setFeedURL(this.hostURL);

    this.autoUpdater.on('error', (error) => {
      this.logger.error('[Updater] Error: ', error);
    });

    this.autoUpdater.on('update-available', async (info) => {
      this.logger.info('[Updater] Update available ', info);

      const files = await this.Provider.resolveFiles(info);

      this.logger.info('[Updater] Files: ', files);

      // For MacOS, update is downloaded automatically
      if (process.platform === 'darwin') return;

      const updateDetails = await this.getAutoUpdateDetails();
      if (updateDetails) {
        this.logger.info('[Updater] Last Auto Update details: ', updateDetails);
        const appVersion = app.getVersion();
        this.logger.info('[Updater] Current app version ', appVersion);
        if (updateDetails.appVersion === appVersion) {
          this.logger.info(
            '[Updater] Last attempted update failed, trying using normal updater',
          );
          this.autoUpdater.downloadUpdate();
          return;
        }
      }

      this.doSmartDownload(info);
    });

    this.logger.info('[Updater] Added on quit listener');

    app.on('quit', async (event, exitCode) => {
      if (this.autoUpdateInfo) {
        this.logger.info('[Updater] On Quit ', this.autoUpdateInfo);
        if (this.autoUpdateInfo.delta) {
          try {
            spawnSync(this.autoUpdateInfo.deltaPath, ['-norestart'], {
              detached: true,
              stdio: 'ignore',
            });
          } catch (err) {
            this.logger.error('[Updater] Spawn error ', err);
          }
        } else {
          await this.applyUpdate(this.autoUpdateInfo.version, false);
        }
      } else {
        this.logger.info('[Updater] Quitting now. No update available');
      }
    });

    this.autoUpdater.on('update-downloaded', (info) => {
      this.logger.info('[Updater] Update downloaded ', info);
      this.handleUpdateDownloaded(info);
    });
  }

  async handleUpdateDownloaded(info) {
    this.autoUpdateInfo = info;

    this.logger.info('[Updater] Triggering update');
    setTimeout(async () => {
      if (this.autoUpdateInfo.delta) {
        await this.applyDeltaUpdate(
          this.autoUpdateInfo.deltaPath,
          this.autoUpdateInfo.version,
        );
      } else {
        this.logger.info('[Updater] Applying full update');
        await this.applyUpdate(this.autoUpdateInfo.version, true);
      }
    }, 0);
  }

  getDeltaURL({ appVersion, version, channel }) {
    return `${this.hostURL}/${getAppName()}-${appVersion}-to-${getAppName()}-${version}-delta.exe`;
  }

  async doSmartDownload({ version, releaseDate }) {
    const deltaDownloaded = (deltaPath) => {
      this.logger.info(`[Updater] Downloaded ${deltaPath}`);
      this.autoUpdater.emit('update-downloaded', {
        delta: true,
        deltaPath,
        version,
        releaseDate,
      });
    };

    let channel = getChannel();
    if (!channel) return;
    channel = channel === 'latest' ? 'stable' : channel;

    const appVersion = app.getVersion();
    const deltaURL = this.getDeltaURL({ appVersion, version, channel });
    this.logger.info('[Updater] Delta URL ', deltaURL);
    const deltaSHA256URL = `${deltaURL}.sha256`;

    let shaVal = null;

    try {
      const response = await fetch(deltaSHA256URL);
      if (response.status !== 200) {
        this.logger.error(
          `[Updater] Error fetching ${deltaSHA256URL}: ${response.status}`,
        );
      } else {
        shaVal = await response.text();
      }
    } catch (err) {
      this.logger.error('Fetch failed ', deltaSHA256URL);
    }

    if (!shaVal) {
      this.logger.info(
        '[Updater] SHA of delta could not be fetched. Trying normal download',
      );
      this.autoUpdater.downloadUpdate();
      return;
    }

    const deltaPath = path.join(
      this.deltaHolderPath,
      `${getAppName()}-${appVersion}-to-${getAppName()}-${version}.exe`,
    );

    if (fs.existsSync(deltaPath) && isSHACorrect(deltaPath, shaVal)) {
    // cached downloaded file is good to go
      this.logger.info('[Updater] Delta file is already present ', deltaPath);
      deltaDownloaded(deltaPath);
      return;
    }

    this.logger.info('[Updater] Start downloading delta file ', deltaURL);

    await fs.ensureDir(this.deltaHolderPath);

    try {
      const downloadOptions = {
        onProgress: ({ percentage, transferred, total }) => {
          this.logger.info(`percentage = ${percentage}%, transferred = ${transferred}`);
          this.emit('download-progress', { percentage, transferred, total });
          this.autoUpdater.emit('download-progress', { percentage, transferred, total });
        },
      };
      await downloadFile(deltaURL, deltaPath, downloadOptions);
      const isFileGood = isSHACorrect(deltaPath, shaVal);
      if (!isFileGood) {
        this.logger.info(
          '[Updater] Delta downloaded, SHA incorrect. Trying normal download',
        );
        this.autoUpdater.downloadUpdate();
        return;
      }
      deltaDownloaded(deltaPath);
    } catch (err) {
      this.logger.error('[Updater] Delta download error, trying normal download', err);
      this.autoUpdater.downloadUpdate();
    }
  }

  async applyUpdate(version, forceRunAfter = true) {
    this.logger.info('[Updater] Applying normal update');
    await this.writeAutoUpdateDetails({ isDelta: false, attemptedVersion: version });

    this.ensureSafeQuitAndInstall();
    if (process.platform === 'darwin') {
      this.autoUpdater.quitAndInstall();
      return;
    }
    setTimeout(() => this.autoUpdater.quitAndInstall(true, forceRunAfter), 100);
  }

  async applyDeltaUpdate(deltaPath, version) {
    this.logger.info('[Updater] Applying delta update');
    await this.writeAutoUpdateDetails({ isDelta: true, attemptedVersion: version });
    this.ensureSafeQuitAndInstall();
    try {
      spawnSync(deltaPath, {
        detached: true,
        stdio: 'ignore',
      });
      app.isQuitting = true;
      app.quit();
    } catch (err) {
      this.log.info('[Updater] Apply delta error ', err);
    }
  }
}

module.exports = DeltaUpdater;
