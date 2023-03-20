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
    const diff = Object.fromEntries(
      [...this.values.entries()].filter(([key]) => this.valuesImplicitlySet.has(key))
    );

    return register.getKnex().table(this.tableName).update(diff).where('id', this.get('id'));
  }

  private async _insert() {
    const entity = Object.fromEntries(this.values.entries());

    return register.getKnex().table(this.tableName).insert(entity);
  }

  private async _delete() {
    return register.getKnex().table(this.tableName).where('id', this.get('id')).delete();
  }

  setExists() {
    this.exists = true;
  }

  initialSet(key: string, value: any) {
    this.values.set(key, value);
  }

  get(key: string): any {
    return this.values.get(key) || null;
  }

  set(key: string, value: any) {
    this.values.set(key, value);
    this.valuesImplicitlySet.add(key);
  }

  static async loadEntity(tableName: string, id: string): Promise<Record<string, any> | null> {
    const knex = register.getKnex();

    const entity = await knex.table(tableName).select('*').where('id', id).first();
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
