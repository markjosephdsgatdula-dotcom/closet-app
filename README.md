# Closet

A personal wardrobe app: catalog your clothes, get AI-assisted tagging, and get outfit suggestions based on weather and occasion — so the clothes you own actually get worn instead of forgotten in the back of the closet.

**Try it live:** https://markjosephdsgatdula-dotcom.github.io/closet-app/

> This is an early prototype built for personal use and feedback — expect rough edges. All your data (photos, tags, wear history) is stored **only in your own browser**, on your own device. Nothing is uploaded anywhere or shared with anyone else using the app.

## What it does

- **Catalog your garments** — take or upload a photo of each item
- **AI auto-tagging** (optional) — automatically suggests category, colors, and tags from the photo, which you can edit before saving
- **Photo cleanup** (optional, free) — crops and centers a garment photo onto a plain white background for a clean, consistent look. Works best on photos of garments laid flat or hung, not worn
- **Outfit suggestions** — get a suggested outfit based on today's weather and the occasion (casual / social / sports), prioritizing clothes you haven't worn in a while
- **Manual outfit builder** — mix and match items yourself and save the combo
- **Wear tracking** — see how often each item gets worn, and a history of past outfits

## How to navigate

1. **Add a garment** — tap the **+** button (bottom right). Take or choose a photo.
   - Optionally tap **Clean up photo** to get a clean, centered version (free, runs on your device — first use downloads a small model, so it may take a little longer the very first time).
   - Optionally tap **Scan with AI** to auto-fill the name, category, colors, and tags (requires a free API key — see below). Review and edit anything it gets wrong, then save.
2. **Closet tab** — browse everything you've added. Filter by category using the chips at the top. Tap any item to see details, wear count, and mark it as worn today.
3. **Outfits tab**
   - **✨ Suggest an outfit** — pick an occasion (or "Any"), and it'll suggest an outfit using today's weather and what you haven't worn recently. Tap **Shuffle** for a different pick, or **Wear this today** to log it.
   - **+ Build new outfit** — manually pick items and save them as a named outfit you can reuse later.
4. **History tab** — see everything you've marked as worn, with dates.
5. **Settings (⚙, top right)** — optional: paste in a free [Google Gemini API key](https://aistudio.google.com) to enable the "Scan with AI" auto-tagging feature. Not required for anything else in the app.

## Notes for feedback

Things especially worth reacting to:
- Is the flow for adding a garment quick enough, or does it feel like too many steps?
- Do the outfit suggestions actually feel useful/relevant?
- Anything confusing, broken, or that you expected to work differently?
