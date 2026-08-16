const path = require("node:path");
const { loadEnv } = require("./env");

loadEnv();

const express = require("express");
const puppeteer = require("puppeteer");
const sharp = require("sharp");
const fs = require("node:fs");
const {
  configureCors,
  requireAdmin,
  requireDevice,
  requireAdminOrDevice,
  getDeviceToken,
  logAuthMode,
} = require("./auth");
const {
  getDashboard,
  getSensors,
  saveSensors,
  getDeviceSettings,
  saveDeviceSettings,
  getCalendars,
  saveCalendars,
  getEventExceptions,
  saveEventExceptions,
  getWeatherLocation,
  saveWeatherLocation,
  getScreenState,
  moveScreenMonth,
  resetScreenMonth,
  setScreenMonthOffset,
} = require("./database");
const { getEinkData } = require("./eink-data-service");
const { getCalendarDiagnostics } = require("./ics-service");
const { getWeatherDiagnostics } = require("./weather-service");

const PORT = Number(process.env.PORT || 3000);
const EINK_WIDTH = 800;
const EINK_HEIGHT = 480;
const FRONTEND_DIST = path.resolve(__dirname, "../../frontend/dist");
const hasBuiltFrontend = fs.existsSync(path.join(FRONTEND_DIST, "index.html"));
const RENDER_URL =
  process.env.EINK_RENDER_URL ||
  (hasBuiltFrontend
    ? `http://localhost:${PORT}/eink`
    : "http://127.0.0.1:5173/eink");

const app = express();
let browserPromise;

app.use(express.json());
app.use(configureCors);
app.options("*", (_req, res) => res.sendStatus(204));
app.use(express.static(FRONTEND_DIST));

app.get("/api/screen.bmp", requireDevice, async (_req, res, next) => {
  try {
    const bmp = await renderUrlToBmp(RENDER_URL);

    res
      .status(200)
      .type("image/bmp")
      .set({
        "Cache-Control": "no-store, max-age=0",
        "Content-Length": bmp.length,
      })
      .send(bmp);
  } catch (error) {
    next(error);
  }
});

app.get("/api/eink-data", requireAdminOrDevice, async (req, res, next) => {
  try {
    res.json(await getEinkData({ monthOffset: req.query.monthOffset }));
  } catch (error) {
    next(error);
  }
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/screen/state", requireAdminOrDevice, (_req, res, next) => {
  sendJson(res, next, getScreenState);
});

app.post("/api/screen/month/previous", requireDevice, (_req, res, next) => {
  sendJson(res, next, () => moveScreenMonth(-1));
});

app.post("/api/screen/month/next", requireDevice, (_req, res, next) => {
  sendJson(res, next, () => moveScreenMonth(1));
});

app.post("/api/screen/month/current", requireDevice, (_req, res, next) => {
  sendJson(res, next, resetScreenMonth);
});

app.put("/api/screen/month", requireAdmin, (req, res, next) => {
  sendJson(res, next, () => setScreenMonthOffset((req.body || {}).monthOffset));
});

app.get("/api/dashboard", requireAdmin, (_req, res, next) => {
  sendJson(res, next, getDashboard);
});

app.get("/api/device/sensors", requireAdmin, (_req, res, next) => {
  sendJson(res, next, getSensors);
});

app.post("/api/device/sensors", requireDevice, (req, res, next) => {
  sendJson(res, next, () => saveSensors(req.body || {}));
});

app.get("/api/device/settings", requireAdminOrDevice, (_req, res, next) => {
  sendJson(res, next, getDeviceSettings);
});

app.put("/api/device/settings", requireAdmin, (req, res, next) => {
  sendJson(res, next, () => saveDeviceSettings(req.body || {}));
});

app.get("/api/calendars", requireAdmin, (_req, res, next) => {
  sendJson(res, next, getCalendars);
});

app.put("/api/calendars", requireAdmin, (req, res, next) => {
  sendJson(res, next, () => saveCalendars((req.body || {}).calendars || []));
});

app.post("/api/calendars/test", requireAdmin, async (req, res, next) => {
  try {
    const payload = req.body || {};
    const calendars = Array.isArray(payload.calendars)
      ? payload.calendars
      : getCalendars();
    const exceptions = Array.isArray(payload.keywords)
      ? payload.keywords
      : getEventExceptions();

    res.json(await getCalendarDiagnostics(calendars, exceptions));
  } catch (error) {
    next(error);
  }
});

app.get("/api/event-exceptions", requireAdmin, (_req, res, next) => {
  sendJson(res, next, getEventExceptions);
});

app.put("/api/event-exceptions", requireAdmin, (req, res, next) => {
  sendJson(res, next, () => saveEventExceptions((req.body || {}).keywords || []));
});

app.get("/api/weather/location", requireAdmin, (_req, res, next) => {
  sendJson(res, next, getWeatherLocation);
});

app.put("/api/weather/location", requireAdmin, (req, res, next) => {
  sendJson(res, next, () => saveWeatherLocation(req.body || {}));
});

