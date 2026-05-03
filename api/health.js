const { sendJson } = require("./_lib/http");
const { getStore } = require("./_lib/kv-store");

module.exports = async (req, res) => {
  if (req.method !== "GET") return sendJson(res, 405, { ok: false, error: "Method not allowed" });

  const store = getStore();
  return sendJson(res, 200, {
    ok: true,
    time: new Date().toISOString(),
    kv: {
      driver: store.driver,
      kvPath: store.driver === "file" ? store.kvPath : undefined,
    },
  });
};

