#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.env.SMOKE_BASE_URL || 'http://localhost:3110';
const outFile = process.env.SMOKE_OUTPUT_FILE || 'docs/samples/.tmp-smoke-export.json';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 980 }, acceptDownloads: true });

const consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') {
    consoleErrors.push(msg.text());
  }
});

await page.goto(`${baseUrl}/launch-studio`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('text=/LE Studio|Launch Studio/i', { timeout: 15000 });

// language switcher + current primary simple-mode UX
if (await page.locator('#language-switcher').count()) {
  await page.locator('#language-switcher').selectOption('sk');
}

if (await page.locator('#autopilot-prompt').count()) {
  await page.locator('#autopilot-prompt').fill('Web do 24h pre lokálny salón');
} else {
  const advancedToggle = page.getByRole('button', { name: /Advanced/i }).first();
  if (await advancedToggle.count()) {
    await advancedToggle.click();
  }
  await page.locator('#brief-project-type').selectOption('support-campaign');
  await page.locator('#brief-project-name').fill('Web do 24h Project');
  await page.locator('#brief-target-audience').fill('Majitelia malých a stredných firiem, lokálni podnikatelia, salóny, ambulancie, služby a startupy.');
  await page.locator('#brief-goal').fill('Vytvoriť kvalitnú landing page a štruktúru kampane pre službu Web do 24h.');
  await page.locator('#brief-description').fill('Profesionálny výstup pre projekt Web do 24h so zameraním na dôveru, konverzie a bezpečný import payload bez fake tvrdení.');
  await page.locator('#brief-preferred-tone').fill('Jasný, profesionálny, priamy, dôveryhodný, technicky kompetentný.');
  await page.locator('#brief-contact-email').fill('owner@rubberduck.sk');
}

const responsePromise = page.waitForResponse((r) => r.url().includes('/api/projects/generate') && r.request().method() === 'POST');
await page.getByRole('button', { name: /Run Workflow|Spustiť workflow|Generate|Generovať/i }).first().click();
const response = await responsePromise;
const json = await response.json();

if (!json?.project) {
  throw new Error('Missing project payload in /api/projects/generate response');
}

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(json.project, null, 2));

await page.waitForSelector('text=/Výstup pripravený|Výstup je pripravený|Output ready/i', { timeout: 15000 });
await page.waitForFunction(() => /Vizuálny náhľad|Visual Preview/i.test(document.body.innerText), null, { timeout: 15000 });
const visualPreviewText = await page.locator('body').innerText();
const jsonTab = page.locator('button[role="tab"]:visible', { hasText: /JSON Preview|JSON náhľad/i }).first();
const payloadTab = page.locator('button[role="tab"]:visible', { hasText: /WordPress Payload|WordPress payload/i }).first();
await jsonTab.click();
await page.waitForSelector('pre:visible', { timeout: 15000 });
const jsonPreviewText = await page.locator('pre:visible').first().innerText();
await payloadTab.click();
await page.waitForSelector('pre:visible', { timeout: 15000 });
const payloadPreviewText = await page.locator('pre:visible').first().innerText();
const historyTab = page.locator('button[role="tab"]:visible', { hasText: /History|História/i }).first();
await historyTab.click();
await page.waitForFunction(() => /Last 10 validated generations|Posledných 10 validovaných generácií/i.test(document.body.innerText), null, { timeout: 15000 });
const historyText = await page.locator('body').innerText();

const importResponsePromise = page.waitForResponse((r) => r.url().includes('/api/projects/import') && r.request().method() === 'POST');
const importButton = page.getByRole('button', { name: /Prepare WordPress Import \(Dry-run\)|Pripraviť WordPress import \(Dry-run\)/i }).first();
await importButton.scrollIntoViewIfNeeded();
await importButton.click();
const importResponse = await importResponsePromise;
const importJson = await importResponse.json();

const summary = {
  baseUrl,
  outputFile: outFile,
  canExport: json?.canExport,
  canImport: json?.canImport,
  validation: json?.validation,
  compliance: json?.compliance,
  importMessage: importJson?.message,
  importDryRun: importJson?.dryRun,
  importPreviewHasMain: Boolean(importJson?.payloadPreview?.main),
  visualPreviewVisible: /Vizuálny náhľad|Visual Preview/.test(visualPreviewText),
  visualPreviewHasFaq: /FAQ/.test(visualPreviewText),
  jsonPreviewHasWordpress: /"wordpress"\s*:/.test(jsonPreviewText),
  payloadPreviewHasMain: /"main"\s*:/.test(payloadPreviewText),
  historyTabVisible: await historyTab.count() > 0,
  historyRecordVisible: /Web do 24h|local salon|lokálny salón/i.test(historyText),
  historyHasAudit: /generatedAt|projectId|sourceOfTruth/i.test(historyText),
  consoleErrors,
};

fs.writeFileSync('docs/samples/.tmp-smoke-summary.json', JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));

await browser.close();
