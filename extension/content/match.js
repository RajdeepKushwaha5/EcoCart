// Matches search-result titles to catalog devices in the browser, so titles never leave the page.
// Mirrors the alias rules in backend/src/match.py: whole-word aliases, "+" joins parts that must
// all appear, excludes rule a device out, and the longest match wins.

function normalizeTitle(text) {
  // Keep "+" as a word, so "Galaxy S25+" is not read as "Galaxy S25".
  const lowered = String(text).toLowerCase().replaceAll("+", " plus ");
  const words = lowered.replace(/[^a-z0-9]+/g, " ").split(" ").filter(Boolean);
  return ` ${words.join(" ")} `;
}

function hasPhrase(normalizedTitle, phrase) {
  const normalized = normalizeTitle(phrase);
  return normalized.trim() !== "" && normalizedTitle.includes(normalized);
}

function aliasScore(normalizedTitle, alias) {
  const parts = alias.split("+").filter((part) => part.trim());
  if (parts.length === 0 || !parts.every((part) => hasPhrase(normalizedTitle, part))) return 0;
  return parts.reduce((total, part) => total + normalizeTitle(part).trim().length, 0);
}

// Returns the single best catalog entry, or null when nothing or more than one device matches.
function matchByAlias(title, products) {
  const normalizedTitle = normalizeTitle(title);
  let best = 0;
  let winners = [];

  for (const product of products) {
    if ((product.excludes || []).some((word) => hasPhrase(normalizedTitle, word))) continue;
    const score = Math.max(0, ...(product.aliases || []).map((alias) => aliasScore(normalizedTitle, alias)));
    if (score === 0) continue;
    if (score > best) {
      best = score;
      winners = [product];
    } else if (score === best) {
      winners.push(product);
    }
  }
  return winners.length === 1 ? winners[0] : null;
}

if (typeof module !== "undefined") module.exports = { matchByAlias, normalizeTitle };
