import path from 'path';
import fs from 'fs/promises';
import process from 'process';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import { codegen } from '../codegen';
import { CheckpointConfig } from '../types';

const DEFAULT_CONFIG_PATH = 'src/config.json';
const DEFAULT_SCHEMA_PATH = 'src/schema.gql';
const OUTPUT_DIRECTORY = '.checkpoint';

async function generate(schemaFile: string, configFile: string, format: string) {
  if (format !== 'typescript' && format !== 'javascript') {
    throw new Error('Invalid output format');
  }

  console.log('Generating models from schema:', schemaFile);

  const cwd = process.cwd();
  const schemaFilePath = path.join(cwd, schemaFile);
  const configFilePath = path.join(cwd, configFile);

  const schema = await fs.readFile(schemaFilePath, 'utf8');
  const config: CheckpointConfig = await import(configFilePath);

  const generatedModels = codegen(schema, config, format);

  const outputFile = format === 'typescript' ? 'models.ts' : 'models.js';
  const outputPath = path.join(OUTPUT_DIRECTORY, outputFile);

  await fs.mkdir(path.join(cwd, OUTPUT_DIRECTORY), { recursive: true });
  await fs.writeFile(path.join(cwd, outputPath), generatedModels);

  console.log('Models generated to', outputPath);
}

yargs(hideBin(process.argv))
  .command(
    'generate',
    'generate models from schema',
    yargs => {
      return yargs
        .option('schema-file', {
          alias: 's',
          type: 'string',
          default: DEFAULT_SCHEMA_PATH,
          description: 'Schema file path'
        })
        .option('config-file', {
          alias: 'c',
          type: 'string',
          default: DEFAULT_CONFIG_PATH,
          description: 'Config file path'
        })
        .option('output-format', {
          alias: 'f',
          type: 'string',
          default: 'typescript',
          description: 'Output format (typescript or javascript)'
        });
    },
    async argv => {
      try {
        await generate(argv['schema-file'], argv['config-file'], argv['output-format']);
      } catch (err) {
        console.error('Error generating models:', err);
        process.exit(1);
      }
    }
  )
  .demandCommand(1, 'You need to specify a command')
  .parse();
