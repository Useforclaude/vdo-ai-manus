import { chromium } from "@playwright/test";

const baseUrl = "http://127.0.0.1:3000";
const firstClip = "/tmp/cineflow-smoke/clip-one.mp4";
const secondClip = "/tmp/cineflow-smoke/clip-two.mp4";

const browser = await chromium.launch({ headless: true, executablePath: "/usr/bin/chromium" });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const fileInput = page.locator('input[type="file"]');

  await fileInput.setInputFiles(firstClip);
  await page.getByText(/1\. clip-one\.mp4/).waitFor({ state: "visible", timeout: 20_000 });
  await fileInput.setInputFiles(secondClip);
  await page.getByText(/2\. clip-two\.mp4/).waitFor({ state: "visible", timeout: 20_000 });

  await page.getByRole("button", { name: /2\. clip-two\.mp4/ }).click();
  await page.locator("video").waitFor({ state: "visible", timeout: 10_000 });
  const previewUrl = await page.locator("video").getAttribute("src");
  if (!previewUrl?.includes("clip-two")) throw new Error("Selected-clip preview did not switch to the second clip");

  await page.getByRole("button", { name: "Move clip up" }).nth(1).click();
  await page.getByText(/1\. clip-two\.mp4/).waitFor({ state: "visible", timeout: 10_000 });

  const command = page.locator("textarea");
  await command.fill("Create subtitles");
  await page.getByText("Subtitle style for this edit").waitFor({ state: "visible", timeout: 10_000 });
  await page.locator("label").filter({ hasText: "FONT" }).locator("select").selectOption("Inter");
  await page.locator("label").filter({ hasText: "SIZE" }).locator("select").selectOption("large");
  await page.locator("label").filter({ hasText: "POSITION" }).locator("select").selectOption("top");

  await command.fill("Crop to 16:9");
  await page.getByRole("button", { name: /Create edit/ }).click();
  await page.getByText("Crop to 16:9", { exact: true }).waitFor({ state: "visible", timeout: 20_000 });
  await page.getByRole("link", { name: "Download video" }).waitFor({ state: "visible", timeout: 30_000 });
  await page.screenshot({ path: "/tmp/cineflow-smoke/browser-multiclip-complete.png", fullPage: true });

  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: /Delete project/ }).click();
  await page.getByText("No edits yet").waitFor({ state: "visible", timeout: 15_000 });

  console.log(JSON.stringify({
    status: "passed",
    previewUrl,
    checks: ["two uploads", "selected preview", "clip reorder", "subtitle controls", "completed edit", "project deletion"],
  }));
} finally {
  await browser.close();
}
