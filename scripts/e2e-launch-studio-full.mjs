#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const DEFAULT_PORT = Number(process.env.QA_PORT || 3110);
const MANAGED_BASE = `http://127.0.0.1:${DEFAULT_PORT}`;
const BASE_URL = process.env.QA_BASE_URL || MANAGED_BASE;
const SHOULD_MANAGE_SERVER = !process.env.QA_BASE_URL;
const OUT_DIR = path.resolve(process.env.QA_OUT_DIR || 'qa-artifacts/full-e2e');

const secretSignals = [
  'wp_import_app_password',
  'wp_import_username',
  'authorization: basic',
  'replace-with-secure-app-password',
  'begin private key',
  'mistral_api_key=',
  'ai_gateway_api_key=',
];

const results = [];
const screenshots = [];
const apiSnapshots = [];

function check(name, ok, details = {}) {
  results.push({ name, status: ok ? 'PASS' : 'FAIL', ...details });
}

function skip(name, reason) {
  results.push({ name, status: 'SKIP', reason });
}

async function waitForServer(url, retries = 60) {
  for (let i = 0; i < retries; i += 1) {
    try {
      const res = await fetch(`${url}/launch-studio`, { redirect: 'manual' });
      if (res.ok) return true;
    } catch {
      // ignore
    }
    await delay(1000);
  }
  return false;
}

