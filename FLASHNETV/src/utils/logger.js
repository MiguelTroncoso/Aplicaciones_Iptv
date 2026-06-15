// Logger centralizado — silencioso en producción, activo en desarrollo
// En EAS build con profile preview/production, __DEV__ es false
const isDev = typeof __DEV__ !== 'undefined' ? __DEV__ : false;

export const logger = {
  log: (...args) => isDev && console.log(...args),
  error: (...args) => isDev && console.error(...args),
  warn: (...args) => isDev && console.warn(...args),
};

export default logger;
