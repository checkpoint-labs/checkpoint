import path from 'path';
import fs from 'fs/promises';
import process from 'process';
import { codegen } from '../codegen';

const DEFAULT_SCHEMA_PATH = 'src/schema.gql';
const OUTPUT_PATH = 'codegen/models.ts';

async function run() {
  if (process.argv[2] !== 'codegen') {
    console.log('Usage:\n\tcheckpoint codegen');
    process.exit(1);
  }

  const schemaFile = process.argv[3] ?? DEFAULT_SCHEMA_PATH;

  console.log('Generating models from schema:', schemaFile);

  const cwd = process.cwd();
  const schemaFilePath = path.join(cwd, schemaFile);
  const schema = await fs.readFile(schemaFilePath, 'utf8');

  const generatedModels = codegen(schema);

  await fs.mkdir(path.join(cwd, 'codegen'), { recursive: true });
  await fs.writeFile(path.join(cwd, OUTPUT_PATH), generatedModels);

  console.log('Models generated to', OUTPUT_PATH);
}

run();
