import { db, uid } from "./db.js";
import { scanGarment, identifyOutfitPieces, getApiKey, setApiKey } from "./vision.js";
import { normalizePhotoLocal } from "./localCleanup.js";
import { getLocation, getWeather, generateOutfit } from "./suggest.js";
import { exportBackup, readBackupFile, importBackup } from "./backup.js";
import { matchOutfitPieces } from "./matcher.js";

const view = document.getElementById("view");
const tabButtons = document.querySelectorAll(".tab-btn");

let garments = [];
let outfits = [];
let wearLog = [];
let wishlist = [];
let activeTab = "closet";
let activeCategoryFilter = "";

// ---------- data load ----------
async function loadAll() {
  [garments, outfits, wearLog, wishlist] = await Promise.all([
    db.getAll("garments"),
    db.getAll("outfits"),
    db.getAll("wearLog"),
    db.getAll("wishlist"),
  ]);
  garments.sort((a, b) => b.createdAt - a.createdAt);
  outfits.sort((a, b) => b.createdAt - a.createdAt);
  wearLog.sort((a, b) => b.date - a.date);
  wishlist.sort((a, b) => b.createdAt - a.createdAt);
}

function garmentById(id) {
  return garments.find((g) => g.id === id);
}

function daysSince(ts) {
  if (!ts) return null;
  return Math.floor((Date.now() - ts) / 86400000);
}

// ---------- rendering ----------
function render() {
  tabButtons.forEach((b) => b.classList.toggle("active", b.dataset.tab === activeTab));
  if (activeTab === "closet") renderCloset();
  else if (activeTab === "outfits") renderOutfits();
  else if (activeTab === "history") renderHistory();
  else renderWishlist();
}

