/**
 * Normalize date to local date string (YYYY-MM-DD) for consistent comparison
 * @param {string|Date} dateValue - Date string or Date object
 * @returns {string|null} Date string in YYYY-MM-DD format or null if invalid
 */
export const normalizeDate = (dateValue) => {
  if (!dateValue) return null;
  
  let date;
  if (typeof dateValue === 'string') {
    // Handle date strings (YYYY-MM-DD) and datetime strings (ISO)
    if (dateValue.includes('T')) {
      // It's an ISO datetime string, parse it as is
      date = new Date(dateValue);
    } else if (dateValue.match(/^\d{4}-\d{2}-\d{2}$/)) {
      // It's a date string in YYYY-MM-DD format
      date = new Date(dateValue);
    } else {
      // Try to parse other formats
      date = new Date(dateValue);
    }
  } else if (dateValue instanceof Date) {
    date = dateValue;
  } else {
    return null;
  }
  
  // Check if date is valid
  if (isNaN(date.getTime())) {
    return null;
  }
  
  // Return as YYYY-MM-DD format to ensure local date consistency
  return date.toISOString().split('T')[0];
};

/**
 * Get today's date in YYYY-MM-DD format
 * @returns {string} Today's date in YYYY-MM-DD format
 */
export const getTodayDate = () => {
  const today = new Date();
  return today.toISOString().split('T')[0];
};

/**
 * Get tomorrow's date in YYYY-MM-DD format
 * @returns {string} Tomorrow's date in YYYY-MM-DD format
 */
export const getTomorrowDate = () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toISOString().split('T')[0];
};