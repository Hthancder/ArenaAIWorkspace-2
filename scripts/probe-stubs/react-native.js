// Minimal react-native stand-in for the Node source probe (scripts/probe-new-sources.ts)
export const Platform = { OS: 'ios', select: (o) => o.ios ?? o.default };
export default { Platform };
