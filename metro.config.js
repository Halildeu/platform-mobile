const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// Expo SQLite's web entry imports a WASM asset even when durable audio is off.
// https://docs.expo.dev/versions/latest/sdk/sqlite/#web-setup
config.resolver.assetExts = [...new Set([...config.resolver.assetExts, 'wasm'])];
module.exports = config;
