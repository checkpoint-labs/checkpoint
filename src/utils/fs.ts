import * as fs from 'fs';
import * as util from 'util';

export const exists = util.promisify(fs.exists);
export const mkdir = util.promisify(fs.mkdir);