app.get("/api/weather/test", requireAdmin, async (_req, res, next) => {
  try {
    res.json(await getWeatherDiagnostics(getWeatherLocation({ includeSecret: true })));
  } catch (error) {
    next(error);
  }
});

app.post("/api/weather/test", requireAdmin, async (req, res, next) => {
  try {
    const current = getWeatherLocation({ includeSecret: true });
    const payload = req.body || {};
    const location = {
      ...current,
      ...payload,
      openWeatherApiKey: payload.clearOpenWeatherApiKey
        ? ""
        : payload.openWeatherApiKey || current.openWeatherApiKey,
    };

    res.json(await getWeatherDiagnostics(location));
  } catch (error) {
    next(error);
  }
});

app.get(["/", "/eink", "/control"], (_req, res) => {
  res.sendFile(path.join(FRONTEND_DIST, "index.html"));
});

app.use((error, _req, res, _next) => {
  console.error(error);
  const status = error.statusCode || 500;

  res.status(status).json({
    error: status >= 500 ? "SERVER_ERROR" : "BAD_REQUEST",
    message: error.message,
  });
});

function sendJson(res, next, read) {
  try {
    res.json(read());
  } catch (error) {
    error.statusCode = 400;
    next(error);
  }
}

const server = app.listen(PORT);

server.on("listening", () => {
  console.log(`E-ink server listening on http://localhost:${PORT}`);
  console.log(`Screen renderer target: ${RENDER_URL}`);
  logAuthMode();
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `Port ${PORT} is already in use. Stop the existing process or start with another PORT.`,
    );
    process.exit(1);
  }

  throw error;
});

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      defaultViewport: {
        width: EINK_WIDTH,
        height: EINK_HEIGHT,
        deviceScaleFactor: 1,
      },
    });
  }

  return browserPromise;
}

async function renderUrlToBmp(url) {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setViewport({
      width: EINK_WIDTH,
      height: EINK_HEIGHT,
      deviceScaleFactor: 1,
    });

    const deviceToken = getDeviceToken();
    if (deviceToken) {
      await page.setExtraHTTPHeaders({
        "X-Device-Token": deviceToken,
      });
    }

    await page.goto(url, {
      waitUntil: "networkidle0",
      timeout: 30_000,
    });

    await page
      .evaluate(() => (document.fonts ? document.fonts.ready : true))
      .catch(() => undefined);

    const png = await page.screenshot({
      type: "png",
      fullPage: false,
      clip: {
        x: 0,
        y: 0,
        width: EINK_WIDTH,
        height: EINK_HEIGHT,
      },
    });

    const { data, info } = await sharp(png)
      .flatten({ background: "#ffffff" })
      .resize(EINK_WIDTH, EINK_HEIGHT, { fit: "fill" })
      .raw()
      .toBuffer({ resolveWithObject: true });

    return encodeRgbToBmp(data, info.width, info.height, info.channels);
  } finally {
    await page.close();
  }
}

function encodeRgbToBmp(rgb, width, height, channels) {
  if (channels < 3) {
    throw new Error(`Expected at least 3 channels, received ${channels}`);
  }

  const fileHeaderSize = 14;
  const dibHeaderSize = 40;
  const pixelOffset = fileHeaderSize + dibHeaderSize;
  const bytesPerPixel = 3;
  const rowStride = Math.ceil((width * bytesPerPixel) / 4) * 4;
  const pixelDataSize = rowStride * height;
  const fileSize = pixelOffset + pixelDataSize;
  const bmp = Buffer.alloc(fileSize);

  bmp.write("BM", 0, 2, "ascii");
  bmp.writeUInt32LE(fileSize, 2);
  bmp.writeUInt32LE(pixelOffset, 10);
  bmp.writeUInt32LE(dibHeaderSize, 14);
  bmp.writeInt32LE(width, 18);
  bmp.writeInt32LE(height, 22);
  bmp.writeUInt16LE(1, 26);
  bmp.writeUInt16LE(24, 28);
  bmp.writeUInt32LE(0, 30);
  bmp.writeUInt32LE(pixelDataSize, 34);
  bmp.writeInt32LE(2835, 38);
  bmp.writeInt32LE(2835, 42);

  for (let y = 0; y < height; y += 1) {
    const sourceY = height - 1 - y;
    const targetRow = pixelOffset + y * rowStride;

    for (let x = 0; x < width; x += 1) {
      const source = (sourceY * width + x) * channels;
      const target = targetRow + x * bytesPerPixel;

      bmp[target] = rgb[source + 2];
      bmp[target + 1] = rgb[source + 1];
      bmp[target + 2] = rgb[source];
    }
  }

  return bmp;
}

async function closeBrowser() {
  if (!browserPromise) {
    return;
  }

  const browser = await browserPromise;
  await browser.close();
}

process.on("SIGINT", async () => {
  await closeBrowser();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await closeBrowser();
  process.exit(0);
});
