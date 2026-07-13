const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

// 1. Declare the directory constants correctly
const projectRoot = __dirname;
const frontendRoot = path.resolve(projectRoot, 'frontend');

// 2. Pass the resolved root into the Expo config builder
const config = getDefaultConfig(projectRoot);

// 3. Watch all files in the root and the frontend folder
config.watchFolders = [projectRoot, frontendRoot];

// 4. Force Metro to resolve dependencies from the frontend node_modules first
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(frontendRoot, 'node_modules'),
];

module.exports = config;