const { loadEnv } = require("./env");

loadEnv();

const ADMIN_TOKEN = normalizeToken(process.env.ADMIN_TOKEN);
const DEVICE_TOKEN = normalizeToken(process.env.DEVICE_TOKEN);
const CORS_ORIGIN = normalizeCorsOrigin(process.env.CORS_ORIGIN);

function configureCors(_req, res, next) {
  if (CORS_ORIGIN) {
    res.set("Access-Control-Allow-Origin", CORS_ORIGIN);
  } else if (!ADMIN_TOKEN && !DEVICE_TOKEN) {
    res.set("Access-Control-Allow-Origin", "*");
  }

  res.set({
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Token, X-Device-Token",
  });

  next();
}

function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN || hasToken(req, ADMIN_TOKEN, "admin")) {
    next();
    return;
  }

  unauthorized(res, "ADMIN_AUTH_REQUIRED");
}

function requireDevice(req, res, next) {
  if (!DEVICE_TOKEN || hasToken(req, DEVICE_TOKEN, "device") || hasToken(req, ADMIN_TOKEN, "admin")) {
    next();
    return;
  }

  unauthorized(res, "DEVICE_AUTH_REQUIRED");
}

function requireAdminOrDevice(req, res, next) {
  const adminOk = ADMIN_TOKEN && hasToken(req, ADMIN_TOKEN, "admin");
  const deviceOk = DEVICE_TOKEN && hasToken(req, DEVICE_TOKEN, "device");

  if (!DEVICE_TOKEN || adminOk || deviceOk) {
    next();
    return;
  }

  unauthorized(res, "AUTH_REQUIRED");
}

function getDeviceToken() {
  return DEVICE_TOKEN;
}

function logAuthMode() {
  if (!ADMIN_TOKEN) {
    console.warn("ADMIN_TOKEN is not set; admin API is open.");
  }

  if (!DEVICE_TOKEN) {
    console.warn("DEVICE_TOKEN is not set; device API is open.");
  }
}

function hasToken(req, expectedToken, kind) {
  if (!expectedToken) {
    return false;
  }

  const headerName = kind === "device" ? "x-device-token" : "x-admin-token";
  const direct = req.get(headerName);
  const bearer = parseBearerToken(req.get("authorization"));
  const queryToken = kind === "device" ? req.query.deviceToken : req.query.adminToken;

  return [direct, bearer, queryToken].some((token) => token === expectedToken);
}

function parseBearerToken(value) {
  const match = /^Bearer\s+(.+)$/i.exec(String(value || "").trim());
  return match ? match[1].trim() : "";
}

function unauthorized(res, code) {
  res.status(401).json({
    error: code,
    message: "Token requerido o incorrecto",
  });
}

function normalizeToken(value) {
  return String(value || "").trim();
}

function normalizeCorsOrigin(value) {
  const origin = String(value || "").trim();
  return origin || "";
}

module.exports = {
  configureCors,
  requireAdmin,
  requireDevice,
  requireAdminOrDevice,
  getDeviceToken,
  logAuthMode,
};
