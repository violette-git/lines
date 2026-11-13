// Wraps app.json. LINEMAP_PREVIEW=1 builds a single-bundle web preview for sandboxed viewers.
module.exports = ({ config }) => {
  if (process.env.LINEMAP_PREVIEW === '1') {
    config.plugins = config.plugins.map((p) =>
      p === 'expo-router' ? ['expo-router', { asyncRoutes: { web: false, default: false } }] : p,
    );
  }
  return config;
};
