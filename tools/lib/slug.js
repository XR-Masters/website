// Baslik -> URL slug. Turkce karakterler duzgun donusur.

const TR = {
  ç: "c", Ç: "c", ğ: "g", Ğ: "g", ı: "i", I: "i", İ: "i", i: "i",
  ö: "o", Ö: "o", ş: "s", Ş: "s", ü: "u", Ü: "u",
  â: "a", Â: "a", î: "i", Î: "i", û: "u", Û: "u",
};

export function slugify(input) {
  if (typeof input !== "string") return "";
  let s = "";
  for (const ch of input.normalize("NFC")) s += TR[ch] ?? ch;
  return s
    .toLowerCase()
    // kalan aksanlari ayikla (é -> e)
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " ve ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96)
    .replace(/-+$/g, "");
}

// Dosya yolu guvenligi: path traversal ve gizli karakterlere karsi.
export function isSafeSlug(slug) {
  return typeof slug === "string"
    && slug.length > 0 && slug.length <= 96
    && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}

export function assertSafeSlug(slug) {
  if (!isSafeSlug(slug)) throw new Error(`Gecersiz slug: ${JSON.stringify(slug)}`);
  return slug;
}
