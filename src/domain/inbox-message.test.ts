import { describe, expect, it } from 'bun:test';
import { InvalidInboxMessageError } from './errors.js';
import { InboxMessage } from './inbox-message.js';

const receivedAt = new Date('2026-01-01T00:00:00.000Z');
const processedAt = new Date('2026-01-01T00:00:01.000Z');

const receive = (overrides: Partial<Parameters<typeof InboxMessage.receive>[0]> = {}) =>
  InboxMessage.receive({
    messageId: 'msg-1',
    consumerName: 'wager-transactions-consumer',
    payloadHash: 'abc123',
    receivedAt,
    ...overrides,
  });

describe('InboxMessage.receive', () => {
  it('cria a mensagem sem processedAt', () => {
    const message = receive();
    expect(message.messageId).toBe('msg-1');
    expect(message.consumerName).toBe('wager-transactions-consumer');
    expect(message.payloadHash).toBe('abc123');
    expect(message.receivedAt).toEqual(receivedAt);
    expect(message.processedAt).toBeUndefined();
    expect(message.isProcessed()).toBe(false);
  });

  it('rejeita messageId em branco', () => {
    expect(() => receive({ messageId: '  ' })).toThrow(InvalidInboxMessageError);
  });

  it('rejeita consumerName em branco', () => {
    expect(() => receive({ consumerName: '' })).toThrow(InvalidInboxMessageError);
  });

  it('rejeita payloadHash em branco', () => {
    expect(() => receive({ payloadHash: '' })).toThrow(InvalidInboxMessageError);
  });

  it('rejeita receivedAt inválido', () => {
    expect(() => receive({ receivedAt: new Date('nope') })).toThrow(InvalidInboxMessageError);
  });
});

describe('InboxMessage.markProcessed', () => {
  it('marca como processada', () => {
    const message = receive();
    message.markProcessed(processedAt);
    expect(message.isProcessed()).toBe(true);
    expect(message.processedAt).toEqual(processedAt);
  });

  it('recusa marcação dupla (erro de programação, não caminho de negócio)', () => {
    const message = receive();
    message.markProcessed(processedAt);
    expect(() => message.markProcessed(processedAt)).toThrow(InvalidInboxMessageError);
  });
});

describe('InboxMessage.rehydrate', () => {
  it('reconstrói a mensagem já processada sem revalidar', () => {
    const message = InboxMessage.rehydrate({
      messageId: 'msg-2',
      consumerName: 'c',
      payloadHash: 'hash',
      receivedAt,
      processedAt,
    });
    expect(message.isProcessed()).toBe(true);
    expect(message.processedAt).toEqual(processedAt);
  });
});
