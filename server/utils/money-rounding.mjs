/**
 * Money rounding utilities
 * All payouts rounded down to nearest 50 RUB
 */

/**
 * Round amount down to nearest 50
 * @param {number} amount - The amount to round
 * @returns {number} Amount rounded down to nearest 50
 * 
 * Examples:
 *   10499 -> 10450
 *   10450 -> 10450
 *   10401 -> 10400
 *   49 -> 0
 */
export function roundDownTo50(amount) {
  return Math.floor(Number(amount || 0) / 50) * 50;
}
