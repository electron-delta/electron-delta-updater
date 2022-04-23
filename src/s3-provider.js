const getS3FeedURL = async (updateConfig) => {
  const { bucket } = updateConfig;
  if (!bucket) {
    return null;
  }

  return `https://${bucket}.s3.${updateConfig.region ? `${updateConfig.region}.` : ''}amazonaws.com/${updateConfig.path || ''}`;
};

module.exports = { getS3FeedURL };
