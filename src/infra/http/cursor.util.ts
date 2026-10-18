export class Cursor {
  static encode(cursor: string | null): string | undefined {
    if (cursor === null) {
      return undefined;
    }
    return Buffer.from(cursor, 'utf8').toString('base64url');
  }

  static decode(encoded: string | undefined): string | null {
    if (encoded === undefined || encoded === '') {
      return null;
    }
    try {
      return Buffer.from(encoded, 'base64url').toString('utf8');
    } catch {
      return null;
    }
  }
}
