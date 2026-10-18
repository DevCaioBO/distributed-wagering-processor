import { readFileSync } from 'node:fs';
import { Migration } from '@mikro-orm/migrations';

function readSql(fileName: string): string {
  return readFileSync(new URL(`../../../../db/migrations/${fileName}`, import.meta.url), 'utf8');
}

export class Migration0002MessagingIdempotency extends Migration {
  override async up(): Promise<void> {
    this.addSql(readSql('0002-messaging-idempotency.up.sql'));
  }

  override async down(): Promise<void> {
    this.addSql(readSql('0002-messaging-idempotency.down.sql'));
  }
}
