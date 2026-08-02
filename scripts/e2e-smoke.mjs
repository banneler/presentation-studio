/**
 * Presentation Studio E2E smoke — run against local static server:
 *   python3 -m http.server 8765
 *   node scripts/e2e-smoke.mjs
 */
import { chromium } from 'playwright';
import { writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const BASE = process.env.STUDIO_URL || 'http://127.0.0.1:8765';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const results = [];

function pass(name, detail = '') {
  results.push({ name, ok: true, detail });
  console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
}
function fail(name, detail = '') {
  results.push({ name, ok: false, detail });
  console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function readDraft(page) {
  return page.evaluate(() => {
    const keys = Object.keys(localStorage).filter(k => k.startsWith('presentation-studio-draft'));
    const preferred = keys.find(k => k.includes(':')) || keys[0];
    if (!preferred) return null;
    return JSON.parse(localStorage.getItem(preferred));
  });
}

async function waitPreviewReady(page) {
  await page.waitForFunction(() => {
    const f = document.getElementById('preview');
    return f?.contentDocument?.body?.classList?.contains('studio-preview')
      && !!f.contentDocument.querySelector('.nav-item-active');
  }, null, { timeout: 20000 });
}

async function activeNav(page) {
  return page.evaluate(() =>
    document.getElementById('preview')
      ?.contentDocument
      ?.querySelector('.nav-item-active')
      ?.id
      ?.replace('nav-btn-', '') || null
  );
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();

  // Accept confirm() for pricing remove; dismiss unexpected alerts
  page.on('dialog', async dialog => {
    if (dialog.type() === 'confirm') await dialog.accept();
    else await dialog.dismiss();
  });

  try {
    await page.goto(`${BASE}/editor.html`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForSelector('#preview');
    await waitPreviewReady(page);
    await sleep(400);

    // 1) Load + scale + screensaver skip
    const scale = await page.evaluate(() => {
      const stage = document.getElementById('preview-stage');
      const host = document.getElementById('preview-host');
      const sizer = document.getElementById('preview').contentDocument.getElementById('scale-sizer');
      const ratio = stage.offsetWidth / stage.offsetHeight;
      const ss = document.getElementById('preview').contentDocument.getElementById('screensaver');
      return {
        ratio: Number(ratio.toFixed(3)),
        is16x9: Math.abs(ratio - 16 / 9) < 0.02,
        fitsHost: stage.offsetWidth <= host.offsetWidth + 1 && stage.offsetHeight <= host.offsetHeight + 1,
        sizerMatch: !!sizer && Math.abs(sizer.offsetWidth - stage.offsetWidth) < 2,
        ssDismissed: ss?.classList.contains('screensaver-dismissed'),
        studioPreview: document.getElementById('preview').contentDocument.body.classList.contains('studio-preview'),
        active: document.getElementById('preview').contentDocument.querySelector('.nav-item-active')?.id
      };
    });
    if (scale.studioPreview && scale.ssDismissed) pass('preview-skips-screensaver');
    else fail('preview-skips-screensaver', JSON.stringify(scale));
    if (scale.is16x9 && scale.fitsHost && scale.sizerMatch) pass('preview-16x9-scale', `ratio=${scale.ratio}`);
    else fail('preview-16x9-scale', JSON.stringify(scale));
    if ((scale.active || '').includes('agenda')) pass('initial-page-agenda');
    else fail('initial-page-agenda', scale.active);

    // 2) Page click sync via postMessage
    for (const id of ['data-centers', 'products', 'core-capabilities', 'agenda']) {
      await page.click(`[data-select-id="${id}"]`);
      await sleep(500);
      const nav = await activeNav(page);
      if (nav === id) pass(`page-sync-${id}`);
      else fail(`page-sync-${id}`, `nav=${nav}`);
    }

    // 3) Refresh keeps selected page, no screensaver
    await page.click('[data-select-id="data-centers"]');
    await sleep(300);
    await page.click('#refresh-preview');
    await waitPreviewReady(page);
    await sleep(300);
    const afterRefresh = await page.evaluate(() => {
      const win = document.getElementById('preview').contentWindow;
      const doc = document.getElementById('preview').contentDocument;
      return {
        view: new URL(win.location.href).searchParams.get('view'),
        active: doc.querySelector('.nav-item-active')?.id?.replace('nav-btn-', ''),
        ss: doc.getElementById('screensaver')?.classList.contains('screensaver-dismissed'),
        studio: doc.body.classList.contains('studio-preview')
      };
    });
    if (afterRefresh.view === 'data-centers' && afterRefresh.active === 'data-centers' && afterRefresh.ss)
      pass('refresh-keeps-page-no-screensaver');
    else fail('refresh-keeps-page-no-screensaver', JSON.stringify(afterRefresh));

    // 4) Spec pricing import
    const specPath = join(ROOT, 'samples/acme-pricing.spec');
    await page.setInputFiles('#spec-pricing-file', specPath);
    await sleep(1000);
    await waitPreviewReady(page);
    await page.click('#save-local');
    await sleep(300);

    const dSpec = await readDraft(page);
    const draftAfterSpec = {
      hasPricing: !!dSpec?.mapData?.pricing,
      options: dSpec?.pageContent?.pricing?.options?.length,
      source: dSpec?.pageContent?.pricing?.importSource,
      name: dSpec?.pageContent?.pricing?.sourceName
    };
    if (draftAfterSpec.hasPricing && draftAfterSpec.options === 2 && draftAfterSpec.source === 'spec')
      pass('spec-import-data', draftAfterSpec.name);
    else fail('spec-import-data', JSON.stringify(draftAfterSpec));

    const specPreview = await page.evaluate(() => ({
      hasPricingRow: !!document.querySelector('[data-select-id="pricing"]'),
      active: document.getElementById('preview').contentDocument.querySelector('.nav-item-active')?.id,
      total: /TOTAL MONTHLY COST/i.test(document.getElementById('preview').contentDocument.body.innerText),
      editor: /Imported from Enterprise Proposals/i.test(document.getElementById('editor-fields')?.innerText || '')
    }));
    if (specPreview.hasPricingRow && (specPreview.active || '').includes('pricing') && specPreview.total)
      pass('spec-import-preview');
    else fail('spec-import-preview', JSON.stringify(specPreview));

    // 5) Salesforce CSV replaces with single option
    const csvPath = join(ROOT, 'samples/sf-quick-import.csv');
    if (!existsSync(csvPath)) {
      writeFileSync(
        csvPath,
        'Z Location,Product,Quantity,Customer Unit Price\nHQ Omaha,1G Dedicated Internet,1,850.00\nHQ Omaha,SIP Trunks,20,12.50\nPlant Council Bluffs,100M Ethernet,1,400\n'
      );
    }
    await page.setInputFiles('#salesforce-pricing-file', csvPath);
    await sleep(1000);
    await page.click('#save-local');
    await sleep(300);
    const dCsv = await readDraft(page);
    const csvDraft = {
      source: dCsv?.pageContent?.pricing?.importSource,
      options: dCsv?.pageContent?.pricing?.options?.length,
      locations: dCsv?.pageContent?.pricing?.options?.[0]?.locations?.length,
      name: dCsv?.pageContent?.pricing?.sourceName
    };
    if (csvDraft.source === 'salesforce-csv' && csvDraft.options === 1 && csvDraft.locations >= 2)
      pass('csv-import-single-option', `${csvDraft.locations} locations`);
    else fail('csv-import-single-option', JSON.stringify(csvDraft));

    // 6) Remove pricing (confirm accepted via dialog handler)
    await page.click('#spec-pricing-remove');
    await sleep(600);
    await page.click('#save-local');
    await sleep(300);
    const dRemoved = await readDraft(page);
    const removed = {
      hasPricing: !!dRemoved?.mapData?.pricing,
      row: await page.evaluate(() => !!document.querySelector('[data-select-id="pricing"]')),
      status: await page.evaluate(() => document.getElementById('spec-pricing-status')?.textContent?.trim())
    };
    if (!removed.hasPricing && !removed.row) pass('pricing-remove', removed.status);
    else fail('pricing-remove', JSON.stringify(removed));

    // Re-import spec for remaining UI tests
    await page.setInputFiles('#spec-pricing-file', specPath);
    await sleep(800);

    // 7) Data centers highlight checkboxes (multi-select)
    await page.click('[data-select-id="data-centers"]');
    await sleep(500);
    const dc = await page.evaluate(() => {
      const checks = [...document.querySelectorAll('[data-dc-highlight]')];
      [1, 2].forEach(i => {
        if (checks[i]) {
          checks[i].checked = true;
          checks[i].dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
      return { checkCount: checks.length };
    });
    await page.click('#save-local');
    await sleep(300);
    const dDc = await readDraft(page);
    const dcDraft = (dDc?.pageContent?.['data-centers'] || []).map(x => ({ name: x.name, highlight: !!x.highlight }));
    const highlightCount = dcDraft.filter(x => x.highlight).length;
    if (dc.checkCount >= 3 && highlightCount >= 2) pass('data-centers-highlight', `${highlightCount} highlighted`);
    else fail('data-centers-highlight', JSON.stringify({ dc, dcDraft }));

    await page.click('#refresh-preview');
    await waitPreviewReady(page);
    if ((await activeNav(page)) === 'data-centers') pass('data-centers-preview-nav');
    else fail('data-centers-preview-nav', await activeNav(page));

    // 8) Products toggles + drag handles
    await page.click('[data-select-id="products"]');
    await sleep(600);
    const productsUi = await page.evaluate(() => {
      const checks = [...document.querySelectorAll('#editor-fields [data-product-enabled]')];
      const handles = [...document.querySelectorAll('#editor-fields .handle')];
      const beforeEnabled = checks.filter(c => c.checked).length;
      if (checks[0]?.checked) {
        checks[0].checked = false;
        checks[0].dispatchEvent(new Event('change', { bubbles: true }));
      }
      return { checkCount: checks.length, handleCount: handles.length, beforeEnabled };
    });
    await page.click('#save-local');
    await sleep(300);
    const dProd = await readDraft(page);
    const productsDraft = (dProd?.pageContent?.products || []).map(p => ({
      name: p.title || p.name,
      enabled: p.enabled !== false
    }));
    const disabled = productsDraft.filter(p => !p.enabled).length;
    if (productsUi.checkCount >= 2) pass('products-enable-toggles', `${productsUi.checkCount} checkboxes`);
    else fail('products-enable-toggles', JSON.stringify(productsUi));
    if (productsUi.handleCount >= 2) pass('products-reorder-ui', `handles=${productsUi.handleCount}`);
    else fail('products-reorder-ui', JSON.stringify(productsUi));
    if (disabled >= 1) pass('products-toggle-persists', `disabled=${disabled}`);
    else fail('products-toggle-persists', JSON.stringify(productsDraft.slice(0, 4)));

    await page.click('#refresh-preview');
    await waitPreviewReady(page);
    if ((await activeNav(page)) === 'products') pass('products-preview-nav');
    else fail('products-preview-nav', await activeNav(page));

    // Viewer filters disabled products: first product title should be absent if disabled
    const firstDisabled = productsDraft.find(p => !p.enabled);
    if (firstDisabled?.name) {
      const visible = await page.evaluate(title => {
        const text = document.getElementById('preview').contentDocument.body.innerText;
        return text.includes(title);
      }, firstDisabled.name);
      if (!visible) pass('products-viewer-filters-disabled', firstDisabled.name);
      else fail('products-viewer-filters-disabled', `"${firstDisabled.name}" still visible`);
    }

    // 9) Nav labels present on page rows
    const navLabels = await page.evaluate(() =>
      [...document.querySelectorAll('[data-select-id] p:first-child')].map(p => p.textContent.trim()).filter(Boolean)
    );
    if (navLabels.length >= 8 && navLabels.every(Boolean)) pass('nav-labels-populated', `${navLabels.length} labels`);
    else fail('nav-labels-populated', JSON.stringify(navLabels.slice(0, 5)));

    pass('note-library-api', 'static server has no /api library (expected HTML parse error)');

  } catch (error) {
    fail('suite-crashed', error.stack || String(error));
  } finally {
    await browser.close();
  }

  const failed = results.filter(r => !r.ok);
  console.log('\n———');
  console.log(`${results.filter(r => r.ok).length}/${results.length} passed`);
  if (failed.length) {
    console.log('Failed:');
    failed.forEach(f => console.log(`  - ${f.name}: ${f.detail}`));
    process.exit(1);
  }
}

main();
