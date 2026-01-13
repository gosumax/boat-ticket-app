/**
 * Get the normalized available seats for a slot
 * Uses seats_available as primary source, falls back to other fields
 * @param {Object} slot - The slot object
 * @returns {number} The available seats count
 */
export const getSlotAvailable = (slot) => {
  const n = slot?.seats_available ?? slot?.seats_left ?? slot?.capacity ?? slot?.boat_capacity ?? 0;
  return Number.isFinite(Number(n)) ? Number(n) : 0;
};

/**
 * Check if a slot is sold out (no available seats)
 * @param {Object} slot - The slot object
 * @returns {boolean} True if the slot is sold out
 */
export const isSlotSoldOut = (slot) => {
  return getSlotAvailable(slot) <= 0;
};