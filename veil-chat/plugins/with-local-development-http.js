const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withLocalDevelopmentHttp(config) {
  return withAndroidManifest(config, (result) => {
    const application = result.modResults.manifest.application[0];
    if (process.env.VEIL_ALLOW_DEV_HTTP === '1') {
      application.$['android:usesCleartextTraffic'] = 'true';
    } else {
      delete application.$['android:usesCleartextTraffic'];
    }
    return result;
  });
};
