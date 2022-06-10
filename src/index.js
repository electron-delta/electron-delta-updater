const { EventEmitter } = require('events');
const electron = require('electron');

const path = require('path');
const crypto = require('crypto');
const fs = require('fs-extra');
const fetch = require('cross-fetch');
const semver = require('semver');
const { spawnSync } = require('child_process');
const yaml = require('yaml');

const { downloadFile, niceBytes } = require('./download');

const { getGithubFeedURL } = require('./github-provider');
const { getGenericFeedURL } = require('./generic-provider');
const { newBaseUrl, newUrlFromBase } = require('./utils');

const { getStartURL, getWindow, dispatchEvent } = require('./splash');

const { app, BrowserWindow, Notification } = electron;
const oneMinute = 60 * 1000;
const fifteenMinutes = 15 * oneMinute;

const macUpdaterPath = path.join(__dirname, './mac-updater/build/mac-updater');
const hpatchzPath = path.join(__dirname, './mac-updater/build/hpatchz');

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
    this.hostURL = options.hostURL || null;

    if (app.isPackaged) {
      this.setConfigPath();
      this.prepareUpdater();
    }
  }

  setConfigPath() {
    const updateConfigPath = path.join(process.resourcesPath, 'app-update.yml');
    this.updateConfig = yaml.parse(fs.readFileSync(updateConfigPath, 'utf8'));
  }

  async guessHostURL() {
    if (!this.updateConfig) { return null; }

    let hostURL = null;
    try {
      switch (this.updateConfig.provider) {
        case 'github':
          hostURL = await getGithubFeedURL(this.updateConfig);
          break;
        case 'generic':
          hostURL = await getGenericFeedURL(this.updateConfig);
          break;
        default:
          hostURL = await this.computeHostURL();
      }
    } catch (e) { this.logger.error('[Updater] Guess host url error ', e); }
    if (!hostURL) {
      return null;
    }
    hostURL = newBaseUrl(hostURL);
    return hostURL;
  }

  async computeHostURL() {
    const provider = await this.autoUpdater.clientPromise;
    return provider.baseUrl.href;
  }

  prepareUpdater() {
    const channel = getChannel();
    if (!channel) return;

    this.logger.info('[Updater]  CHANNEL = ', channel);
    this.autoUpdater.channel = channel;
    this.autoUpdater.logger = this.logger;

    this.autoUpdater.allowDowngrade = false;
    this.autoUpdater.autoDownload = false;
    this.autoUpdater.autoInstallOnAppQuit = false;

    this.deltaUpdaterRootPath = path.join(
      app.getPath('appData'),
      `../Local/${this.updateConfig.updaterCacheDirName}`,
    );

    this.updateDetailsJSON = path.join(this.deltaUpdaterRootPath, './update-details.json');
    this.deltaHolderPath = path.join(this.deltaUpdaterRootPath, './deltas');

    if (app.isPackaged && process.platform === 'darwin') {
      this.macUpdaterPath = path.join(this.deltaUpdaterRootPath, 'mac-updater');
      this.hpatchzPath = path.join(this.deltaUpdaterRootPath, 'hpatchz');
      // https://developer.apple.com/forums/thread/130313?answerId=410704022#410704022
      fs.moveSync(macUpdaterPath, this.macUpdaterPath, {
        overwrite: true,
      });
      fs.moveSync(hpatchzPath, this.hpatchzPath, {
        overwrite: true,
      });
    }
  }

  checkForUpdates() {
    this.logger.log('[Updater] Checking for updates...');
    if (this.updateConfig.provider === 'github') {
      // special case for github, we need to get the latest release as delta-win/mac.json is
      // hosted at the root of the new release eg:
      // https://github.com/${owner}/${repo}/releases/download/${latestReleaseTagName}/delta-{win/mac}.json

      getGithubFeedURL(this.updateConfig).then((hostURL) => {
        this.logger.log('[Updater] github hostURL = ', hostURL);
        this.hostURL = newBaseUrl(hostURL);
        this.autoUpdater.checkForUpdates();
      })
      .catch((err) => {
        // when update check fails the updaterWindow needs to be close, loads the app's current version.
        this.logger.error(`[Updater] check for updates failed.`);
        dispatchEvent(this.updaterWindow, 'error', error);
        this.updaterWindow.close();
        this.updaterWindow = null;
      });
    } else {
      this.autoUpdater.checkForUpdates();
    }
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

  async setFeedURL(feedURL) {
    try {
      this.logger.log('[Updater] Setting Feed URL for native updater: ', feedURL);
      await this.autoUpdater.setFeedURL(feedURL);
    } catch (e) {
      this.logger.error('[Updater] FeedURL set error ', e);
    }
  }

  createSplashWindow() {
    this.updaterWindow = getWindow();
  }

  attachListeners(resolve, reject) {
    // if (!app.isPackaged) {
    //   resolve();
    //   return;
    // }
    this.autoUpdater.removeAllListeners();
    this.pollForUpdates();

    this.logger.log('[Updater] Attaching listeners');

    this.autoUpdater.on('checking-for-update', () => {
      this.logger.log('[Updater] Checking for update');
      dispatchEvent(this.updaterWindow, 'checking-for-update');
    });

    this.autoUpdater.on('error', (error) => {
      this.logger.error('[Updater] Error: ', error);
      this.emit('error', error);
      dispatchEvent(this.updaterWindow, 'error', error);
      reject(error);
    });

    this.autoUpdater.on('update-available', async (info) => {
      this.logger.info('[Updater] Update available ', info);
      this.emit('update-available', info);
      dispatchEvent(this.updaterWindow, 'update-available', info);

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

    this.autoUpdater.on('download-progress', (info) => {
      this.emit('download-progress', info);
      dispatchEvent(this.updaterWindow, 'download-progress', {
        percentage: parseFloat(info.percent).toFixed(1),
        transferred: niceBytes(info.transferred),
        total: niceBytes(info.total),
      });
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

    this.autoUpdater.on('update-not-available', () => {
      this.logger.info('[Updater] Update not available');
      this.emit('update-not-available');
      dispatchEvent(this.updaterWindow, 'update-not-available');
      resolve();
    });

    this.autoUpdater.on('update-downloaded', (info) => {
      this.logger.info('[Updater] Update downloaded ', info);
      this.emit('update-downloaded', info);
      dispatchEvent(this.updaterWindow, 'update-downloaded', info);
      this.handleUpdateDownloaded(info);
      resolve();
    });
  }

  quitAndInstall() {
    this.logger.info('[Updater] Quit and Install');

    if (!this.autoUpdateInfo) {
      this.logger.info('[Updater] No update available');
      return;
    }

    setTimeout(async () => {
      if (this.autoUpdateInfo.delta) {
        this.logger.info('[Updater] Applying delta update');
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

  async handleUpdateDownloaded(info) {
    this.autoUpdateInfo = info; // important to save this info for later
    if (this.updaterWindow) {
      this.logger.info('[Updater] Triggering update');
      this.quitAndInstall();
    } else {
      this.logger.info('[Updater] No splash window found. Show notification only.');
      this.showUpdateNotification(this.autoUpdateInfo);
    }
  }

  showUpdateNotification(info) {
    const notification = new Notification({
      title: `${getAppName()} ${info.version} is available and will be installed on exit.`,
      body: 'Click to apply update now.',
      silent: true,
    });
    notification.show();
    notification.on('click', () => {
      this.quitAndInstall();
    });
  }

  async boot() {
    this.logger.info('[Updater] Booting');
    if (!this.hostURL && process.platform === 'win32') {
      this.hostURL = await this.guessHostURL();
    }

    try {
      await new Promise((resolve, reject) => {
        const startURL = getStartURL();
        this.createSplashWindow();
        this.updaterWindow.loadURL(startURL);
        this.attachListeners(resolve, reject);
      });
    } catch (e) {
      this.logger.error('[Updater] Boot error ', e);
      if (this.updaterWindow && !this.updaterWindow.isDestroyed()) {
        this.updaterWindow.close();
        this.updaterWindow = null;
      }
    }
    if (this.updaterWindow) {
      await new Promise((resolve) => {
        setTimeout(() => {
          if (this.updaterWindow && !this.updaterWindow.isDestroyed()) {
            this.updaterWindow.close();
            this.updaterWindow = null;
            resolve();
          } else {
            resolve();
          }
        }, 300);
      });
    }
    return Promise.resolve();
  }

  getDeltaURL({ deltaPath }) {
    return newUrlFromBase(deltaPath, this.hostURL);
  }

  getDeltaJSONUrl() {
    const jsonFileName = process.platform === 'win32' ? 'delta-win.json' : 'delta-mac.json';
    return newUrlFromBase(jsonFileName, this.hostURL);
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

    const deltaJSONUrl = this.getDeltaJSONUrl();
    let deltaJSON = null;
    try {
      this.logger.info(`[Updater] Fetching delta JSON from ${deltaJSONUrl}`);
      const response = await fetch(deltaJSONUrl);
      if (response.status !== 200) {
        this.logger.error(
          `[Updater] Error fetching ${deltaJSONUrl}: ${response.status}`,
        );
      } else {
        deltaJSON = await response.json();
      }
    } catch (err) {
      this.logger.error('Fetch failed ', deltaJSONUrl);
    }

    if (!deltaJSON) {
      this.logger.error('[Updater] No delta found');
      this.autoUpdater.downloadUpdate();
      return;
    }

    const deltaDetails = deltaJSON[appVersion];

    if (!deltaDetails) {
      this.logger.error('[Updater] No delta found for this version ', appVersion);
      this.autoUpdater.downloadUpdate();
      return;
    }

    const deltaURL = this.getDeltaURL({ deltaPath: deltaDetails.path });
    this.logger.info('[Updater] Delta URL ', deltaURL);

    const shaVal = deltaDetails.sha256;

    if (!shaVal) {
      this.logger.info(
        '[Updater] SHA of delta could not be fetched. Trying normal download',
      );
      this.autoUpdater.downloadUpdate();
      return;
    }

    const deltaPath = path.join(this.deltaHolderPath, deltaDetails.path);

    if (fs.existsSync(deltaPath) && isSHACorrect(deltaPath, shaVal)) {
      // cached downloaded file is good to go
      this.logger.info('[Updater] Delta file is already present ', deltaPath);
      deltaDownloaded(deltaPath);
      return;
    }

    this.logger.info('[Updater] Start downloading delta file ', deltaURL);

    await fs.ensureDir(this.deltaHolderPath);

    const onProgressCb = ({ percentage, transferred, total }) => {
      this.logger.info(`downladed=${percentage}%, transferred = ${transferred} / ${total}`);
      this.emit('download-progress', { percentage, transferred, total });
      dispatchEvent(this.updaterWindow, 'download-progress', {
        percentage: parseFloat(percentage).toFixed(1),
        transferred: niceBytes(transferred),
        total: niceBytes(total),
      });
    };

    try {
      await downloadFile(deltaURL, deltaPath, onProgressCb.bind(this));
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
      if (process.platform === 'darwin') {
        this.logger.info('[Updater] Applying delta update on macOS ', this.macUpdaterPath, this.hpatchzPath);
        spawnSync(this.macUpdaterPath, [
          getAppName(),
          deltaPath,
          this.hpatchzPath,
        ], {
          detached: true,
          stdio: 'inherit',
        });
      } else {
        spawnSync(deltaPath, {
          detached: true,
          stdio: 'ignore',
        });
      }
      app.isQuitting = true;
      app.quit();
    } catch (err) {
      this.log.info('[Updater] Apply delta error ', err);
    }
  }
}

module.exports = DeltaUpdater;
