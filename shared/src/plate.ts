// Philippine four-wheeled plate rules.
//
// Kept in the shared package so the mobile form and the sign-up metadata
// path normalise a plate exactly the same way -- they used to diverge (one
// called normalizePlate, the other a bare toUpperCase), which left the same
// car stored as two different strings depending on which path created it.

/** A Philippine four-wheeled plate: 3 letters + 3 or 4 digits. */
export const PLATE_PATTERN = /^[A-Z]{3}\d{3,4}$/;

/**
 * The same character confusions the agent service corrects after OCR
 * (O->0, I->1, S->5, Z->2, B->8). Those letters are digits read wrongly, so
 * they are only swapped inside the numeric part of the plate; the three-letter
 * prefix is left exactly as typed.
 */
const DIGIT_CONFUSIONS: Record<string, string> = {
  O: '0',
  I: '1',
  S: '5',
  Z: '2',
  B: '8',
};

/** Uppercase, strip separators, then fix OCR-style digit confusions. */
export function normalizePlate(raw: string | null | undefined): string {
  const cleaned = (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const letters = cleaned.slice(0, 3);
  const digits = cleaned
    .slice(3)
    .replace(/[OISZB]/g, (char) => DIGIT_CONFUSIONS[char] ?? char);
  return `${letters}${digits}`;
}

/** Returns a message to show under the field, or null when the plate is fine. */
export function plateError(raw: string | null | undefined): string | null {
  const normalized = normalizePlate(raw);
  if (!normalized) return 'Enter the plate number.';
  if (!PLATE_PATTERN.test(normalized)) {
    return 'Use 3 letters + 3 or 4 numbers (e.g. ABC123 or ABC1234).';
  }
  return null;
}

/** Same rule as the registration form. */
export function isValidPlate(raw: string | null | undefined): boolean {
  return plateError(raw) === null;
}
