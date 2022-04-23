const fetch = require('cross-fetch');

const getLatestReleaseTagName = async ({ owner, repo }) => {
  const githubApiReleasesApi = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
  const response = await fetch(githubApiReleasesApi);
  const json = await response.json();
  return json.tag_name || null;
};

const getGithubFeedURL = async ({ owner, repo }) => {
  let githubFeedURL;

  try {
    const latestReleaseTagName = await getLatestReleaseTagName({ owner, repo });
    githubFeedURL = latestReleaseTagName ? `https://github.com/${owner}/${repo}/releases/download/${latestReleaseTagName}/` : null;
  } catch (error) {
    githubFeedURL = null;
  }
  return githubFeedURL;
};

module.exports = {
  getGithubFeedURL,
};
