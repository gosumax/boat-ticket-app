export function formatMotivationPoints(value) {
  const points = Number(value || 0);

  try {
    return new Intl.NumberFormat('ru-RU', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(points);
  } catch {
    return String(Math.round(points * 100) / 100);
  }
}

export default {
  formatMotivationPoints,
};
