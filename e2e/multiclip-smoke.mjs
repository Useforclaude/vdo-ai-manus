import { chromium } from "@playwright/test";

const baseUrl = "http://127.0.0.1:3000";
const firstClip = "/tmp/cineflow-smoke/clip-one.mp4";
const secondClip = "/tmp/cineflow-smoke/clip-two.mp4";

const browser = await chromium.launch({ headless: true, executablePath: "/usr/bin/chromium" });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const fileInput = page.locator('input[type="file"][accept="video/*"]');

  await fileInput.setInputFiles(firstClip);
  await page.getByText(/1\. clip-one\.mp4/).waitFor({ state: "visible", timeout: 20_000 });
  await fileInput.setInputFiles(secondClip);
  await page.getByText(/2\. clip-two\.mp4/).waitFor({ state: "visible", timeout: 20_000 });

  await page.getByRole("button", { name: /2\. clip-two\.mp4/ }).click();
  await page.locator("video").waitFor({ state: "visible", timeout: 10_000 });
  const previewUrl = await page.locator("video").getAttribute("src");
  if (!previewUrl?.includes("clip-two")) throw new Error("Selected-clip preview did not switch to the second clip");
  await page.getByText("AUDIO WAVEFORM", { exact: true }).waitFor({ state: "visible", timeout: 10_000 });
  const silencePreviewed = page.waitForResponse(response => response.url().includes("video.previewClipSilences") && response.ok(), { timeout: 30_000 });
  await page.getByRole("button", { name: "Preview silence" }).click();
  await silencePreviewed;

  await page.getByRole("button", { name: "Move clip up" }).nth(1).click();
  await page.getByText(/1\. clip-two\.mp4/).waitFor({ state: "visible", timeout: 10_000 });

  const trimStart = page.getByLabel("Clip trim start");
  const trimEnd = page.getByLabel("Clip trim end");
  const waveform = page.getByLabel(/Waveform timeline/);
  await waveform.waitFor({ state: "visible", timeout: 10_000 });
  await waveform.click({ position: { x: 110, y: 30 } });
  if (Number(await trimStart.inputValue()) <= 0) throw new Error("Waveform click did not set a visible trim start");
  await page.getByRole("button", { name: "Set end" }).click();
  await waveform.click({ position: { x: 290, y: 30 } });
  if (Number(await trimEnd.inputValue()) <= Number(await trimStart.inputValue())) throw new Error("Waveform click did not set a trim end after the start");
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
  await page.waitForFunction(() => !document.querySelector('[aria-label="Undo timeline"]')?.hasAttribute("disabled"), { timeout: 10_000 });
  const trimUndone = page.waitForResponse(response => response.url().includes("video.setClipTrim") && response.ok(), { timeout: 10_000 });
  await page.getByLabel("Undo timeline").click();
  await trimUndone;
  await page.waitForFunction(() => !document.querySelector('[aria-label="Redo timeline"]')?.hasAttribute("disabled"), { timeout: 10_000 });
  const trimRedone = page.waitForResponse(response => response.url().includes("video.setClipTrim") && response.ok(), { timeout: 10_000 });
  await page.getByLabel("Redo timeline").click();
  await trimRedone;

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

  const projectDuplicated = page.waitForResponse(response => response.url().includes("video.duplicateProject") && response.ok(), { timeout: 10_000 });
  await page.getByRole("button", { name: "Duplicate" }).click();
  await projectDuplicated;
  await page.getByRole("button", { name: "Clip library" }).click();
  await library.getByLabel("Search projects").fill("Copy of E2E Timeline Studio");
  await library.getByText("Copy of E2E Timeline Studio", { exact: true }).waitFor({ state: "visible", timeout: 10_000 });
  await library.getByRole("button", { name: /Copy of E2E Timeline Studio/ }).click();
  await library.waitFor({ state: "hidden", timeout: 10_000 });

  const presetDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export preset" }).click();
  const exportedPreset = await presetDownload;
  const exportedPresetPath = await exportedPreset.path();
  if (!exportedPresetPath) throw new Error("Project preset export did not create a local download");
  page.once("dialog", dialog => dialog.accept());
  await page.getByLabel("Import project preset").setInputFiles(exportedPresetPath);
  await page.getByText("นำ preset โครงการมาใช้แล้ว").waitFor({ state: "visible", timeout: 10_000 });

  const command = page.locator("textarea");
  await command.fill("Create subtitles");
  await page.getByText("Subtitle style for this edit").waitFor({ state: "visible", timeout: 10_000 });
  await page.getByRole("button", { name: /Thai Story/ }).click();
  await page.getByLabel("Custom subtitle preset name").fill("E2E Thai Story");
  const presetCreated = page.waitForResponse(response => response.url().includes("video.createCustomSubtitlePreset") && response.ok(), { timeout: 10_000 });
  await page.getByRole("button", { name: "Save preset" }).click();
  await presetCreated;
  await page.getByRole("button", { name: "E2E Thai Story", exact: true }).click();

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
    checks: ["two uploads", "selected preview", "silence preview", "audio waveform panel and trim selection", "clip reorder", "saved clip trim with undo/redo", "project rename and library open", "project duplication", "project preset export/import", "Thai subtitle preset", "saved and selected custom subtitle preset", "completed edit", "project deletion"],
  }));
} finally {
  await browser.close();
}
