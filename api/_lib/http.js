const MAX_BODY_BYTES = 2_000_000;

const sendJson = (res, statusCode, obj) => {
  const body = JSON.stringify(obj ?? null);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(body);
};

const sendText = (res, statusCode, text) => {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(String(text || ""));
};

const readJsonBody = async (req) => {
  try {
    if (typeof req.body !== "undefined") return req.body;
  } catch (err) {
    err.statusCode = err.statusCode || 400;
    throw err;
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const err = new Error("Payload too large");
      err.statusCode = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    err.statusCode = 400;
    throw err;
  }
};

module.exports = {
  sendJson,
  sendText,
  readJsonBody,
};

