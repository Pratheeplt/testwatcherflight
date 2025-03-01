const fs = require("fs");
const { execSync } = require("child_process");
require("dotenv").config();
const axios = require("axios");
const PushoverAPI = require("./PushoverAPI");
const cheerio = require("cheerio");
const clc = require("cli-color");
const crypto = require("crypto");
const path = require("path");
const express = require("express");

const CURRENT_VERSION = "0.0.2";
const UPDATE_CHECK_URL =
  "https://git.lunoxia.net/MaximilianGT500/testflight-watcher/raw/branch/main/version.json";
const SETUP_FILE_NAME = process.env.SETUP_FILE_NAME || "setup.js";
const SERVER_FILE_NAME = process.env.SERVER_FILE_NAME || "index.js";
const USER_AGENT =
  process.env.USER_AGENT || "Testflight-Watcher/0.0.2 (Monitoring Script)";
const OTP_SECRET = process.env.OTP_SECRET || "ChangeThisString";
const OTP_VALIDITY = process.env.OTP_VALIDITY || "5 * 60 * 1000";
const PORT = process.env.PORT || "3000";
const HTTP_URL = process.env.HTTP_URL || `http://localhost:${PORT}`;
const PUSHOVER_PRIORITY = process.env.PUSHOVER_PRIORITY || `1`;
const CHECK_INTERVAL = process.env.CHECK_INTERVAL || `30`;
let TESTFLIGHT_URLS = [];
let OTP_STORAGE = {};

function loadConfig() {
  if (!fs.existsSync(".env")) {
    console.log(
      clc.yellowBright("⚠️ Configuration file `.env` is missing. Starting setup...")
    );
    execSync(`node ${SETUP_FILE_NAME}`, { stdio: "inherit" });
    require("dotenv").config();
  }

  const PUSHOVER_USER_KEY = process.env.PUSHOVER_USER_KEY;
  const PUSHOVER_APP_TOKEN = process.env.PUSHOVER_APP_TOKEN;
  TESTFLIGHT_URLS = process.env.TESTFLIGHT_URLS
    ? JSON.parse(process.env.TESTFLIGHT_URLS)
    : [];

  if (!PUSHOVER_USER_KEY || !PUSHOVER_APP_TOKEN) {
    console.error(
      clc.redBright(
        `❌ Missing configuration. Please restart the setup: "node ${SETUP_FILE_NAME}".`
      )
    );
    execSync(`node ${SETUP_FILE_NAME}`, { stdio: "inherit" });
    require("dotenv").config();
    process.exit(1);
  }

  if (!Array.isArray(TESTFLIGHT_URLS) || TESTFLIGHT_URLS.length === 0) {
    console.error(
      clc.redBright(
        "❌ No valid TestFlight URLs found in the configuration. Please restart the setup."
      )
    );
    execSync(`node ${SETUP_FILE_NAME}`, { stdio: "inherit" });
    process.exit(1);
  }

  return { PUSHOVER_USER_KEY, PUSHOVER_APP_TOKEN };
}

async function checkForUpdates() {
  try {
    console.clear();
    console.log(clc.cyan("🔄 Checking for updates..."));
    const { data } = await axios.get(UPDATE_CHECK_URL);
    const latestVersion = data.version;

    if (latestVersion !== CURRENT_VERSION) {
      console.log(
        clc.yellowBright(
          `🚨 New version available: ${latestVersion}. Please update the script.\n`
        )
      );
    } else {
      console.log(clc.green("✅ Script is up to date.\n"));
    }
  } catch (error) {
    console.error(
      clc.redBright("❌ Error while checking for updates:", error.message)
    );
  }
}

function updateTestFlightURLs(newURLs) {
  const envPath = path.resolve(__dirname, ".env");
  let envFile = fs.readFileSync(envPath, "utf8");

  const testflightUrlsRegex = /TESTFLIGHT_URLS=[^\n]*/;
  const newTestFlightUrls = `TESTFLIGHT_URLS=${JSON.stringify(newURLs)}`;

  if (testflightUrlsRegex.test(envFile)) {
    envFile = envFile.replace(testflightUrlsRegex, newTestFlightUrls);
  } else {
    envFile += `\n${newTestFlightUrls}`;
  }

  fs.writeFileSync(envPath, envFile, "utf8");
  console.log(
    clc.green(
      "✅ `.env` file successfully updated with new TESTFLIGHT_URLS."
    )
  );
}

