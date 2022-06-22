import pino, { Logger as PinoLogger, LoggerOptions } from 'pino';

// LogLevel to control what levels of logs are
// required.
export enum LogLevel {
  // silent to disable all logging
  Silent = 'silent',
  // fatal to log unrecoverable errors
  Fatal = 'fatal',
  // error to log general errors
  Error = 'error',
  // warn to log alerts or notices
  Warn = 'warn',
  // info to log useful information
  Info = 'info',
  // debug to log debug and trace information
  Debug = 'debug'
}

type Logger = Omit<PinoLogger, 'trace'>;

export const createLogger = (opts: LoggerOptions = {}): Logger => {
  return pino(
    opts,
    pino.destination({
      sync: true
    })
  );
};

// re-export types as it is.
export { Logger, LoggerOptions };
