// Shipping fee calculator based on Danish postal codes
// Free zone (your immediate neighborhood):  2100, 2900
// Inner ring (Copenhagen city):             1xxx, 2xxx (rest)
// Outer ring (Greater Copenhagen + N Sjælland): 3xxx
// Rest of Sjælland:                         4xxx
// Fyn:                                      5xxx
// Jylland + Bornholm:                       6xxx-9xxx + 37xx
// Default fallback:                         90 DKK

const FREE_ZONE = ['2100', '2900'];

function calculateShipping(postalCode) {
  if (!postalCode) return 90; // safest default if missing
  const code = String(postalCode).trim();

  if (FREE_ZONE.includes(code)) return 0;

  const num = parseInt(code, 10);
  if (isNaN(num)) return 90;

  // Bornholm (3700-3799) → lump with Jylland 90 DKK
  if (num >= 3700 && num <= 3799) return 90;

  if (num >= 1000 && num <= 2999) return 20;  // Copenhagen city
  if (num >= 3000 && num <= 3699) return 40;  // Greater Copenhagen + N Sjælland
  if (num >= 4000 && num <= 4999) return 60;  // Rest of Sjælland
  if (num >= 5000 && num <= 5999) return 80;  // Fyn
  if (num >= 6000 && num <= 9999) return 90;  // Jylland

  return 90;
}

module.exports = { calculateShipping };