async function checkAllTestFlights(TESTFLIGHT_URLS, pushoverAPI) {
  console.clear();
  const now = new Date().toLocaleTimeString();
  console.log(clc.blue(`⏰ Last check: ${now}\n`));

  const results = await Promise.all(
    TESTFLIGHT_URLS.map((app) => checkTestFlight(app, pushoverAPI))
  );
  results.forEach((result) => console.log(result));

  console.log(
    clc.blue(
      `\n✔️ Last check completed: ${now}` +
        clc.red`\n\nPress CTRL+C to exit.`
    )
  );
}

async function checkTestFlight(app, pushoverAPI) {
  try {
    const { data } = await axios.get(app.url, {
      headers: {
        Accept: "text/html",
        "User-Agent": USER_AGENT,
      },
    });

    const $ = cheerio.load(data);
    const betaStatus = $("div.beta-status span").text().trim();

    if (betaStatus === "This beta is full.") {
      return clc.red(`❌ ${app.name}: Beta test is full.`);
    } else if (
      betaStatus === "This beta isn't accepting any new testers right now."
    ) {
      return clc.red(`❌ ${app.name}: Beta is not accepting new testers.`);
    } else {
      const otp = generateOTP(app.url);
      OTP_STORAGE[app.url] = otp;
      await sendPushoverNotification(
        pushoverAPI,
        `🎉 TestFlight beta available for ${app.name}!`,
        `The beta test for ${app.name} is available. Sign up now! 🚀\n\n${app.url}\n\nClick this link to delete the TestFlight beta URL: ${HTTP_URL}/delete?otp=${otp}&url=${app.url}`
      );
      return clc.green(
        `✅ ${app.name}: Beta test is available! Notification sent. (Status: ${betaStatus})`
      );
    }
  } catch (error) {
    return clc.redBright(
      `❌ Error retrieving page for ${app.name}: ${error.message}`
    );
  }
}

async function sendPushoverNotification(pushoverAPI, title, message) {
  const options = {
    priority: PUSHOVER_PRIORITY,
    sound: "pushover",
  };

  const response = await pushoverAPI.sendNotification(title, message, options);
  if (!response) {
    console.error(clc.redBright("❌ Error sending notification."));
  }
}

function generateOTP(url) {
  const timeWindow = Math.floor(Date.now() / OTP_VALIDITY);
  return crypto
    .createHmac("sha256", OTP_SECRET)
    .update(`${timeWindow}-${url}`)
    .digest("hex")
    .slice(0, 6);
}

function verifyOTP(otp, url) {
  const timeWindow = Math.floor(Date.now() / OTP_VALIDITY);
  const validOTP = crypto
    .createHmac("sha256", OTP_SECRET)
    .update(`${timeWindow}-${url}`)
    .digest("hex")
    .slice(0, 6);

  if (otp === validOTP && OTP_STORAGE[url] === otp) {
    delete OTP_STORAGE[url];
    return true;
  }
  return false;
}

function startServer(TESTFLIGHT_URLS) {
  const app = express();
  app.use(express.static("public"));

  app.listen(PORT, () => {
    console.log(
      clc.green("🔧 Express server is running.") +
        clc.red("\n\nPress CTRL+C to exit.")
    );
  });
}

(async () => {
  const { PUSHOVER_USER_KEY, PUSHOVER_APP_TOKEN } = loadConfig();
  const pushoverAPI = new PushoverAPI(PUSHOVER_USER_KEY, PUSHOVER_APP_TOKEN);

  await checkForUpdates();
  console.log(clc.green("🔧 TestFlight monitor started."));

  startServer(TESTFLIGHT_URLS);

  setInterval(
    () => checkAllTestFlights(TESTFLIGHT_URLS, pushoverAPI),
    CHECK_INTERVAL * 1000
  );
})();
