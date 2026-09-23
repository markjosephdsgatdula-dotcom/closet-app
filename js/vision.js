const API_KEY_STORAGE = "closet_gemini_api_key";
const MODEL_CACHE_KEY = "closet_gemini_model_cache";
const MODEL_CACHE_TTL = 24 * 60 * 60 * 1000;

// Ordered by preference for the tagging task: higher-quota Lite variants first
// (per the user's own free-tier quota check), then full Flash variants, oldest last.
const TEXT_MODEL_PRIORITY = [
  "Gemini 3.5 Flash Lite",
  "Gemini 3.1 Flash Lite",
  "Gemini 2.5 Flash Lite",
  "Gemini 3.8 Flash",
  "Gemini 3.7 Flash",
  "Gemini 3.6 Flash",
  "Gemini 3.5 Flash",
  "Gemini 3 Flash",
  "Gemini 2.5 Flash",
];

export function getApiKey() {
  return localStorage.getItem(API_KEY_STORAGE) || "";
}
export function setApiKey(key) {
  if (key) localStorage.setItem(API_KEY_STORAGE, key);
  else localStorage.removeItem(API_KEY_STORAGE);
  localStorage.removeItem(MODEL_CACHE_KEY);
}

// Asks Google directly which models this API key can actually use, rather than
// hardcoding model ID strings that go stale as Google renames/retires versions.
async function fetchModelCatalog(apiKey) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(apiKey)}`
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Could not list available models (${res.status}): ${body.slice(0, 150)}`);
  }
  const data = await res.json();
  return (data.models || []).filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"));
}

async function getModelCatalog(apiKey) {
  const cached = JSON.parse(localStorage.getItem(MODEL_CACHE_KEY) || "null");
  if (cached && cached.apiKey === apiKey && Date.now() - cached.fetchedAt < MODEL_CACHE_TTL) {
    return cached.models;
  }
  const models = await fetchModelCatalog(apiKey);
  localStorage.setItem(MODEL_CACHE_KEY, JSON.stringify({ apiKey, fetchedAt: Date.now(), models }));
  return models;
}

function bareId(model) {
  return model.name.replace(/^models\//, "");
}

// Text/vision-in, text-out models usable for the tagging task, ordered by TEXT_MODEL_PRIORITY
// with any other Flash-ish model appended as further fallback.
async function getTextModelIds(apiKey) {
  const models = await getModelCatalog(apiKey);
  const ids = [];
  for (const wanted of TEXT_MODEL_PRIORITY) {
    const match = models.find((m) => (m.displayName || "").toLowerCase() === wanted.toLowerCase());
    if (match) ids.push(bareId(match));
  }
  for (const m of models) {
    const id = bareId(m);
    const name = m.displayName || "";
    if (!ids.includes(id) && /flash|pro/i.test(name) && !/tts|audio|live|image|embed/i.test(name)) {
      ids.push(id);
    }
  }
  return ids;
}

async function callGemini(modelId, apiKey, body) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    const err = new Error(`${modelId} failed (${res.status}): ${errBody.slice(0, 150)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// Tries each candidate model in order, moving to the next on rate-limit/not-found/bad-request
// errors (429/404/400) so a capped-out or renamed model doesn't block the whole feature.
async function tryModelsInOrder(modelIds, attempt) {
  let lastErr;
  for (const modelId of modelIds) {
    try {
      return await attempt(modelId);
    } catch (err) {
      lastErr = err;
      if (err.status && ![429, 404, 400].includes(err.status)) throw err;
    }
  }
  throw lastErr || new Error("No usable Gemini model found for this API key.");
}

function parseImageDataUrl(dataUrl) {
  const match = /^data:(image\/[a-zA-Z+]+);base64,(.*)$/.exec(dataUrl);
  if (!match) throw new Error("Unsupported image format.");
  return { mediaType: match[1], base64Data: match[2] };
}

// dataUrl: "data:image/jpeg;base64,...."
export async function scanGarment(dataUrl) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("No API key set. Add one in Settings to use AI scanning.");
  const { mediaType, base64Data } = parseImageDataUrl(dataUrl);

  const prompt = `You are looking at a photo of a single clothing item. Identify it and respond with ONLY a JSON object, no other text, in this exact shape:
{"category":"one of: Shirt, T-Shirt, Jacket, Pants, Jeans, Shorts, Skirt, Dress, Shoes, Accessory, Other","colors":["color1","color2"],"tags":["tag1","tag2","tag3"],"name":"short descriptive name"}
Colors should be common color names. Tags should describe style/material/season (e.g. casual, formal, denim, summer, striped). Keep name under 6 words.`;

  const modelIds = await getTextModelIds(apiKey);
  if (!modelIds.length) throw new Error("No usable text/vision models found for this API key.");

  return tryModelsInOrder(modelIds, async (modelId) => {
    const data = await callGemini(modelId, apiKey, {
      contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mediaType, data: base64Data } }] }],
      generationConfig: { responseMimeType: "application/json" },
    });
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      const err = new Error(`${modelId} returned an unparsable response.`);
      err.status = 400;
      throw err;
    }
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      category: parsed.category || "",
      colors: Array.isArray(parsed.colors) ? parsed.colors : [],
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      name: parsed.name || "",
    };
  });
}