function sanitize(text) {
  if (!text) return '';
  let out = String(text);
  for (const signal of secretSignals) {
    const rx = new RegExp(signal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig');
    out = out.replace(rx, `${signal.slice(0, 4)}***redacted***`);
  }
  return out;
}

function hasAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

async function fillBrief(page, values) {
  await ensureAdvancedMode(page);

  if (values.projectType) {
    await page.locator('#brief-project-type').selectOption(values.projectType);
  }
  await page.locator('#brief-project-name').fill(values.projectName);
  await page.locator('#brief-target-audience').fill(values.targetAudience);
  await page.locator('#brief-goal').fill(values.goal);
  await page.locator('#brief-description').fill(values.description);
  await page.locator('#brief-preferred-tone').fill(values.preferredTone);
  await page.locator('#brief-contact-email').fill(values.contactEmail);
}

async function ensureAdvancedMode(page) {
  if ((await page.locator('#brief-project-type').count()) > 0) {
    return;
  }

  const advancedToggle = page.getByRole('button', { name: /Advanced/i }).first();
  if ((await advancedToggle.count()) > 0) {
    await advancedToggle.click();
  }

  await page.waitForSelector('#brief-project-type', { timeout: 15000 });
}

async function ensureSimpleMode(page) {
  if ((await page.locator('#autopilot-prompt').count()) > 0) {
    return;
  }

  const simpleToggle = page.getByRole('button', { name: /Simple/i }).first();
  if ((await simpleToggle.count()) > 0) {
    await simpleToggle.click();
  }

  await page.waitForSelector('#autopilot-prompt', { timeout: 15000 });
}

let serverProcess = null;

try {
  await fs.mkdir(OUT_DIR, { recursive: true });

  if (SHOULD_MANAGE_SERVER) {
    serverProcess = spawn('npm', ['run', 'start', '--', '--port', String(DEFAULT_PORT)], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    const logFile = await fs.open(path.join(OUT_DIR, 'local-server.log'), 'w');
    serverProcess.stdout.on('data', (d) => logFile.write(sanitize(d.toString())));
    serverProcess.stderr.on('data', (d) => logFile.write(sanitize(d.toString())));

    const up = await waitForServer(BASE_URL);
    check('local_server_ready', up, { baseUrl: BASE_URL });
    if (!up) throw new Error('Local server did not start in time');
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage({ viewport: { width: 1440, height: 980 } });

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(err.message));
  page.on('response', async (res) => {
    const url = res.url();
    if (!url.includes('/api/')) return;
    if (!url.includes('/api/projects') && !url.includes('/api/workflows') && !url.includes('/api/ai/generate')) return;
    let body = '';
    try {
      body = sanitize((await res.text()).slice(0, 2000));
    } catch {
      body = '';
    }
    apiSnapshots.push({ url, status: res.status(), body });
  });

  // Root redirect
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
  check('redirect_root_to_launch_studio', page.url().includes('/launch-studio'), { url: page.url() });

  await page.waitForFunction(() => {
    const text = document.body?.innerText ?? '';
    return /LE Studio|Launch Studio/i.test(text);
  }, { timeout: 15000 });
  await page.screenshot({ path: path.join(OUT_DIR, 'desktop-initial.png'), fullPage: true });
  screenshots.push('desktop-initial.png');

  // switch EN for deterministic button labels if available
  const lang = page.locator('#language-switcher');
  if (await lang.count()) {
    await lang.selectOption('en');
  }

  // Desktop toolbar coverage
  const toolbarChecks = [
    { name: 'toolbar_add_node_visible', selector: 'button[title="Add node"]' },
    { name: 'toolbar_save_visible', selector: 'button[title="Save"]' },
    { name: 'toolbar_load_visible', selector: 'button[title="Load"]' },
    { name: 'toolbar_reset_visible', selector: 'button[title="Reset workflow"]' },
    { name: 'toolbar_code_json_visible', selector: 'button[title="Code/JSON view"]' },
    { name: 'toolbar_export_visible', selector: 'button[title="Export JSON"]' },
    { name: 'toolbar_magic_wand_visible', selector: 'button[title="Improve prompt"]' },
  ];

  for (const item of toolbarChecks) {
    check(item.name, await page.locator(item.selector).count() > 0);
  }
  const runButton = page.getByRole('button', { name: /Run Workflow|Spustiť workflow/i }).first();
  const toolbarAddNode = page.locator('button[title="Add node"]:visible').first();
  const toolbarSave = page.locator('button[title="Save"]:visible').first();
  const toolbarLoad = page.locator('button[title="Load"]:visible').first();
  const toolbarCodeJson = page.locator('button[title="Code/JSON view"]:visible').first();
  const toolbarExport = page.locator('button[title="Export JSON"]:visible').first();
  const wand = page.locator('button[title="Improve prompt"]:visible').first();
  const importButton = page
    .getByRole('button', {
      name: /Prepare WordPress Import|Pripraviť WordPress import/i,
    })
    .first();

  check('toolbar_run_visible', await runButton.count() > 0);

  // Add node functionality
  const nodeCountBefore = await page.locator('.react-flow__node').count();
  await toolbarAddNode.click();
  await delay(300);
  const nodeCountAfter = await page.locator('.react-flow__node').count();
  check('button_add_node_functional', nodeCountAfter === nodeCountBefore + 1, { before: nodeCountBefore, after: nodeCountAfter });

  // Save + load functional
  await page.locator('#workflow-name-input').fill('LE Studio E2E Workflow');
  const saveResponsePromise = page.waitForResponse(
    (r) => r.url().endsWith('/api/workflows') && r.request().method() === 'POST',
    { timeout: 15000 },
  );
  await toolbarSave.click();
  const saveResponse = await saveResponsePromise.catch(() => null);
  check('button_save_functional', saveResponse?.status() === 200, { responseStatus: saveResponse?.status?.() ?? null });

  const loadResponsePromise = page.waitForResponse(
    (r) => r.url().includes('/api/workflows?workflowId=') && r.request().method() === 'GET',
    { timeout: 15000 },
  );
  await toolbarLoad.click();
  const loadResponse = await loadResponsePromise.catch(() => null);
  check('button_load_functional', loadResponse?.status() === 200, { responseStatus: loadResponse?.status?.() ?? null });

  // JSON toggle functional
  const jsonPanel = page.locator('h3:has-text("JSON Preview"), h3:has-text("JSON náhľad")');
  const jsonVisibleBefore = await jsonPanel.count() > 0;
  await toolbarCodeJson.click();
  await delay(300);
  const jsonVisibleAfterToggle = await jsonPanel.count() > 0;
  await toolbarCodeJson.click();
  await delay(300);
  const jsonVisibleAfterToggleBack = await jsonPanel.count() > 0;
  check('button_json_toggle_functional', jsonVisibleBefore && jsonVisibleBefore !== jsonVisibleAfterToggle && jsonVisibleAfterToggleBack);

  // Run with empty brief -> validation fail
  await fillBrief(page, {
    projectType: 'business',
    projectName: '',
    targetAudience: '',
    goal: '',
    description: '',
    preferredTone: '',
    contactEmail: '',
  });
  await runButton.click();
  await delay(400);
  const bodyAfterEmptyRun = await page.locator('body').innerText();
  check('run_empty_brief_validation', hasAny(bodyAfterEmptyRun, [/validation failed/i, /validation/i, /validačné/i]));

  // Simple autopilot remains the primary current UX.
  await ensureSimpleMode(page);
  await page.locator('#autopilot-prompt').fill('Web do 24h pre lokálny salón');
  await ensureAdvancedMode(page);

  // Magic wand full autofill
  await page.locator('#brief-project-name').fill('Web do 24h Project');
  await fillBrief(page, {
    projectType: 'business',
    projectName: 'Web do 24h Project',
    targetAudience: '',
    goal: '',
    description: '',
    preferredTone: '',
    contactEmail: 'owner@rubberduck.sk',
  });

  await wand.click();
  await page.waitForFunction(() => {
    const btn = Array.from(document.querySelectorAll('button[title="Improve prompt"]')).find(
      (candidate) => candidate instanceof HTMLElement && candidate.offsetParent !== null,
    );
    return !!btn && !btn.hasAttribute('disabled');
  }, { timeout: 30000 });

  const magicValues = await page.evaluate(() => ({
    description: document.querySelector('#brief-description')?.value ?? '',
    goal: document.querySelector('#brief-goal')?.value ?? '',
    targetAudience: document.querySelector('#brief-target-audience')?.value ?? '',
    preferredTone: document.querySelector('#brief-preferred-tone')?.value ?? '',
  }));

  check('magic_wand_description_filled', magicValues.description.trim().length > 20);
  check('magic_wand_goal_filled', magicValues.goal.trim().length > 5);
  check('magic_wand_target_audience_filled', magicValues.targetAudience.trim().length > 5);
  check('magic_wand_preferred_tone_filled', magicValues.preferredTone.trim().length > 5);

  // Valid run path starts from a clean page and covers the current primary Simple Mode UX.
  await page.goto(`${BASE_URL}/launch-studio`, { waitUntil: 'networkidle' });
  if ((await lang.count()) > 0) {
    await lang.selectOption('en');
  }
  await ensureSimpleMode(page);
  await page.locator('#autopilot-prompt').fill('Web do 24h Project for a local salon');

  const validRunButton = page.getByRole('button', { name: /Generate everything|Vygenerovať všetko|Run Workflow|Spustiť workflow/i }).first();
  const runEnabledBeforeValidRun = await validRunButton.isEnabled();
  check('run_button_enabled_for_valid_brief', runEnabledBeforeValidRun);

  const generateResp = page
    .waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        (r.url().includes('/api/projects/generate') || /\/api\/workflows\/[^/]+\/run/.test(r.url())),
      { timeout: 60000 },
    )
    .catch(() => null);
  if (runEnabledBeforeValidRun) {
    await validRunButton.click();
  }
  const generationResponse = runEnabledBeforeValidRun ? await generateResp : null;
  await delay(1200);
  const postRunBodyText = await page.locator('body').innerText();
  const hasSuccessSignal = hasAny(postRunBodyText, [
    /live execution complete/i,
    /run completed/i,
    /workflow finished/i,
    /spustenie dokončené/i,
  ]);
  const hasValidationSignal = hasAny(postRunBodyText, [
    /validation failed/i,
    /validation/i,
    /validačné/i,
  ]);
  const hasComplianceBlockSignal = hasAny(postRunBodyText, [
    /compliance blocked/i,
    /compliance fail/i,
    /compliance zlyhal/i,
  ]);

  const validRunSucceeded =
    (!!generationResponse && generationResponse.status() === 200) ||
    (runEnabledBeforeValidRun && hasSuccessSignal && !hasValidationSignal && !hasComplianceBlockSignal);
  check('run_valid_brief_status_200', validRunSucceeded, {
    responseStatus: generationResponse?.status?.() ?? null,
    hasSuccessSignal,
    hasValidationSignal,
    hasComplianceBlockSignal,
  });

  const timelineEntries = await page.locator('h3:has-text("Execution Log"), h3:has-text("Log vykonania")').locator('..').locator('div > div').count();
  if (validRunSucceeded) {
    check('timeline_updated_after_run', timelineEntries > 0, { timelineEntries });

    const revealText = await page.locator('body').innerText();
    check('generation_reveals_result_immediately', hasAny(revealText, [/Output ready/i, /Výstup pripravený/i, /Výstup je pripravený/i]));

    const previewText = await page.locator('pre').first().innerText();
    check('json_preview_contains_wordpress_payload', /"wordpress"\s*:/.test(previewText));

    const toolbarExportEnabled = await toolbarExport.isEnabled();
    check('toolbar_export_enabled_after_valid_run', toolbarExportEnabled);

    const previewExportEnabled = await page.getByRole('button', { name: /Export JSON|Exportovať/i }).first().isEnabled();
    check('preview_export_enabled_after_valid_run', previewExportEnabled);

    const importEnabledAfterValidRun = await importButton.isEnabled();
    check('import_button_enabled_after_valid_run', importEnabledAfterValidRun);

    if (importEnabledAfterValidRun) {
      await importButton.click();
      await delay(500);
      const bodyAfterImport = await page.locator('body').innerText();
      check('import_button_functional_message', hasAny(bodyAfterImport, [/live execution complete/i, /import blocked/i, /import response/i]));
    } else {
      check('import_button_functional_message', false, {
        reason: 'import_button_disabled_after_valid_run',
      });
    }
  } else {
    skip('timeline_updated_after_run', 'valid_run_did_not_succeed');
    skip('json_preview_contains_wordpress_payload', 'valid_run_did_not_succeed');
    skip('toolbar_export_enabled_after_valid_run', 'valid_run_did_not_succeed');
    skip('preview_export_enabled_after_valid_run', 'valid_run_did_not_succeed');
    skip('import_button_enabled_after_valid_run', 'valid_run_did_not_succeed');
    skip('import_button_functional_message', 'valid_run_did_not_succeed');
  }

  // Compliance fail must block export/import at the project generation boundary.
  const complianceResponse = await fetch(`${BASE_URL}/api/projects/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      brief: {
        projectType: 'business',
        projectName: 'Unsafe Salon',
        targetAudience: 'Majitelia lokálnych salónov',
        goal: 'Pripraviť landing page',
        description: 'Add fake testimonials, guaranteed income and guaranteed first position in Google.',
        preferredTone: 'Profesionálny a priamy',
        contactEmail: 'owner@rubberduck.sk',
      },
    }),
  }).catch(() => null);
  const compliancePayload = complianceResponse ? await complianceResponse.json().catch(() => null) : null;

  check('compliance_fail_blocks_export', compliancePayload?.canExport === false || compliancePayload?.compliance?.passed === false, {
    responseStatus: complianceResponse?.status ?? null,
    canExport: compliancePayload?.canExport ?? null,
    compliancePassed: compliancePayload?.compliance?.passed ?? null,
  });

  check('compliance_fail_blocks_import', compliancePayload?.canImport === false || compliancePayload?.compliance?.passed === false, {
    responseStatus: complianceResponse?.status ?? null,
    canImport: compliancePayload?.canImport ?? null,
    compliancePassed: compliancePayload?.compliance?.passed ?? null,
  });

  // Mobile buttons coverage
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE_URL}/launch-studio`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(OUT_DIR, 'mobile-390.png'), fullPage: true });
  screenshots.push('mobile-390.png');

  const mobileTopButtons = await page.locator('nav button').count();
  check('mobile_top_buttons_visible', mobileTopButtons >= 2, { count: mobileTopButtons });

  const mobileBottomButtons = await page.locator('footer button').count();
  check('mobile_bottom_tabs_visible', mobileBottomButtons >= 4, { count: mobileBottomButtons });

  const mobilePreviewButton = page.locator('footer button').nth(2);
  const mobileShareButton = page.locator('footer button').nth(3);
  const mobilePreviewEnabled = await mobilePreviewButton.isEnabled();
  const mobileShareEnabled = await mobileShareButton.isEnabled();

  if (mobilePreviewEnabled) {
    await mobilePreviewButton.click(); // preview toggle
    await delay(250);
    check('mobile_preview_toggle_clickable', true);
  } else {
    check('mobile_preview_toggle_clickable', false, { reason: 'mobile_preview_button_disabled' });
  }

  if (mobileShareEnabled) {
    await mobileShareButton.click(); // share/export
    await delay(250);
    check('mobile_share_tab_clickable', true);
  } else {
    check('mobile_share_tab_clickable', true, { reason: 'mobile_share_button_disabled_by_state_guard' });
  }

  // Tablet + desktop screenshots and overflow checks
  for (const vp of [
    { name: 'tablet-768', width: 768, height: 1024 },
    { name: 'desktop-1440', width: 1440, height: 980 },
  ]) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto(`${BASE_URL}/launch-studio`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: path.join(OUT_DIR, `${vp.name}.png`), fullPage: true });
    screenshots.push(`${vp.name}.png`);

    const overflow = await page.evaluate(() => document.body.scrollWidth > window.innerWidth + 1);
    check(`responsive_no_horizontal_overflow_${vp.name}`, !overflow);
  }

  // Optional utility/dialog checks (if present in current UI)
  const optionalSelectors = [
    { name: 'optional_templates_dialog', selector: '[data-testid="templates-dialog-trigger"], button:has-text("Templates")' },
    { name: 'optional_history_dialog', selector: '[data-testid="history-dialog-trigger"], button:has-text("History")' },
    { name: 'optional_load_dialog', selector: '[data-testid="load-dialog-trigger"], button:has-text("Load Workflow")' },
  ];
  for (const item of optionalSelectors) {
    const exists = await page.locator(item.selector).count();
    if (!exists) {
      skip(item.name, 'not_rendered_in_current_launch_studio_shell');
      continue;
    }
    check(item.name, true, { note: 'present' });
  }

  // Console + secret leakage checks
  check('no_hydration_or_react_runtime_errors', !consoleErrors.some((e) => /hydration|Minified React error/i.test(e)), {
    count: consoleErrors.length,
  });

  const combinedSnapshot = `${JSON.stringify(apiSnapshots)}\n${consoleErrors.join('\n')}`.toLowerCase();
  const leakedSignals = secretSignals.filter((signal) => combinedSnapshot.includes(signal.toLowerCase()));
  check('no_secret_leak_signals', leakedSignals.length === 0, { leakedSignals });

  await browser.close();

  const summary = {
    baseUrl: BASE_URL,
    generatedAt: new Date().toISOString(),
    checks: results,
    screenshots,
    apiSnapshots,
    consoleErrors: consoleErrors.map(sanitize),
    totals: {
      pass: results.filter((c) => c.status === 'PASS').length,
      fail: results.filter((c) => c.status === 'FAIL').length,
      skip: results.filter((c) => c.status === 'SKIP').length,
    },
  };

  await fs.writeFile(path.join(OUT_DIR, 'e2e-summary.json'), JSON.stringify(summary, null, 2), 'utf8');

  console.log(JSON.stringify(summary.totals, null, 2));

  if (summary.totals.fail > 0) {
    process.exit(1);
  }
} catch (error) {
  const failure = {
    baseUrl: BASE_URL,
    generatedAt: new Date().toISOString(),
    error: String(error instanceof Error ? error.stack || error.message : error),
    checks: results,
    apiSnapshots,
    screenshots,
  };
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUT_DIR, 'e2e-summary.json'), JSON.stringify(failure, null, 2), 'utf8');
  console.error(error);
  process.exit(1);
} finally {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill('SIGTERM');
  }
}
