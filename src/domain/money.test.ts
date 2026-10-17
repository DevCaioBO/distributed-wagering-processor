import { describe, expect, it } from 'bun:test';
import { CurrencyMismatchError, InvalidMoneyError } from './errors.js';
import { Money } from './money.js';

const brl = (amount: string) => Money.from({ amount, currency: 'BRL' });

describe('Money', () => {
  it('normaliza para duas casas decimais', () => {
    expect(brl('25').toJSON()).toEqual({ amount: '25.00', currency: 'BRL' });
    expect(brl('25.5').toJSON().amount).toBe('25.50');
    expect(brl('0.05').toJSON().amount).toBe('0.05');
  });

  it('não perde precisão em somas', () => {
    expect(brl('0.10').add(brl('0.20')).equals(brl('0.30'))).toBe(true);
  });

  it('é imutável: operações devolvem nova instância', () => {
    const original = brl('10.00');
    const result = original.add(brl('5.00'));
    expect(original.toJSON().amount).toBe('10.00');
    expect(result.toJSON().amount).toBe('15.00');
  });

  it('subtração pode resultar em valor negativo', () => {
    const result = brl('10.00').subtract(brl('25.00'));
    expect(result.isNegative()).toBe(true);
    expect(result.toJSON().amount).toBe('-15.00');
  });

  it('negate inverte o sinal', () => {
    expect(brl('10.00').negate().toJSON().amount).toBe('-10.00');
    expect(brl('10.00').negate().negate().equals(brl('10.00'))).toBe(true);
  });

  it('zero, positivo e comparação', () => {
    expect(Money.zero('BRL').isZero()).toBe(true);
    expect(brl('0.01').isPositive()).toBe(true);
    expect(brl('20.00').isLessThan(brl('80.00'))).toBe(true);
    expect(brl('80.00').isLessThan(brl('20.00'))).toBe(false);
  });

  it.each(['', 'abc', 'NaN', 'Infinity', '1e3', '-1.00', '1.234', '1,00', ' 1.00', '.50'])(
    'rejeita amount inválido: %p',
    (amount) => {
      expect(() => brl(amount)).toThrow(InvalidMoneyError);
    },
  );

  it('rejeita amount que não seja string', () => {
    expect(() => Money.from({ amount: 25 as unknown as string, currency: 'BRL' })).toThrow(
      InvalidMoneyError,
    );
  });

  it.each(['', 'brl', 'BR', 'BRLL'])('rejeita moeda inválida: %p', (currency) => {
    expect(() => Money.from({ amount: '1.00', currency })).toThrow(InvalidMoneyError);
  });

  it('conflito de moeda lança erro de domínio', () => {
    const usd = Money.from({ amount: '1.00', currency: 'USD' });
    expect(() => brl('1.00').add(usd)).toThrow(CurrencyMismatchError);
    expect(() => brl('1.00').subtract(usd)).toThrow(CurrencyMismatchError);
    expect(() => brl('1.00').isLessThan(usd)).toThrow(CurrencyMismatchError);
    expect(brl('1.00').equals(usd)).toBe(false);
  });
});