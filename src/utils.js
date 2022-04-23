function newBaseUrl(url) {
  const result = new URL(url);
  if (!result.pathname.endsWith('/')) {
    result.pathname += '/';
  }
  return result.href;
}

function newUrlFromBase(pathname, baseUrl, addRandomQueryToAvoidCaching = false) {
  const result = new URL(pathname, baseUrl);
  const { search } = baseUrl;
  if (search != null && search.length !== 0) {
    result.search = search;
  } else if (addRandomQueryToAvoidCaching) {
    result.search = `noCache=${Date.now().toString(32)}`;
  }
  return result.href;
}

module.exports = { newBaseUrl, newUrlFromBase };