function renderWishlist() {
  view.innerHTML = `
    <button class="primary-btn" id="matchOutfitBtn" style="width:100%;margin-bottom:16px;">📸 Match an outfit photo</button>
    ${
      wishlist.length === 0
        ? `<div class="empty-state">Nothing on your wishlist yet.<br>Match an outfit photo to find pieces you don't own.</div>`
        : wishlist.map(wishlistItemHtml).join("")
    }
  `;
  document.getElementById("matchOutfitBtn").addEventListener("click", openMatcherModal);
  view.querySelectorAll("[data-delete-wishlist]").forEach((btn) =>
    btn.addEventListener("click", () => deleteWishlistItem(btn.dataset.deleteWishlist))
  );
}

function wishlistItemHtml(w) {
  return `
    <div class="wishlist-item">
      ${w.sourcePhoto ? `<img src="${w.sourcePhoto}" alt="">` : ""}
      <div class="wishlist-info">
        <div class="wishlist-name">${escapeHtml(w.name || w.category)}</div>
        <div class="wishlist-sub">${escapeHtml(w.category || "")}${w.colors?.length ? " · " + escapeHtml(w.colors.join(", ")) : ""}</div>
        <div class="wishlist-sub">${(w.tags || []).map((t) => `<span class="tag-pill">${escapeHtml(t)}</span>`).join("")}</div>
      </div>
      <button type="button" class="danger-btn" data-delete-wishlist="${w.id}" style="margin:0;">Remove</button>
    </div>
  `;
}

async function deleteWishlistItem(id) {
  await db.delete("wishlist", id);
  await loadAll();
  render();
}

function renderCloset() {
  const categories = [...new Set(garments.map((g) => g.category).filter(Boolean))];
  const filtered = activeCategoryFilter
    ? garments.filter((g) => g.category === activeCategoryFilter)
    : garments;

  const chips = categories
    .map(
      (c) =>
        `<button class="chip ${c === activeCategoryFilter ? "active" : ""}" data-cat="${escapeAttr(c)}">${escapeHtml(c)}</button>`
    )
    .join("");

  const neglected = garments
    .filter((g) => g.wearCount === 0 || daysSince(g.lastWorn) > 30 || g.lastWorn == null)
    .filter((g) => g.wearCount > 0);

  view.innerHTML = `
    ${categories.length ? `<div class="filter-row">
      <button class="chip ${!activeCategoryFilter ? "active" : ""}" data-cat="">All</button>
      ${chips}
    </div>` : ""}
    ${
      filtered.length === 0
        ? `<div class="empty-state">No garments yet.<br>Tap + to add your first item.</div>`
        : `<div class="grid">${filtered.map(garmentCardHtml).join("")}</div>`
    }
  `;

  view.querySelectorAll(".chip[data-cat]").forEach((chip) => {
    chip.addEventListener("click", () => {
      activeCategoryFilter = chip.dataset.cat;
      renderCloset();
    });
  });
  view.querySelectorAll(".garment-card").forEach((card) => {
    card.addEventListener("click", () => openDetail(card.dataset.id));
  });
}

function garmentCardHtml(g) {
  const stale = g.wearCount > 0 && daysSince(g.lastWorn) !== null && daysSince(g.lastWorn) > 30;
  return `
    <button class="garment-card" data-id="${g.id}">
      <img src="${g.photo}" alt="${escapeAttr(g.name || g.category || "")}">
      <div class="meta">
        <span class="name">${escapeHtml(g.name || g.category || "Untitled")}</span>
        <span class="sub">${escapeHtml(g.category || "")}</span>
      </div>
      <div class="worn-badge">
        Worn ${g.wearCount || 0}×
        ${stale ? `<span class="stale-badge">· forgotten</span>` : ""}
      </div>
    </button>
  `;
}

function renderOutfits() {
  view.innerHTML = `
    <button class="primary-btn" id="suggestOutfitBtn" style="width:100%;margin-bottom:10px;">✨ Suggest an outfit</button>
    <button class="secondary-btn" id="newOutfitBtn" style="width:100%;margin-bottom:16px;">+ Build new outfit</button>
    ${
      outfits.length === 0
        ? `<div class="empty-state">No outfits saved yet.</div>`
        : outfits.map(outfitCardHtml).join("")
    }
  `;
  document.getElementById("newOutfitBtn").addEventListener("click", openOutfitBuilder);
  document.getElementById("suggestOutfitBtn").addEventListener("click", openSuggestModal);
  view.querySelectorAll("[data-wear-outfit]").forEach((btn) =>
    btn.addEventListener("click", () => wearOutfit(btn.dataset.wearOutfit))
  );
  view.querySelectorAll("[data-delete-outfit]").forEach((btn) =>
    btn.addEventListener("click", () => deleteOutfit(btn.dataset.deleteOutfit))
  );
}

function outfitCardHtml(o) {
  const items = o.garmentIds.map(garmentById).filter(Boolean);
  return `
    <div class="outfit-card">
      <h3>${escapeHtml(o.name)}</h3>
      <div class="outfit-thumbs">
        ${items.map((g) => `<img src="${g.photo}" alt="">`).join("")}
      </div>
      <div class="outfit-actions">
        <button class="primary-btn" data-wear-outfit="${o.id}">Wear today</button>
        <button class="danger-btn" data-delete-outfit="${o.id}">Delete</button>
      </div>
    </div>
  `;
}

function renderHistory() {
  view.innerHTML =
    wearLog.length === 0
      ? `<div class="empty-state">No wear history yet.<br>Mark items or outfits as worn to build it up.</div>`
      : wearLog
          .map((entry) => {
            const items = entry.garmentIds.map(garmentById).filter(Boolean);
            const dateStr = new Date(entry.date).toLocaleDateString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric",
            });
            return `
              <div class="history-item">
                <div class="date">${dateStr}${entry.outfitName ? " · " + escapeHtml(entry.outfitName) : ""}</div>
                <div class="outfit-thumbs">${items.map((g) => `<img src="${g.photo}" alt="">`).join("")}</div>
              </div>
            `;
          })
          .join("");
}

// ---------- garment add/edit modal ----------
const garmentModal = document.getElementById("garmentModal");
const garmentForm = document.getElementById("garmentForm");
const garmentPhotoInput = document.getElementById("garmentPhotoInput");
const garmentPhotoPreview = document.getElementById("garmentPhotoPreview");
const scanBtn = document.getElementById("scanBtn");
const cleanupBtn = document.getElementById("cleanupBtn");
const scanStatusText = document.getElementById("scanStatusText");
const scanSpinner = document.getElementById("scanSpinner");
const deleteGarmentBtn = document.getElementById("deleteGarmentBtn");

function setStatus(text, busy = false) {
  scanStatusText.textContent = text;
  scanSpinner.hidden = !busy;
}

let editingId = null;
let pendingPhotoDataUrl = null;
let originalPhotoDataUrl = null;

function openGarmentModal(existing) {
  editingId = existing ? existing.id : null;
  pendingPhotoDataUrl = existing ? existing.photo : null;
  originalPhotoDataUrl = existing ? existing.photo : null;
  document.getElementById("garmentModalTitle").textContent = existing ? "Edit garment" : "Add garment";
  document.getElementById("fName").value = existing?.name || "";
  document.getElementById("fCategory").value = existing?.category || "";
  document.getElementById("fColors").value = (existing?.colors || []).join(", ");
  document.getElementById("fTags").value = (existing?.tags || []).join(", ");
  document.getElementById("fNotes").value = existing?.notes || "";
  deleteGarmentBtn.hidden = !existing;
  setStatus("");
  if (existing?.photo) {
    garmentPhotoPreview.src = existing.photo;
    garmentPhotoPreview.hidden = false;
    scanBtn.hidden = !getApiKey();
    cleanupBtn.hidden = false;
  } else {
    garmentPhotoPreview.hidden = true;
    scanBtn.hidden = true;
    cleanupBtn.hidden = true;
  }
  garmentModal.showModal();
}

garmentPhotoInput.addEventListener("change", async () => {
  const file = garmentPhotoInput.files[0];
  if (!file) return;
  originalPhotoDataUrl = await fileToResizedDataUrl(file);
  pendingPhotoDataUrl = originalPhotoDataUrl;
  garmentPhotoPreview.src = pendingPhotoDataUrl;
  garmentPhotoPreview.hidden = false;
  scanBtn.hidden = !getApiKey();
  cleanupBtn.hidden = false;
  setStatus("");
});

cleanupBtn.addEventListener("click", runCleanup);

async function runCleanup() {
  if (!originalPhotoDataUrl) return;
  const originalLabel = cleanupBtn.textContent;
  cleanupBtn.textContent = "Cleaning up…";
  cleanupBtn.disabled = true;
  setStatus("Starting…", true);
  try {
    const normalized = await normalizePhotoLocal(originalPhotoDataUrl, (key, current, total) => {
      const pct = total ? Math.round((current / total) * 100) : null;
      if (pct != null && pct < 100) {
        setStatus(`Downloading on-device model… ${pct}%`, true);
      } else {
        setStatus("Processing image… (no progress bar for this step, can take up to a minute)", true);
      }
    });
    pendingPhotoDataUrl = normalized;
    garmentPhotoPreview.src = pendingPhotoDataUrl;
    setStatus("Photo cleaned up.", false);
  } catch (err) {
    setStatus(`${err.message} (kept original photo)`, false);
  } finally {
    cleanupBtn.disabled = false;
    cleanupBtn.textContent = originalLabel;
  }
}

scanBtn.addEventListener("click", async () => {
  if (!pendingPhotoDataUrl) return;
  const originalLabel = scanBtn.textContent;
  scanBtn.textContent = "Scanning…";
  setStatus("Scanning…", true);
  scanBtn.disabled = true;
  try {
    const result = await scanGarment(pendingPhotoDataUrl);
    if (result.category) document.getElementById("fCategory").value = result.category;
    if (result.name) document.getElementById("fName").value = result.name;
    if (result.colors?.length) document.getElementById("fColors").value = result.colors.join(", ");
    if (result.tags?.length) document.getElementById("fTags").value = result.tags.join(", ");
    setStatus("Scanned — review and edit if needed.", false);
  } catch (err) {
    setStatus(err.message, false);
  } finally {
    scanBtn.disabled = false;
    scanBtn.textContent = originalLabel;
  }
});

garmentForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!pendingPhotoDataUrl) {
    setStatus("Please add a photo.", false);
    return;
  }
  const record = {
    id: editingId || uid(),
    photo: pendingPhotoDataUrl,
    name: document.getElementById("fName").value.trim(),
    category: document.getElementById("fCategory").value,
    colors: splitCsv(document.getElementById("fColors").value),
    tags: splitCsv(document.getElementById("fTags").value),
    notes: document.getElementById("fNotes").value.trim(),
    createdAt: editingId ? garmentById(editingId).createdAt : Date.now(),
    wearCount: editingId ? garmentById(editingId).wearCount || 0 : 0,
    lastWorn: editingId ? garmentById(editingId).lastWorn || null : null,
  };
  await db.put("garments", record);
  await loadAll();
  garmentModal.close();
  render();
});

document.getElementById("cancelGarmentBtn").addEventListener("click", () => garmentModal.close());

deleteGarmentBtn.addEventListener("click", async () => {
  if (!editingId) return;
  if (!confirm("Delete this garment? This won't remove it from past history.")) return;
  await db.delete("garments", editingId);
  await loadAll();
  garmentModal.close();
  render();
});

document.getElementById("addGarmentFab").addEventListener("click", () => openGarmentModal(null));

// ---------- detail modal ----------
const detailModal = document.getElementById("detailModal");
const detailBody = document.getElementById("detailBody");
let detailGarmentId = null;

function openDetail(id) {
  const g = garmentById(id);
  if (!g) return;
  detailGarmentId = id;
  const lastWornStr = g.lastWorn ? new Date(g.lastWorn).toLocaleDateString() : "Never";
  detailBody.innerHTML = `
    <img class="detail-photo" src="${g.photo}" alt="">
    <h2>${escapeHtml(g.name || g.category || "Untitled")}</h2>
    <div class="detail-row"><b>Category</b> ${escapeHtml(g.category || "—")}</div>
    <div class="detail-row"><b>Colors</b> ${(g.colors || []).map((c) => `<span class="tag-pill">${escapeHtml(c)}</span>`).join("") || "—"}</div>
    <div class="detail-row"><b>Tags</b> ${(g.tags || []).map((t) => `<span class="tag-pill">${escapeHtml(t)}</span>`).join("") || "—"}</div>
    <div class="detail-row"><b>Worn</b> ${g.wearCount || 0} times · last: ${lastWornStr}</div>
    ${g.notes ? `<div class="detail-row"><b>Notes</b> ${escapeHtml(g.notes)}</div>` : ""}
    <button type="button" id="markWornBtn" class="primary-btn" style="width:100%;margin-top:8px;">Mark worn today</button>
  `;
  detailModal.showModal();
  document.getElementById("markWornBtn").addEventListener("click", async () => {
    await markGarmentsWorn([id], null);
    await loadAll();
    detailModal.close();
    render();
  });
}

document.getElementById("detailCloseBtn").addEventListener("click", () => detailModal.close());
document.getElementById("detailEditBtn").addEventListener("click", () => {
  detailModal.close();
  openGarmentModal(garmentById(detailGarmentId));
});

// ---------- outfit builder ----------
const outfitModal = document.getElementById("outfitModal");
const outfitPickerGrid = document.getElementById("outfitPickerGrid");
const outfitNameInput = document.getElementById("outfitNameInput");
let outfitSelection = new Set();

function openOutfitBuilder() {
  outfitSelection = new Set();
  outfitNameInput.value = "";
  renderOutfitPicker();
  outfitModal.showModal();
}

function renderOutfitPicker() {
  outfitPickerGrid.innerHTML = garments
    .map(
      (g) => `
      <div class="picker-item ${outfitSelection.has(g.id) ? "selected" : ""}" data-id="${g.id}">
        <img src="${g.photo}" alt="">
      </div>`
    )
    .join("");
  outfitPickerGrid.querySelectorAll(".picker-item").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.dataset.id;
      if (outfitSelection.has(id)) outfitSelection.delete(id);
      else outfitSelection.add(id);
      renderOutfitPicker();
    });
  });
}

document.getElementById("outfitCancelBtn").addEventListener("click", () => outfitModal.close());
document.getElementById("outfitSaveBtn").addEventListener("click", async () => {
  if (outfitSelection.size === 0) return alert("Select at least one garment.");
  const record = {
    id: uid(),
    name: outfitNameInput.value.trim() || "Untitled outfit",
    garmentIds: [...outfitSelection],
    createdAt: Date.now(),
  };
  await db.put("outfits", record);
  await loadAll();
  outfitModal.close();
  render();
});

// ---------- outfit suggestion ----------
const suggestModal = document.getElementById("suggestModal");
const suggestStatusText = document.getElementById("suggestStatusText");
const suggestSpinner = document.getElementById("suggestSpinner");
const suggestionResult = document.getElementById("suggestionResult");
const suggestWearBtn = document.getElementById("suggestWearBtn");

let cachedWeather = null;
let currentOccasion = "";
let currentSuggestion = null;
let excludedFromShuffle = new Set();

function setSuggestStatus(text, busy = false) {
  suggestStatusText.textContent = text;
  suggestSpinner.hidden = !busy;
}

async function openSuggestModal() {
  currentOccasion = "";
  excludedFromShuffle = new Set();
  document.querySelectorAll("#occasionChips .chip").forEach((c) => c.classList.toggle("active", c.dataset.occasion === ""));
  suggestionResult.innerHTML = "";
  suggestWearBtn.disabled = true;
  suggestModal.showModal();

  if (!cachedWeather) {
    setSuggestStatus("Checking your location for weather…", true);
    try {
      const loc = await getLocation();
      setSuggestStatus("Fetching weather…", true);
      cachedWeather = await getWeather(loc);
    } catch (err) {
      cachedWeather = { unavailable: true, message: err.message };
    }
  }
  renderWeatherStatus();
  runSuggestion();
}

function renderWeatherStatus() {
  if (!cachedWeather || cachedWeather.unavailable) {
    setSuggestStatus(
      cachedWeather ? `${cachedWeather.message} Suggesting without weather info.` : "Weather unavailable.",
      false
    );
    return;
  }
  const { tempC, band, wet } = cachedWeather;
  setSuggestStatus(`${Math.round(tempC)}°C, ${band}${wet ? ", wet" : ""} — suggesting accordingly.`, false);
}

document.getElementById("occasionChips").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  currentOccasion = chip.dataset.occasion;
  document.querySelectorAll("#occasionChips .chip").forEach((c) => c.classList.toggle("active", c === chip));
  excludedFromShuffle = new Set();
  runSuggestion();
});

function runSuggestion() {
  const weather = cachedWeather && !cachedWeather.unavailable ? cachedWeather : null;
  currentSuggestion = generateOutfit(garments, currentOccasion, weather, excludedFromShuffle);
  renderSuggestion();
}

function renderSuggestion() {
  const s = currentSuggestion;
  if (!s || !s.hasAnything) {
    suggestionResult.innerHTML = `<div class="empty-state">No matching items found. Try a different occasion, or add more garments.</div>`;
    suggestWearBtn.disabled = true;
    return;
  }
  const rows = [
    ["Dress", s.dress],
    ["Top", s.top],
    ["Bottom", s.bottom],
    ["Outerwear", s.outerwear],
    ["Footwear", s.footwear],
  ].filter(([, g]) => g !== null);

  suggestionResult.innerHTML = rows
    .map(
      ([label, g]) => `
      <div class="suggestion-slot">
        <img src="${g.photo}" alt="">
        <div>
          <div class="slot-label">${label}</div>
          <div class="slot-name">${escapeHtml(g.name || g.category)}</div>
        </div>
      </div>`
    )
    .join("");
  suggestWearBtn.disabled = false;
}

document.getElementById("suggestShuffleBtn").addEventListener("click", () => {
  if (currentSuggestion) {
    [currentSuggestion.dress, currentSuggestion.top, currentSuggestion.bottom, currentSuggestion.outerwear, currentSuggestion.footwear]
      .filter(Boolean)
      .forEach((g) => excludedFromShuffle.add(g.id));
  }
  runSuggestion();
  if (!currentSuggestion.hasAnything) excludedFromShuffle = new Set();
});

document.getElementById("suggestCloseBtn").addEventListener("click", () => suggestModal.close());

suggestWearBtn.addEventListener("click", async () => {
  const s = currentSuggestion;
  if (!s) return;
  const ids = [s.dress, s.top, s.bottom, s.outerwear, s.footwear].filter(Boolean).map((g) => g.id);
  if (!ids.length) return;
  await markGarmentsWorn(ids, `Suggested (${currentOccasion || "any"})`);
  await loadAll();
  suggestModal.close();
  render();
});

async function wearOutfit(outfitId) {
  const outfit = outfits.find((o) => o.id === outfitId);
  if (!outfit) return;
  await markGarmentsWorn(outfit.garmentIds, outfit.name);
  await loadAll();
  render();
}

async function deleteOutfit(outfitId) {
  if (!confirm("Delete this outfit?")) return;
  await db.delete("outfits", outfitId);
  await loadAll();
  render();
}

async function markGarmentsWorn(garmentIds, outfitName) {
  const now = Date.now();
  for (const id of garmentIds) {
    const g = garmentById(id);
    if (!g) continue;
    g.wearCount = (g.wearCount || 0) + 1;
    g.lastWorn = now;
    await db.put("garments", g);
  }
  await db.put("wearLog", {
    id: uid(),
    date: now,
    garmentIds,
    outfitName: outfitName || null,
  });
}

// ---------- outfit photo matcher ----------
const matcherModal = document.getElementById("matcherModal");
const matcherPhotoInput = document.getElementById("matcherPhotoInput");
const matcherPhotoPreview = document.getElementById("matcherPhotoPreview");
const matcherAnalyzeBtn = document.getElementById("matcherAnalyzeBtn");
const matcherStatusText = document.getElementById("matcherStatusText");
const matcherSpinner = document.getElementById("matcherSpinner");
const matcherResults = document.getElementById("matcherResults");
const matcherSaveBtn = document.getElementById("matcherSaveBtn");

let matcherPhotoDataUrl = null;
let matcherMatches = [];

function setMatcherStatus(text, busy = false) {
  matcherStatusText.textContent = text;
  matcherSpinner.hidden = !busy;
}

function openMatcherModal() {
  matcherPhotoDataUrl = null;
  matcherMatches = [];
  matcherPhotoPreview.hidden = true;
  matcherAnalyzeBtn.hidden = true;
  matcherSaveBtn.hidden = true;
  matcherResults.innerHTML = "";
  setMatcherStatus(getApiKey() ? "" : "Add a Gemini API key in Settings first to use outfit matching.");
  matcherModal.showModal();
}

matcherPhotoInput.addEventListener("change", async () => {
  const file = matcherPhotoInput.files[0];
  if (!file) return;
  matcherPhotoDataUrl = await fileToResizedDataUrl(file);
  matcherPhotoPreview.src = matcherPhotoDataUrl;
  matcherPhotoPreview.hidden = false;
  matcherResults.innerHTML = "";
  matcherSaveBtn.hidden = true;
  if (getApiKey()) {
    matcherAnalyzeBtn.hidden = false;
    setMatcherStatus("");
  } else {
    setMatcherStatus("Add a Gemini API key in Settings first to use outfit matching.");
  }
});

matcherAnalyzeBtn.addEventListener("click", async () => {
  if (!matcherPhotoDataUrl) return;
  matcherAnalyzeBtn.disabled = true;
  setMatcherStatus("Analyzing outfit…", true);
  matcherResults.innerHTML = "";
  matcherSaveBtn.hidden = true;
  try {
    const pieces = await identifyOutfitPieces(matcherPhotoDataUrl);
    if (!pieces.length) {
      setMatcherStatus("Couldn't identify any items in that photo.", false);
      return;
    }
    matcherMatches = matchOutfitPieces(pieces, garments);
    renderMatcherResults();
    setMatcherStatus(`Found ${pieces.length} item(s).`, false);
  } catch (err) {
    setMatcherStatus(err.message, false);
  } finally {
    matcherAnalyzeBtn.disabled = false;
  }
});

function renderMatcherResults() {
  matcherResults.innerHTML = matcherMatches
    .map(({ piece, match }, i) => {
      if (match) {
        return `
          <div class="match-row">
            <img src="${match.photo}" alt="">
            <div class="match-info">
              <div class="match-name">${escapeHtml(piece.name || piece.category)}</div>
              <div class="match-sub owned">✓ You already own: ${escapeHtml(match.name || match.category)}</div>
            </div>
          </div>`;
      }
      return `
        <div class="match-row">
          <input type="checkbox" data-piece-index="${i}" checked>
          <div class="match-info">
            <div class="match-name">${escapeHtml(piece.name || piece.category)}</div>
            <div class="match-sub unowned">Not in your closet — save to wishlist?</div>
          </div>
        </div>`;
    })
    .join("");
  const hasUnmatched = matcherMatches.some((m) => !m.match);
  matcherSaveBtn.hidden = !hasUnmatched;
}

document.getElementById("matcherCloseBtn").addEventListener("click", () => matcherModal.close());

matcherSaveBtn.addEventListener("click", async () => {
  const checkboxes = matcherResults.querySelectorAll("input[type=checkbox]:checked");
  const indices = [...checkboxes].map((cb) => Number(cb.dataset.pieceIndex));
  if (!indices.length) return;
  for (const i of indices) {
    const { piece } = matcherMatches[i];
    await db.put("wishlist", {
      id: uid(),
      name: piece.name,
      category: piece.category,
      colors: piece.colors,
      tags: piece.tags,
      sourcePhoto: matcherPhotoDataUrl,
      createdAt: Date.now(),
    });
  }
  await loadAll();
  matcherModal.close();
  activeTab = "wishlist";
  render();
});

// ---------- settings ----------
const settingsModal = document.getElementById("settingsModal");
const apiKeyInput = document.getElementById("apiKeyInput");
document.getElementById("settingsBtn").addEventListener("click", () => {
  apiKeyInput.value = getApiKey();
  settingsModal.showModal();
});
document.getElementById("settingsCloseBtn").addEventListener("click", () => {
  setApiKey(apiKeyInput.value.trim());
  settingsModal.close();
});

const backupStatus = document.getElementById("backupStatus");

document.getElementById("exportBackupBtn").addEventListener("click", async () => {
  try {
    const { garmentCount, outfitCount, wearLogCount } = await exportBackup();
    backupStatus.textContent = `Exported ${garmentCount} garment(s), ${outfitCount} outfit(s), ${wearLogCount} history entr(ies).`;
  } catch (err) {
    backupStatus.textContent = `Export failed: ${err.message}`;
  }
});

document.getElementById("importBackupInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = ""; // allow re-selecting the same file later
  if (!file) return;
  try {
    const data = await readBackupFile(file);
    const summary = `${data.garments.length} garment(s), ${(data.outfits || []).length} outfit(s), ${(data.wearLog || []).length} history entr(ies)`;
    if (!confirm(`Import this backup (${summary})? This REPLACES everything currently in the app — this cannot be undone.`)) {
      return;
    }
    await importBackup(data);
    await loadAll();
    render();
    backupStatus.textContent = `Imported ${summary}.`;
  } catch (err) {
    backupStatus.textContent = `Import failed: ${err.message}`;
  }
});

// ---------- tabs ----------
tabButtons.forEach((btn) =>
  btn.addEventListener("click", () => {
    activeTab = btn.dataset.tab;
    render();
  })
);

// ---------- helpers ----------
function splitCsv(str) {
  return str
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(str) {
  return escapeHtml(str);
}

function fileToResizedDataUrl(file, maxSize = 900) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(resizeDataUrl(reader.result, maxSize));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function resizeDataUrl(dataUrl, maxSize = 900) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxSize || height > maxSize) {
        const scale = maxSize / Math.max(width, height);
        width *= scale;
        height *= scale;
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", 0.9));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

// ---------- init ----------
(async function init() {
  await loadAll();
  render();
})();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((err) => console.error("Service worker registration failed:", err));
  });
}
