const MAX_KEY_LEN = 180;

const sanitizeKey = (keyRaw) => {
  const key = String(keyRaw || "").trim();
  if (!key) return null;
  if (key.length > MAX_KEY_LEN) return null;
  if (key.includes("/") || key.includes("\\") || key.includes("\0")) return null;
  return key;
};

module.exports = { sanitizeKey };

