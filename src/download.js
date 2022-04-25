const fs = require('fs-extra');
const https = require('https');
const http = require('http');

const units = ['bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];

function niceBytes(x) {
  let l = 0;
  let n = parseInt(x, 10) || 0;
  while (n >= 1024 && ++l) {
    n /= 1024;
  }
  return `${n.toFixed(n < 10 && l > 0 ? 1 : 0)} ${units[l]}`;
}

function downloadFile(url, filePath, onProgressCb) {
  return new Promise((resolve, reject) => {
    let total = 0;
    let totalLen = '0 MB';
    let transferred = 0;

    const httpOrHttps = url.startsWith('https') ? https : http;

    const request = httpOrHttps.get(url, (response) => {
      if (response.statusCode === 200) {
        const file = fs.createWriteStream(filePath);

        file.on('error', (err) => {
          request.destroy();
          reject(err);
        });

        response.on('data', (chunk) => {
          transferred += chunk.length;
          const percentage = parseFloat((transferred * 100) / total).toFixed(2);
          if (onProgressCb && typeof onProgressCb === 'function') {
            onProgressCb({
              transferred: niceBytes(transferred),
              percentage,
              total: totalLen,
            });
          }
        });

        response.on('end', () => {
          file.end();
        });

        response.on('error', (err) => {
          file.destroy();
          fs.unlink(filePath, () => reject(err));
        });

        response.pipe(file).once('finish', () => {
          resolve();
        });
      } else if (response.statusCode === 302 || response.statusCode === 301) {
        downloadFile(response.headers.location, filePath, onProgressCb).then(() => resolve());
      } else {
        reject(new Error(`Network error ${response.statusCode}`));
      }
    });

    request.on('response', (res) => {
      total = parseInt(res.headers['content-length'], 10);
      totalLen = niceBytes(total);
    });

    request.on('error', (e) => {
      reject(e);
    });

    request.end();
  });
}

module.exports = { downloadFile, niceBytes };
