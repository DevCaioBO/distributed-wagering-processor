import { readFileSync } from 'node:fs';
import { Migration } from '@mikro-orm/migrations';

function readSql(fileName: string): string {
  return readFileSync(new URL(`../../../../db/migrations/${fileName}`, import.meta.url), 'utf8');
}

export class Migration0001Initial extends Migration {
  override async up(): Promise<void> {
    this.addSql(readSql('0001-initial.up.sql'));
  }

  override async down(): Promise<void> {
    this.addSql(readSql('0001-initial.down.sql'));
  }
}