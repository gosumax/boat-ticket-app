/**
 * Format number as RUB currency
 * @param {number} amount - The amount to format
 * @returns {string} Formatted currency string (e.g., "1 500 ₽")
 */
export const formatRUB = (amount) => {
  if (amount === undefined || amount === null) return '0 ₽';
  
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount);
};