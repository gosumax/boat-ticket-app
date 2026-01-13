// Mock data for the boat ticket system

export const boats = [
  { id: 1, name: 'Скоростная лодка 1', type: 'speed', seats: 12 },
  { id: 2, name: 'Скоростная лодка 2', type: 'speed', seats: 12 },
  { id: 3, name: 'Скоростная лодка 3', type: 'speed', seats: 12 },
  { id: 4, name: 'Прогулочная лодка 1', type: 'cruise', seats: 12 },
  { id: 5, name: 'Прогулочная лодка 2', type: 'cruise', seats: 12 },
  { id: 6, name: 'Прогулочная лодка 3', type: 'cruise', seats: 12 },
];

export const trips = [
  { id: 1, boatId: 1, time: '10:00', duration: '1ч', type: 'speed', price: 1500, seatsLeft: 8 },
  { id: 2, boatId: 2, time: '12:00', duration: '1.5ч', type: 'speed', price: 2000, seatsLeft: 5 },
  { id: 3, boatId: 3, time: '14:00', duration: '2ч', type: 'speed', price: 2500, seatsLeft: 12 },
  { id: 4, boatId: 4, time: '10:00', duration: '2ч', type: 'cruise', price: 3500, seatsLeft: 7 },
  { id: 5, boatId: 5, time: '12:00', duration: '3ч', type: 'cruise', price: 4500, seatsLeft: 9 },
  { id: 6, boatId: 6, time: '16:00', duration: '1.5ч', type: 'cruise', price: 3000, seatsLeft: 4 },
  { id: 7, boatId: 1, time: '18:00', duration: '1ч', type: 'speed', price: 1500, seatsLeft: 11 },
  { id: 8, boatId: 4, time: '18:00', duration: '3ч', type: 'cruise', price: 5000, seatsLeft: 6 },
];

export const sellers = [
  { id: 'A', name: 'Продавец A' },
  { id: 'B', name: 'Продавец B' },
  { id: 'C', name: 'Продавец C' },
];

// Fake ticket numbers generator
export const generateTicketNumber = () => {
  return `TKT-${Math.floor(1000 + Math.random() * 9000)}`;
};

// Fake earnings calculation
export const calculateEarnings = (ticketsSold) => {
  const totalSold = ticketsSold.reduce((sum, ticket) => sum + ticket.totalPrice, 0);
  const commission = totalSold * 0.1; // 10% commission
  const bonus = 50; // Static bonus
  return { totalSold, commission, bonus };
};