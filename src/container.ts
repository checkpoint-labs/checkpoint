import { BaseIndexer } from './providers';
import { CheckpointConfig, CheckpointOptions } from './types';
import { CheckpointsStore, MetadataId } from './stores/checkpoints';
import { Logger } from './utils/logger';
import { getConfigChecksum } from './utils/checkpoint';
import { GqlEntityController } from './graphql/controller';
import { Knex } from 'knex';

const SCHEMA_VERSION = 1;

export class Container {
  private indexerName: string;

  public config: CheckpointConfig;
  public opts?: CheckpointOptions;
  public schema: string;

  private store: CheckpointsStore;
  private readonly log: Logger;
  private readonly indexer: BaseIndexer;
  private readonly entityController: GqlEntityController;
  private knex: Knex;

  constructor(
    indexerName: string,
    log: Logger,
    knex: Knex,
    store: CheckpointsStore,
    config: CheckpointConfig,
    indexer: BaseIndexer,
    schema: string,
    opts?: CheckpointOptions
  ) {
    this.indexerName = indexerName;
    this.log = log;
    this.knex = knex;
    this.store = store;
    this.config = config;
    this.indexer = indexer;
    this.schema = schema;
    this.opts = opts;

    this.entityController = new GqlEntityController(this.schema, config);
  }

  /**
   * Reset will clear the last synced block informations
   * and force Checkpoint to start indexing from the start
   * block.
   *
   * This will also clear all indexed GraphQL entity records.
   *
   * This should be called when there has been a change to the GraphQL schema
   * or a change to the writer functions logic, so indexing will re-run from
   * the starting block. Also, it should be called the first time Checkpoint
   * is being initialized.
   *
   */
  public async reset() {
    await this.store.createStore();
    await this.store.setMetadata(this.indexerName, MetadataId.LastIndexedBlock, 0);
    await this.store.setMetadata(this.indexerName, MetadataId.SchemaVersion, SCHEMA_VERSION);
    await this.store.removeBlocks(this.indexerName);

    await this.entityController.createEntityStores(this.knex);
  }

  /**
   * Resets Checkpoint's internal tables (including checkpoints).
   *
   * Calling this function will cause next run of checkpoint to start syncing
   * from the start, block-by-block, until new checkpoints are found.
   *
   */
  public async resetMetadata() {
    await this.store.resetStore();
    await this.store.setMetadata(this.indexerName, MetadataId.SchemaVersion, SCHEMA_VERSION);
  }

  public getConfigStartBlock() {
    if (this.config.start && (this.config.tx_fn || this.config.global_events)) {
      return this.config.start;
    }

    return Math.min(...(this.config.sources?.map(source => source.start) || []));
  }

  public async getStartBlockNum() {
    const start = this.getConfigStartBlock();
    const lastBlock =
      (await this.store.getMetadataNumber(this.indexerName, MetadataId.LastIndexedBlock)) ?? 0;

    const nextBlock = lastBlock + 1;

    return nextBlock > start ? nextBlock : start;
  }

  public validateConfig() {
    const sources = this.config.sources ?? [];
    const templates = Object.values(this.config.templates ?? {});

    const usedAbis = [
      ...sources.map(source => source.abi),
      ...templates.map(template => template.abi)
    ].filter(abi => abi) as string[];
    const usedWriters = [
      ...sources.flatMap(source => source.events),
      ...templates.flatMap(template => template.events)
    ];

    const missingAbis = usedAbis.filter(abi => !this.opts?.abis?.[abi]);
    const missingWriters = usedWriters.filter(
      writer => !this.indexer.getHandlers().includes(writer.fn)
    );

    if (missingAbis.length > 0) {
      throw new Error(
        `Following ABIs are used (${missingAbis.join(', ')}), but they are missing in opts.abis`
      );
    }

    if (missingWriters.length > 0) {
      throw new Error(
        `Following writers are used (${missingWriters
          .map(writer => writer.fn)
          .join(', ')}), but they are not defined`
      );
    }
  }

  public async validateStore() {
    const networkIdentifier = await this.indexer.getProvider().getNetworkIdentifier();
    const configChecksum = getConfigChecksum(this.config);

    const storedNetworkIdentifier = await this.store.getMetadata(
      this.indexerName,
      MetadataId.NetworkIdentifier
    );
    const storedStartBlock = await this.store.getMetadataNumber(
      this.indexerName,
      MetadataId.StartBlock
    );
    const storedConfigChecksum = await this.store.getMetadata(
      this.indexerName,
      MetadataId.ConfigChecksum
    );
    const storedSchemaVersion = await this.store.getMetadataNumber(
      this.indexerName,
      MetadataId.SchemaVersion
    );

    const hasNetworkChanged =
      storedNetworkIdentifier && storedNetworkIdentifier !== networkIdentifier;
    const hasStartBlockChanged =
      storedStartBlock && storedStartBlock !== this.getConfigStartBlock();
    const hasConfigChanged = storedConfigChecksum && storedConfigChecksum !== configChecksum;
    const hasSchemaChanged = storedSchemaVersion !== SCHEMA_VERSION;

    if (
      (hasNetworkChanged || hasStartBlockChanged || hasConfigChanged || hasSchemaChanged) &&
      this.opts?.resetOnConfigChange
    ) {
      await this.resetMetadata();
      await this.reset();

      await this.store.setMetadata(
        this.indexerName,
        MetadataId.NetworkIdentifier,
        networkIdentifier
      );
      await this.store.setMetadata(
        this.indexerName,
        MetadataId.StartBlock,
        this.getConfigStartBlock()
      );
      await this.store.setMetadata(this.indexerName, MetadataId.ConfigChecksum, configChecksum);
    } else if (hasNetworkChanged) {
      this.log.error(
        `network identifier changed from ${storedNetworkIdentifier} to ${networkIdentifier}.
        You probably should reset the database by calling .reset() and resetMetadata().
          You can also set resetOnConfigChange to true in Checkpoint options to do this automatically.`
      );

      throw new Error('network identifier changed');
    } else if (hasStartBlockChanged) {
      this.log.error(
        `start block changed from ${storedStartBlock} to ${this.getConfigStartBlock()}.
        You probably should reset the database by calling .reset() and resetMetadata().
        You can also set resetOnConfigChange to true in Checkpoint options to do this automatically.`
      );

      throw new Error('start block changed');
    } else if (hasConfigChanged) {
      this.log.error(
        `config checksum changed from ${storedConfigChecksum} to ${configChecksum} to due to a change in the config.
          You probably should reset the database by calling .reset() and resetMetadata().
          You can also set resetOnConfigChange to true in Checkpoint options to do this automatically.`
      );

      throw new Error('config changed');
    } else if (hasSchemaChanged) {
      this.log.error(
        `schema version changed from ${storedSchemaVersion} to ${SCHEMA_VERSION}.
          You probably should reset the database by calling .reset() and resetMetadata().
          You can also set resetOnConfigChange to true in Checkpoint options to do this automatically.`
      );

      throw new Error('schema changed');
    } else {
      if (!storedNetworkIdentifier) {
        await this.store.setMetadata(
          this.indexerName,
          MetadataId.NetworkIdentifier,
          networkIdentifier
        );
      }

      if (!storedStartBlock) {
        await this.store.setMetadata(
          this.indexerName,
          MetadataId.StartBlock,
          this.getConfigStartBlock()
        );
      }

      if (!storedConfigChecksum) {
        await this.store.setMetadata(this.indexerName, MetadataId.ConfigChecksum, configChecksum);
      }
    }
  }
}
