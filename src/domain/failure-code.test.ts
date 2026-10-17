import { describe, expect, it } from 'bun:test';
import { FailureCode, ProviderAction, providerActionFor } from './failure-code.js';

describe('FailureCode', () => {
  it('todo código tem uma ação para o provedor', () => {
    const actions = Object.values(ProviderAction);
    for (const code of Object.values(FailureCode)) {
      expect(actions).toContain(providerActionFor(code));
    }
  });

  it('os códigos são únicos e estáveis em SCREAMING_SNAKE_CASE', () => {
    const values = Object.values(FailureCode);
    expect(new Set(values).size).toBe(values.length);
    for (const value of values) {
      expect(value).toMatch(/^[A-Z]+(_[A-Z]+)*$/);
    }
  });

  it('saldo insuficiente em aposta e reversão que estoura o saldo são situações distintas', () => {
    expect(FailureCode.InsufficientFunds).not.toBe(FailureCode.ReversalWouldOverdraw);
    expect(providerActionFor(FailureCode.InsufficientFunds)).toBe(ProviderAction.Abandon);
    expect(providerActionFor(FailureCode.ReversalWouldOverdraw)).toBe(
      ProviderAction.ContactSupport,
    );
  });

  it('payload corrigível pede correção e falha interna pede contato com o suporte', () => {
    expect(providerActionFor(FailureCode.AmountMismatch)).toBe(ProviderAction.FixPayload);
    expect(providerActionFor(FailureCode.ProcessingFailed)).toBe(ProviderAction.ContactSupport);
  });
});