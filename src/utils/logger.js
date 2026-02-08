/**
 * Production-safe logger utility (BUG-035)
 *
 * Wraps console methods so debug logs are silenced in production builds.
 * console.warn and console.error always pass through (they indicate real issues).
 *
 * Usage:
 *   import log from '../utils/logger';
 *   log('some debug info', data);          // silenced in prod
 *   log.info('[Module]', 'message');        // silenced in prod
 *   log.warn('something fishy');            // always shown
 *   log.error('something broke', err);      // always shown
 */

const isDev = process.env.NODE_ENV === 'development';

const noop = () => {};

const log = isDev ? console.log.bind(console) : noop;
log.info = isDev ? console.log.bind(console) : noop;
log.debug = isDev ? console.debug.bind(console) : noop;
log.warn = console.warn.bind(console);   // always show warnings
log.error = console.error.bind(console); // always show errors

export default log;
