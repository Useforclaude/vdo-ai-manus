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

  const trimStart = page.getByLabel("Clip trim start");
  const trimEnd = page.getByLabel("Clip trim end");
  await trimStart.evaluate((input) => {
    input.value = "100";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await trimEnd.evaluate((input) => {
    input.value = "1000";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const trimSaved = page.waitForResponse(response => response.url().includes("video.setClipTrim") && response.ok(), { timeout: 10_000 });
  await page.getByRole("button", { name: "Save trim" }).click();
  await trimSaved;

  const projectName = page.getByRole("textbox", { name: "Project name" });
  await projectName.fill("E2E Timeline Studio");
  const projectRenamed = page.waitForResponse(response => response.url().includes("video.renameProject") && response.ok(), { timeout: 10_000 });
  await page.getByRole("button", { name: "Save project name" }).click();
  await projectRenamed;
  await page.getByRole("button", { name: "Clip library" }).click();
  const library = page.getByRole("dialog", { name: "Project library" });
  await library.getByLabel("Search projects").fill("E2E Timeline");
  await library.getByText("E2E Timeline Studio", { exact: true }).waitFor({ state: "visible", timeout: 10_000 });
  await library.getByRole("button", { name: /E2E Timeline Studio/ }).click();
  await library.waitFor({ state: "hidden", timeout: 10_000 });

  const command = page.locator("textarea");
  await command.fill("Create subtitles");
  await page.getByText("Subtitle style for this edit").waitFor({ state: "visible", timeout: 10_000 });
  await page.getByRole("button", { name: /Thai Story/ }).click();

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
    checks: ["two uploads", "selected preview", "clip reorder", "saved clip trim", "project rename and library open", "Thai subtitle preset", "completed edit", "project deletion"],
  }));
} finally {
  await browser.close();
}
