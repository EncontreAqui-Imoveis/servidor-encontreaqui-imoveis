export function normalizeCpfDigits(value: string): string {
  return String(value ?? '').replace(/\D/g, '').slice(0, 11);
}

function calculateCheckDigit(baseDigits: string, weightStart: number): number {
  let sum = 0;

  for (let i = 0; i < baseDigits.length; i += 1) {
    sum += Number(baseDigits[i]) * (weightStart - i);
  }

  const remainder = (sum * 10) % 11;
  return remainder === 10 ? 0 : remainder;
}

export function isValidCpf(value: string): boolean {
  const digits = normalizeCpfDigits(value);
  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false;

  const firstCheckDigit = calculateCheckDigit(digits.slice(0, 9), 10);
  if (firstCheckDigit !== Number(digits[9])) return false;

  const secondCheckDigit = calculateCheckDigit(digits.slice(0, 10), 11);
  return secondCheckDigit === Number(digits[10]);
}
