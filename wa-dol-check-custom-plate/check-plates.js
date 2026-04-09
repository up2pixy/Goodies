#!/usr/bin/env node

/**
 * WA DOL Personalized License Plate Availability Checker
 *
 * Usage:
 *   node check-plates.js PLATE1 PLATE2 PLATE3 ...
 *
 * Examples:
 *   node check-plates.js 1 HELLO NODEJS
 *   node check-plates.js "GO DAWGS" MSFT 42
 *
 * Rules (from WA DOL):
 *   - Standard plates: 1-7 characters
 *   - Motorcycle/small trailer: 1-6 characters
 *   - Allowed: letters, numbers, hyphens, spaces
 *   - Not allowed: #, %, &, @, +, ! etc.
 *   - I/1 and O/0 are treated as identical
 */

const puppeteer = require("puppeteer");

const DOL_URL =
  "https://fortress.wa.gov/dol/extdriveses/ESP/NoLogon/?Link=PersonalizedPlate";

// Delay helper
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Launch browser and check a list of plates.
 * Returns an array of { plate, status, detail } objects.
 */
async function checkPlates(plates, options = {}) {
  const { headless = true, timeout = 30000, delayBetween = 500 } = options;

  const browser = await puppeteer.launch({
    headless: headless ? "new" : false,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const results = [];
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(timeout);
  page.setDefaultTimeout(timeout);

  // Set a realistic user-agent
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
  );
  try {
    for (const plate of plates) {

      console.log(`\nChecking plate: "${plate}" ...`);

      try {
        // Navigate to the search page (fresh load each time for clean state)
        await page.goto(DOL_URL, { waitUntil: "networkidle2" });

        // Find the plate input field — try common ASP.NET naming patterns
        const inputSelector = await findElement(page, [
          'input[type="text"]',
        ]);

        if (!inputSelector) {
          results.push({
            plate,
            status: "ERROR",
            detail: "Could not find plate input field on page",
          });
          continue;
        }

        // Clear any existing text and type the plate number
        await page.click(inputSelector);
        await page.evaluate(
          (sel) => (document.querySelector(sel).value = ""),
          inputSelector
        );
        await page.type(inputSelector, plate);

        // Find and click the search button
        const buttonSelector = await findElement(page, [
          'button[type="button"]',
        ]);

        if (!buttonSelector) {
          results.push({
            plate,
            status: "ERROR",
            detail: "Could not find search button on page",
          });
          continue;
        }

        // Click search and wait for results
        await Promise.all([
          page.click(buttonSelector),
          page.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => { }),
        ]);

        // Wait a moment for any dynamic content to load
        //await delay(1500);

        // Extract the result text from the page
        const resultText = await page.evaluate(() => {
          // Look for common result containers
          const selectors = [
            '#caption2_Dr-5',
          ];

          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el && el.textContent.trim().length > 0) {
              return el.textContent.trim();
            }
          }

          // Fallback: get the full body text
          return document.body.innerText || document.body.textContent || "";
        });

        // Parse the result
        const parsed = parseResult(plate, resultText);
        results.push(parsed);

        console.log(`  -> ${parsed.status}: ${parsed.detail}`);

        // Be polite — wait between requests
        if (plates.indexOf(plate) < plates.length - 1) {
          await delay(delayBetween);
        }
      } catch (err) {
        results.push({
          plate,
          status: "ERROR",
          detail: err.message,
        });
        console.log(`  -> ERROR: ${err.message}`);
      }
    }
  } finally {
    await browser.close();
  }

  return results;
}

/**
 * Try multiple selectors and return the first one that matches an element.
 */
async function findElement(page, selectors) {
  for (const sel of selectors) {
    const el = await page.$(sel);
    if (el) return sel;
  }
  return null;
}

/**
 * Parse the raw result text into a structured status.
 */
function parseResult(plate, text) {
  const lower = text.toLowerCase();

  if (
    lower.includes("congratulations")
  ) {
    return {
      plate,
      status: "AVAILABLE",
      detail: extractRelevantLine(text, "available"),
    };
  }

  if (
    lower.includes("not available")
  ) {
    return {
      plate,
      status: "TAKEN",
      detail: extractRelevantLine(
        text,
        "not available",
        "unavailable",
        "already in use",
        "taken",
        "cannot"
      ),
    };
  }

  if (
    lower.includes("invalid") ||
    lower.includes("not allowed") ||
    lower.includes("unacceptable") ||
    lower.includes("restricted")
  ) {
    return {
      plate,
      status: "INVALID",
      detail: extractRelevantLine(
        text,
        "invalid",
        "not allowed",
        "unacceptable",
        "restricted",
      ),
    };
  }

  // Couldn't parse a clear answer — return the raw text (trimmed)
  return {
    plate,
    status: "UNKNOWN",
    detail: text.substring(0, 300),
  };
}

/**
 * Find the most relevant line from the result text that contains one of the keywords.
 */
function extractRelevantLine(text, ...keywords) {
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (keywords.some((kw) => lower.includes(kw))) {
      return line.substring(0, 200);
    }
  }
  return text.substring(0, 200);
}

// ──────────────────────────────────────────────
// CLI entry point
// ──────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log("WA DOL Personalized License Plate Checker");
    console.log("==========================================");
    console.log("");
    console.log("Usage: node check-plates.js [options] PLATE1 PLATE2 ...");
    console.log("");
    console.log("Options:");
    console.log("  --visible     Run browser in visible mode (not headless)");
    console.log("  --delay=N     Delay in ms between checks (default: 500)");
    console.log("  --timeout=N   Page timeout in ms (default: 30000)");
    console.log("  --json        Output results as JSON");
    console.log("");
    console.log("Examples:");
    console.log('  node check-plates.js 1 HELLO "GO DAWGS"');
    console.log("  node check-plates.js --json --visible MSFT AZURE");
    process.exit(0);
  }

  // Parse options
  const options = {
    headless: true,
    delayBetween: 500,
    timeout: 30000,
  };
  let jsonOutput = false;
  const plates = [];

  for (const arg of args) {
    if (arg === "--visible") {
      options.headless = false;
    } else if (arg === "--json") {
      jsonOutput = true;
    } else if (arg.startsWith("--delay=")) {
      options.delayBetween = parseInt(arg.split("=")[1], 10);
    } else if (arg.startsWith("--timeout=")) {
      options.timeout = parseInt(arg.split("=")[1], 10);
    } else {
      plates.push(arg.toUpperCase());
    }
  }

  if (plates.length === 0) {
    console.error("Error: No plate numbers provided.");
    process.exit(1);
  }

  console.log(`Checking ${plates.length} plate(s): ${plates.join(", ")}`);
  console.log("---");

  const results = await checkPlates(plates, options);

  console.log("\n===================================");
  console.log("         RESULTS SUMMARY");
  console.log("===================================");

  if (jsonOutput) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    const maxLen = Math.max(...results.map((r) => r.plate.length));
    for (const r of results) {
      const icon =
        r.status === "AVAILABLE"
          ? "[YES]"
          : r.status === "TAKEN"
            ? "[NO] "
            : r.status === "INVALID"
              ? "[BAD]"
              : r.status === "ERROR"
                ? "[ERR]"
                : "[???]";
      console.log(`  ${icon}  ${r.plate.padEnd(maxLen)}  ${r.detail}`);
    }
  }

  // Exit with non-zero if any errors
  const hasErrors = results.some((r) => r.status === "ERROR");
  process.exit(hasErrors ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
