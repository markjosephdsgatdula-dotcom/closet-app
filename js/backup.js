import { db } from "./db.js";

const SCHEMA_VERSION = 2;

export async function exportBackup() {
  const [garments, outfits, wearLog, wishlist] = await Promise.all([
    db.getAll("garments"),
    db.getAll("outfits"),
    db.getAll("wearLog"),
    db.getAll("wishlist"),
  ]);
  const payload = {
    app: "closet-app",
    version: SCHEMA_VERSION,
    exportedAt: Date.now(),
    garments,
    outfits,
    wearLog,
    wishlist,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `closet-backup-${date}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return {
    garmentCount: garments.length,
    outfitCount: outfits.length,
    wearLogCount: wearLog.length,
    wishlistCount: wishlist.length,
  };
}

export async function readBackupFile(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  if (!data || data.app !== "closet-app" || !Array.isArray(data.garments)) {
    throw new Error("That doesn't look like a closet-app backup file.");
  }
  return data;
}

// Replaces all current data with the backup's contents. Caller is responsible for
// confirming with the user first, since this discards whatever is currently stored.
export async function importBackup(data) {
  await Promise.all([db.clear("garments"), db.clear("outfits"), db.clear("wearLog"), db.clear("wishlist")]);
  for (const g of data.garments || []) await db.put("garments", g);
  for (const o of data.outfits || []) await db.put("outfits", o);
  for (const w of data.wearLog || []) await db.put("wearLog", w);
  for (const w of data.wishlist || []) await db.put("wishlist", w);
  return {
    garmentCount: (data.garments || []).length,
    outfitCount: (data.outfits || []).length,
    wearLogCount: (data.wearLog || []).length,
    wishlistCount: (data.wishlist || []).length,
  };
}
