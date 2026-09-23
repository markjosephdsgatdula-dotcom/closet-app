// Free, no-key weather lookup (Open-Meteo) + simple rule-based outfit picking that
// favors least-recently-worn items, filtered by weather and the chosen occasion.

const SLOTS = {
  top: ["Shirt", "T-Shirt"],
  bottom: ["Pants", "Jeans", "Shorts", "Skirt"],
  dress: ["Dress"],
  outerwear: ["Jacket"],
  footwear: ["Shoes"],
};

const OCCASION_KEYWORDS = {
  casual: ["casual"],
  social: ["social", "formal", "dressy", "smart"],
  sports: ["sport", "sports", "athletic", "gym", "active"],
};

export function getLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("This browser doesn't support location lookup."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (err) => reject(new Error(`Location permission needed for weather-aware suggestions (${err.message}).`)),
      { timeout: 10000 }
    );
  });
}

// Weather codes 51-99 in Open-Meteo's WMO table are drizzle/rain/showers/thunderstorm/snow.
function isWetCode(code) {
  return code >= 51;
}

export async function getWeather({ lat, lon }) {
  const res = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`
  );
  if (!res.ok) throw new Error(`Weather lookup failed (${res.status}).`);
  const data = await res.json();
  const tempC = data.current?.temperature_2m;
  const code = data.current?.weather_code ?? 0;
  if (typeof tempC !== "number") throw new Error("Weather data was incomplete.");
  return { tempC, wet: isWetCode(code), band: classifyTemp(tempC) };
}

function classifyTemp(tempC) {
  if (tempC >= 28) return "hot";
  if (tempC >= 20) return "warm";
  if (tempC >= 12) return "mild";
  return "cold";
}

function matchesOccasion(garment, occasion) {
  if (!occasion) return true;
  const keywords = OCCASION_KEYWORDS[occasion] || [occasion];
  const tags = (garment.tags || []).map((t) => t.toLowerCase());
  return keywords.some((k) => tags.some((t) => t.includes(k)));
}

function matchesWeather(garment, weather, slot) {
  if (!weather) return true;
  const tags = (garment.tags || []).map((t) => t.toLowerCase());
  if (slot === "bottom" && garment.category === "Shorts" && weather.band === "cold") return false;
  if (slot === "top" && weather.band === "hot" && tags.some((t) => t.includes("winter") || t.includes("heavy"))) {
    return false;
  }
  if (slot === "outerwear" && weather.band === "hot") return false;
  return true;
}

function wearScore(garment) {
  // Lower score = worn less recently / less often = preferred first.
  const count = garment.wearCount || 0;
  const lastWorn = garment.lastWorn || 0;
  return count * 1e15 + lastWorn;
}

function candidatesFor(garments, categories, occasion, weather, slot) {
  return garments
    .filter((g) => categories.includes(g.category))
    .filter((g) => matchesOccasion(g, occasion))
    .filter((g) => matchesWeather(g, weather, slot))
    .sort((a, b) => wearScore(a) - wearScore(b));
}

// excludeIds: garment ids to skip (used by "Shuffle" to avoid repeating the same pick)
export function generateOutfit(garments, occasion, weather, excludeIds = new Set()) {
  const pick = (slot, categories, rank = 0) => {
    const pool = candidatesFor(garments, categories, occasion, weather, slot).filter((g) => !excludeIds.has(g.id));
    return pool[rank] || null;
  };

  const dress = pick("dress", SLOTS.dress);
  const top = dress ? null : pick("top", SLOTS.top);
  const bottom = dress ? null : pick("bottom", SLOTS.bottom);
  const needsOuterwear = weather && (weather.band === "cold" || weather.wet);
  const outerwear = needsOuterwear ? pick("outerwear", SLOTS.outerwear) : null;
  const footwear = pick("footwear", SLOTS.footwear);

  const chosen = { dress, top, bottom, outerwear, footwear };
  const hasAnything = Object.values(chosen).some(Boolean);
  return { ...chosen, hasAnything };
}
