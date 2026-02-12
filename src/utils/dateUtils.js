/**
 * Helper: format Date object as local YYYY-MM-DD (no UTC shift)
 * @param {Date} d - Date object
 * @returns {string} Date string in YYYY-MM-DD format
 */
const formatLocalYmd = (d) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/**
 * Normalize date to local date string (YYYY-MM-DD) for consistent comparison
 * @param {string|Date} dateValue - Date string or Date object
 * @returns {string|null} Date string in YYYY-MM-DD format or null if invalid
 */
export const normalizeDate = (dateValue) => {
  if (!dateValue) return null;
  
  // If it's already a YYYY-MM-DD string, return as-is (no Date parsing needed)
  if (typeof dateValue === 'string' && dateValue.match(/^\d{4}-\d{2}-\d{2}$/)) {
    return dateValue;
  }
  
  let date;
  if (typeof dateValue === 'string') {
    // Handle datetime strings (ISO) - parse and convert to local
    if (dateValue.includes('T')) {
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
  
  // Return as local YYYY-MM-DD format (NOT UTC!)
  return formatLocalYmd(date);
};

/**
 * Get today's date in YYYY-MM-DD format (local timezone)
 * @returns {string} Today's date in YYYY-MM-DD format
 */
export const getTodayDate = () => {
  return formatLocalYmd(new Date());
};

/**
 * Get tomorrow's date in YYYY-MM-DD format (local timezone)
 * @returns {string} Tomorrow's date in YYYY-MM-DD format
 */
export const getTomorrowDate = () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return formatLocalYmd(tomorrow);
};

/**
 * Get day+2's date in YYYY-MM-DD format (local timezone)
 * @returns {string} Day after tomorrow's date in YYYY-MM-DD format
 */
export const getDay2Date = () => {
  const day2 = new Date();
  day2.setDate(day2.getDate() + 2);
  return formatLocalYmd(day2);
};