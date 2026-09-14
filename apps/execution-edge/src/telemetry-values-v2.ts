export type FixedDecimalV2 = Readonly<{
  value: string;
  scale: number;
}>;

const UINT64_MAX = 18_446_744_073_709_551_615n;
const DECIMAL_INVALID = 'TELEMETRY_DECIMAL_INVALID';

function invalid(code: string): never {
  throw new Error(code);
}

function validScale(scale: unknown): scale is number {
  return typeof scale === 'number' && Number.isInteger(scale) && scale >= 0 && scale <= 16;
}

export function readCounterV2(value: unknown, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    invalid('TELEMETRY_COUNTER_INVALID');
  }
  return value;
}

export function readIdentifierV2(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/u.test(value)) {
    invalid('TELEMETRY_IDENTIFIER_INVALID');
  }
  return value;
}

export function readDigestV2(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value) || /^0+$/u.test(value)) {
    invalid('TELEMETRY_DIGEST_INVALID');
  }
  return value;
}

export function readTicketV2(value: unknown): string {
  if (typeof value !== 'string' || !/^(?:[1-9][0-9]{0,19})$/u.test(value)) {
    invalid('TELEMETRY_TICKET_INVALID');
  }
  try {
    if (BigInt(value) > UINT64_MAX) invalid('TELEMETRY_TICKET_INVALID');
  } catch {
    invalid('TELEMETRY_TICKET_INVALID');
  }
  return value;
}

export function parseFixedV2(value: unknown, scale: unknown): FixedDecimalV2 {
  if (!validScale(scale) || typeof value !== 'string' || value.length > 36) invalid(DECIMAL_INVALID);
  if (value === '') invalid(DECIMAL_INVALID);

  const match = /^(-)?(0|[1-9][0-9]{0,17})(?:\.([0-9]+))?$/u.exec(value);
  if (!match) invalid(DECIMAL_INVALID);
  const [, minus, integerPart, digits = ''] = match;
  if (scale === 0 ? digits !== '' : digits.length !== scale) invalid(DECIMAL_INVALID);

  const units = BigInt((integerPart || '0') + (digits || ''));
  if (units === 0n && minus) invalid(DECIMAL_INVALID);
  const sign = minus ? '-' : '';
  const canonicalInteger = integerPart || '0';
  const canonical = scale === 0
    ? `${sign}${canonicalInteger}`
    : `${sign}${canonicalInteger}.${digits}`;
  return Object.freeze({ value: canonical, scale });
}

function parseFixedObject(value: FixedDecimalV2, scale: number): bigint {
  if (value === null || typeof value !== 'object' || value.scale !== scale) invalid(DECIMAL_INVALID);
  const parsed = parseFixedV2(value.value, value.scale);
  const unsigned = parsed.value.replace('-', '').replace('.', '');
  return parsed.value.startsWith('-') ? -BigInt(unsigned) : BigInt(unsigned);
}

export function sumFixedV2(values: readonly FixedDecimalV2[], scale: number): FixedDecimalV2 {
  if (!validScale(scale)) invalid(DECIMAL_INVALID);
  let total = 0n;
  for (const value of values) total += parseFixedObject(value, scale);

  const negative = total < 0n;
  const absolute = (negative ? -total : total).toString().padStart(scale + 1, '0');
  const raw = scale === 0
    ? `${negative ? '-' : ''}${absolute}`
    : `${negative ? '-' : ''}${absolute.slice(0, -scale)}.${absolute.slice(-scale)}`;
  return parseFixedV2(raw, scale);
}
