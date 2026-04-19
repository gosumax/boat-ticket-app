import { describe, expect, it } from 'vitest';
import {
  sanitizeBuyerContactPhoneInput,
  validateBuyerContactPhone,
  validateBuyerCustomerName,
} from '../../src/telegram/TelegramMiniApp.jsx';

describe('telegram mini app buyer booking validation helpers', () => {
  it('accepts buyer names with two visible characters and keeps one-character names blocked', () => {
    expect(validateBuyerCustomerName('').isValid).toBe(false);
    expect(validateBuyerCustomerName('Я').isValid).toBe(false);

    const validName = validateBuyerCustomerName(' Ян ');
    expect(validName).toMatchObject({
      isValid: true,
      normalizedName: 'Ян',
      message: null,
    });
  });

  it('sanitizes buyer phone input to one supported Russian number and trims extra digits', () => {
    expect(sanitizeBuyerContactPhoneInput('+7 (999) 000-00-00')).toBe('+79990000000');
    expect(sanitizeBuyerContactPhoneInput('89990000000123')).toBe('89990000000');
  });

  it('accepts +7 and 8 buyer phone formats and normalizes both to E.164 for submit', () => {
    expect(validateBuyerContactPhone('+79990000000')).toMatchObject({
      isValid: true,
      normalizedPhoneE164: '+79990000000',
    });
    expect(validateBuyerContactPhone('89990000000')).toMatchObject({
      isValid: true,
      normalizedPhoneE164: '+79990000000',
    });
  });

  it('blocks unsupported prefixes and incomplete Russian phone lengths', () => {
    expect(validateBuyerContactPhone('79990000000')).toMatchObject({
      isValid: false,
      normalizedPhoneE164: null,
    });
    expect(validateBuyerContactPhone('+7999000000')).toMatchObject({
      isValid: false,
      normalizedPhoneE164: null,
    });
  });
});
