import { register } from '../register';

export default class Model {
  private tableName: string;
  private values = new Map<string, any>();
  private valuesImplicitlySet = new Set<string>();
  private exists = false;

  constructor(tableName: string) {
    this.tableName = tableName;
  }

  private async _update() {
    const knex = register.getKnex();
    const currentBlock = register.getCurrentBlock();

    const diff = Object.fromEntries(
      [...this.values.entries()].filter(([key]) => this.valuesImplicitlySet.has(key))
    );

    return knex.transaction(async trx => {
      await trx
        .table(this.tableName)
        .where('id', this.get('id'))
        .andWhereRaw('upper_inf(block_range)')
        .update({
          block_range: knex.raw('int8range(lower(block_range), ?)', [currentBlock])
        });

      const newEntity = {
        ...Object.fromEntries(this.values.entries()),
        ...diff
      };
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { uid, ...currentValues } = newEntity;

      await trx.table(this.tableName).insert({
        ...currentValues,
        block_range: knex.raw('int8range(?, NULL)', [currentBlock])
      });
    });
  }

  private async _insert() {
    const currentBlock = register.getCurrentBlock();

    const entity = Object.fromEntries(this.values.entries());

    return register
      .getKnex()
      .table(this.tableName)
      .insert({
        ...entity,
        block_range: register.getKnex().raw('int8range(?, NULL)', [currentBlock])
      });
  }

  private async _delete() {
    const currentBlock = register.getCurrentBlock();

    return register
      .getKnex()
      .table(this.tableName)
      .where('id', this.get('id'))
      .update({
        block_range: register.getKnex().raw('int8range(lower(block_range), ?)', [currentBlock])
      });
  }

  setExists() {
    this.exists = true;
  }

  initialSet(key: string, value: any) {
    this.values.set(key, value);
  }

  get(key: string): any {
    return this.values.get(key) ?? null;
  }

  set(key: string, value: any) {
    this.values.set(key, value);
    this.valuesImplicitlySet.add(key);
  }

  static async _loadEntity(
    tableName: string,
    id: string | number
  ): Promise<Record<string, any> | null> {
    const knex = register.getKnex();

    const entity = await knex
      .table(tableName)
      .select('*')
      .where('id', id)
      .andWhereRaw('upper_inf(block_range)')
      .first();
    if (!entity) return null;

    return entity;
  }

  async save() {
    if (this.exists) return this._update();
    return this._insert();
  }

  async delete() {
    if (this.exists) this._delete();
  }
}
