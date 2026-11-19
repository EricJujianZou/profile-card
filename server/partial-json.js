// Reads the JSON the model is still writing. Returns the value parsed so far, or undefined.
// An open string value is closed where it stops, so a long verdict can show word by word.

export function parsePartialJson(text) {
  const stack = [];
  let inStr = false, esc = false, strIsKey = false, prev = "";
  let safeAt = -1, safeStack = [];
  const markSafe = (i) => { safeAt = i; safeStack = stack.slice(); };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') { inStr = false; prev = '"'; if (!strIsKey) markSafe(i + 1); }
      continue;
    }
    if (ch === " " || ch === "\n" || ch === "\r" || ch === "\t") continue;
    if (ch === '"') {
      inStr = true;
      strIsKey = stack[stack.length - 1] === "{" && (prev === "{" || prev === ",");
      continue;
    }
    if (ch === "{" || ch === "[") { stack.push(ch); prev = ch; markSafe(i + 1); continue; }
    if (ch === "}" || ch === "]") { stack.pop(); prev = ch; markSafe(i + 1); continue; }
    if (ch === "," || ch === ":") { prev = ch; continue; }
    prev = "v";
    const next = text[i + 1];
    if (next !== undefined && /[\s,\]}]/.test(next)) markSafe(i + 1);
  }

  const close = (body, st) => {
    let out = body;
    for (let k = st.length - 1; k >= 0; k--) out += st[k] === "{" ? "}" : "]";
    try { return JSON.parse(out); } catch { return undefined; }
  };

  if (inStr && !strIsKey) {
    let body = esc ? text.slice(0, -1) : text;
    body = body.replace(/\\u[0-9a-fA-F]{0,3}$/, "");
    const value = close(body + '"', stack);
    if (value !== undefined) return value;
  }
  if (safeAt < 0) return undefined;
  return close(text.slice(0, safeAt), safeStack);
}
