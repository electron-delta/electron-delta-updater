# @electron-delta/updater

### Delta AutoUpdater module for [`@electron-delta/builder`](https://github.com/electron-delta/electron-delta)

## Features

1. Discord like splash screen auto updater while booting the app
2. Works with [`@electron-delta/builder`](https://github.com/electron-delta/electron-delta), automatically uses delta updates for Windows NSIS
3. sha256 checksum for delta updates

![Delta updates](https://electrondelta.com/assets/delta-downloading.png)
## Installation

```bash
npm install @electron-delta/updater
```
## Example

```js
const DeltaUpdater = require("@electron-delta/updater");
const { app, BrowserWindow } = require("electron");

app.whenReady().then(async () => {

  const deltaUpdater = new DeltaUpdater({
    logger: require('electron-log'),
    // optionally set the autoUpdater from electron-updater
    autoUpdater: require("electron-updater").autoUpdater,
    // Where delta.json is hosted, for github provider it's not required to set the hostURL
    hostURL: "https://example.com/updates/windows/",
  });

  try {
    await deltaUpdater.boot();
  } catch (error) {
    logger.error(error);
  }
  // create main app window after the deltaUpdater.boot()
  createMainWindow();

});
```

Check the sample repo for full integration example with @electron-delta/updater
[electron-sample-app](https://github.com/electron-delta/electron-sample-app)
