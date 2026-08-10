const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// shared/ lives above the app root, so Metro has to be told to watch it and where
// to resolve @shared/* from. Without this the app builds fine in tsc and fails at
// bundle time with "Unable to resolve @shared/types".
const sharedRoot = path.resolve(__dirname, '..', 'shared');
const dataRoot = path.resolve(__dirname, '..', 'data');
config.watchFolders = [sharedRoot, dataRoot];
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  '@shared': sharedRoot,
  '@data': dataRoot,
};

// expo-sqlite runs on wa-sqlite in the browser. Metro has to treat .wasm as an asset,
// and the worker needs SharedArrayBuffer, which browsers only grant to cross-origin
// isolated pages. Neither is needed on iOS or Android — this is web-preview only.
config.resolver.assetExts.push('wasm');

config.server.enhanceMiddleware = (middleware) => (req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  return middleware(req, res, next);
};

module.exports = config;
