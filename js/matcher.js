// Matches an AI-identified outfit piece against the user's existing closet, so we can tell
// them "you already own something like this" vs. flagging it as a want-to-buy candidate.

function normalize(str) {
  return (str || "").trim().toLowerCase();
}

function colorOverlapCount(colorsA, colorsB) {
  const setB = new Set((colorsB || []).map(normalize));
  return (colorsA || []).map(normalize).filter((c) => setB.has(c)).length;
}

// Returns the best-matching owned garment for a piece, or null if nothing owned qualifies.
// A match requires the same category AND at least one shared color — category alone is too
// loose (any two shirts would "match"), so this stays conservative on purpose.
export function findBestMatch(piece, garments) {
  const sameCategory = garments.filter((g) => normalize(g.category) === normalize(piece.category));
  if (!sameCategory.length) return null;

  let best = null;
  let bestScore = 0;
  for (const g of sameCategory) {
    const overlap = colorOverlapCount(piece.colors, g.colors);
    if (overlap > bestScore) {
      bestScore = overlap;
      best = g;
    }
  }
  return bestScore > 0 ? best : null;
}

export function matchOutfitPieces(pieces, garments) {
  return pieces.map((piece) => ({
    piece,
    match: findBestMatch(piece, garments),
  }));
}
