const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

let config = getDefaultConfig(__dirname);
config = withNativeWind(config, { input: './global.css' });

module.exports = config;
