const fs = require("fs");
const readline = require("readline");
const axios = require("axios");
const PushoverAPI = require("./PushoverAPI");
const clc = require("cli-color");
require("dotenv").config();

const ENV_FILE = ".env";
const TESTFLIGHT_BASE_URL = "https://testflight.apple.com/join/";

function loadEnv() {
  if (fs.existsSync(ENV_FILE)) {
    const content = fs.readFileSync(ENV_FILE, "utf8");
    return Object.fromEntries(
      content
        .split("\n")
        .filter((line) => line && !line.startsWith("#"))
        .map((line) => line.split("=").map((part) => part.trim()))
    );
  }
  return {};
}

function saveEnv(env) {
  const content = Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  fs.writeFileSync(ENV_FILE, content);
}

function saveURLs(urls) {
  const env = loadEnv();
  env.TESTFLIGHT_URLS = JSON.stringify(urls);
  saveEnv(env);
}

function loadURLs() {
  const env = loadEnv();
  return env.TESTFLIGHT_URLS ? JSON.parse(env.TESTFLIGHT_URLS) : [];
}

async function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    })
  );
}

async function verifyURL(url) {
  try {
    const response = await axios.get(url, { timeout: 5000 });
    if (response.status === 200) {
      console.log(
        clc.greenBright("\n✅ The URL is valid and the beta exists.")
      );
      return true;
    }
  } catch (error) {
    const errorMessage =
      error.response && error.response.status === 404
        ? "\n❌ Error: The beta does not exist (404)."
        : "❌ Error: Could not check the page. Network issue?";
    console.log(clc.redBright(errorMessage));
  }
  return false;
}

function displayMessage(message, type = "info") {
  const color =
    type === "success"
      ? clc.green
      : type === "error"
      ? clc.red
      : clc.magentaBright;
  console.log(color(message));
}

async function manageURLs(userKey, appToken) {
  let urls = loadURLs();

  while (true) {
    clearConsole();
    displayMessage("📜 Current TestFlight URLs:", "info");
    urls.forEach((app, index) => {
      console.log(clc.yellow(`${index + 1}. ${app.name} - ${app.url}`));
    });

    console.log("\n🛠️ Options:");
    console.log("1. 🆕 Add a new URL");
    console.log("2. 🗑️ Delete an existing URL");
    console.log("3. ✅ Done");

    const choice = await prompt(clc.cyan("Choose an option (1/2/3): "));

    if (choice === "1") {
      const name = await prompt(clc.cyan("\nApp Name: "));
      let input = await prompt(clc.cyan("TestFlight URL or ID: "));
      let url = input.startsWith(TESTFLIGHT_BASE_URL)
        ? input
        : `${TESTFLIGHT_BASE_URL}${input}`;

      if (urls.some((app) => app.url === url)) {
        displayMessage("\n❌ This URL has already been added.", "error");
        displayMessage("🔙 Returning to main menu...", "info");
        await pause(3000);
        continue;
      }

      const isValid = await verifyURL(url);
      if (isValid) {
        urls.push({ name, url });
        saveURLs(urls);
        await sendPushoverNotification(
          userKey,
          appToken,
          "🆕 TestFlight URL added",
          `The TestFlight beta for ${name} is now available.\n\nURL: ${url}`
        );
        displayMessage("\n📲 Notification sent.", "success");
        displayMessage("✅ New URL added.", "success");
        displayMessage("🔙 Returning to main menu...", "info");
        await pause(3000);
      } else {
        displayMessage(
          "❌ The URL was not added because it is invalid.",
          "error"
        );
        displayMessage("🔙 Returning to main menu...", "info");
        await pause(3000);
      }
    } else if (choice === "2") {
      const index =
        parseInt(await prompt(clc.cyan("Number of the URL to delete: ")), 10) -
        1;
      if (index >= 0 && index < urls.length) {
        displayMessage(
          `\n🗑️ Deleting: ${urls[index].name} - ${urls[index].url}`,
          "error"
        );
        await sendPushoverNotification(
          userKey,
          appToken,
          "🗑️ TestFlight URL deleted",
          `The TestFlight beta for ${urls[index].name} has been deleted.\n\nURL: ${urls[index].url}`
        );
        displayMessage("\n📲 Notification sent.", "success");
        urls.splice(index, 1);
        saveURLs(urls);
        displayMessage("✅ URL deleted.", "success");
        displayMessage("🔙 Returning to main menu...", "info");
        await pause(3000);
      } else {
        displayMessage("❌ Invalid selection.", "error");
        await pause(3000);
      }
    } else if (choice === "3") {
      break;
    } else {
      displayMessage("❌ Invalid input.", "error");
      await pause(3000);
    }
  }
}
