import * as path from 'path';
import {
  Generator,
  getGenerators,
  getGeneratorSuccessMessage,
  missingGeneratorMessage
} from '@prisma/internals';
import { Migrate } from '@prisma/migrate';
import { Logger } from '../utils/logger';

class GeneratorError extends Error {
  constructor() {
    super('an error occurred while generating checkpoint clients');
  }
}

export class PrismaGenerator {
  private readonly log: Logger;

  constructor(log: Logger) {
    this.log = log.child({ component: 'prisma-generator' });
  }

  public async generatePrismaClient(buildDir: string): Promise<void> {
    try {
      this.log.debug('Generating Database Client');

      // tries to download generators based on what is defined
      // in the generated prisma.schema
      const generators = await getGenerators({
        schemaPath: this.getSchemaPath(buildDir),
        printDownloadProgress: false,
        version: '461d6a05159055555eb7dfb337c9fb271cbd4d7e',
        cliVersion: '3.15.2',
        dataProxy: false
      });

      if (!generators || generators.length === 0) {
        this.log.error('no database generator found');
        this.log.debug(missingGeneratorMessage);
      } else {
        try {
          await this.runGenerate(generators);
        } catch (errRunGenerate) {
          this.log.error({ err: errRunGenerate }, 'failed to generate database clients');
          throw new GeneratorError();
        }
      }
    } catch (errGetGenerators) {
      this.log.error({ err: errGetGenerators }, 'failed to fetch database generator');
      throw new GeneratorError();
    }
  }

  public async syncSchemaWithDatabase(buildDir: string): Promise<void> {
    const migrate = new Migrate(this.getSchemaPath(buildDir));
    try {
      const createMigrationResult = await migrate.createMigration({
        migrationsDirectoryPath: migrate.migrationsDirectoryPath || '',
        migrationName: 'sync_migration',
        draft: false,
        prismaSchema: migrate.getDatamodel()
      });

      this.log.debug({ createMigrationResult }, 'schema migrations creations');

      const { appliedMigrationNames } = await migrate.applyMigrations();
      this.log.debug({ appliedMigrationNames }, 'schema migrations applied');
    } catch (err) {
      this.log.error({ err }, 'failed to sync schemas with database tables');
      throw new GeneratorError();
    } finally {
      migrate.stop();
    }
  }

  private async runGenerate(generators: Generator[]): Promise<void> {
    const message: string[] = [];

    for (const generator of generators) {
      const before = Date.now();
      try {
        await generator.generate();
        const after = Date.now();
        message.push(getGeneratorSuccessMessage(generator, after - before) + '\n');
      } catch (err) {
        throw err;
      } finally {
        generator.stop();
      }
    }

    this.log.debug(message.join('\n'));
  }

  private getSchemaPath(buildDir: string): string {
    return path.join(buildDir, 'prisma', 'schema.prisma');
  }
}
