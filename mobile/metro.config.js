const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Add support for the shared package (append to default watchFolders)
config.watchFolders = [
  ...config.watchFolders,
  path.resolve(__dirname, '../shared'),
];

// Ensure TypeScript files are resolved correctly
config.resolver.sourceExts = [
  ...config.resolver.sourceExts,
  'ts',
  'tsx',
];

module.exports = config;
