// Frontmatter ayristirici. YAML'in sadece ihtiyac duydugumuz alt kumesi:
// key: value, tirnakli stringler, boolean, liste yok. Harici bagimlilik yok.

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function coerce(raw) {
  const v = raw.trim();
  if (v === "true") return true;
  if (v === "false") return false;
  if (v === "" || v === "null" || v === "~") return null;
  const q = v[0];
  if ((q === '"' || q === "'") && v.endsWith(q) && v.length > 1) {
    return v.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'");
  }
  return v;
}

export function parseFrontmatter(text) {
  if (typeof text !== "string") throw new Error("Metin bekleniyor");
  const m = FENCE.exec(text);
  if (!m) return { data: {}, body: text, hasFrontmatter: false };

  const data = {};
  const lines = m[1].split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const i = line.indexOf(":");
    if (i === -1) throw new Error(`Frontmatter satiri gecersiz: ${line}`);
    const key = line.slice(0, i).trim();
    if (!key) throw new Error(`Frontmatter anahtari bos: ${line}`);
    data[key] = coerce(line.slice(i + 1));
  }
  return { data, body: text.slice(m[0].length), hasFrontmatter: true };
}

const REQUIRED = ["title", "date"];

export function validatePost(data, { slug } = {}) {
  const errors = [];
  for (const k of REQUIRED) {
    if (data[k] === undefined || data[k] === null || data[k] === "") {
      errors.push(`'${k}' zorunlu`);
    }
  }
  if (data.date && !/^\d{4}-\d{2}-\d{2}([T ]|$)/.test(String(data.date))) {
    errors.push(`'date' YYYY-MM-DD olmali, gelen: ${data.date}`);
  }
  if (data.date && Number.isNaN(Date.parse(String(data.date)))) {
    errors.push(`'date' gecerli bir tarih degil: ${data.date}`);
  }
  if (data.cover && data.video) {
    errors.push("'cover' ve 'video' ayni anda olamaz");
  }
  if (data.description && String(data.description).length > 300) {
    errors.push(`'description' 300 karakteri gecmemeli (${data.description.length})`);
  }
  if (errors.length) {
    throw new Error(`${slug ? slug + ": " : ""}${errors.join("; ")}`);
  }
  return true;
}

export function isDraft(data) {
  return data.draft === true;
}
