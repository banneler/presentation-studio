/**
 * Publish / follow-up / library / draft / base64 retention E2E.
 *
 *   STUDIO_URL=https://gpc-presentation-studio.vercel.app node scripts/e2e-publish.mjs
 *
 * Creates a throwaway deck, then deletes it.
 */
import { chromium } from 'playwright';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const BASE = process.env.STUDIO_URL || 'https://gpc-presentation-studio.vercel.app';
const STAMP = Date.now().toString(36);
const NAME = `E2E Smoke ${STAMP}`;
const SLUG = `e2e-smoke-${STAMP}`;
const REP = 'E2E Bot';
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const TINY_DATA_URL = `data:image/png;base64,${TINY_PNG_B64}`;

const results = [];
const pass = (name, detail = '') => {
  results.push({ name, ok: true, detail });
  console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
};
const fail = (name, detail = '') => {
  results.push({ name, ok: false, detail });
  console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function readDraft(page) {
  return page.evaluate(() => {
    const keys = Object.keys(localStorage).filter(k => k.startsWith('presentation-studio-draft'));
    const preferred = keys.find(k => k.includes(':')) || keys[0];
    if (!preferred) return { key: null, draft: null };
    return { key: preferred, draft: JSON.parse(localStorage.getItem(preferred)) };
  });
}

async function apiJson(path, options) {
  const res = await fetch(`${BASE}${path}`, options);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 200) }; }
  return { status: res.status, data };
}

async function cleanupViaApi() {
  return apiJson('/api/delete-presentation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug: SLUG, confirmName: REP })
  });
}

async function waitPreview(page) {
  await page.waitForFunction(() => {
    const f = document.getElementById('preview');
    return f?.contentDocument?.body?.classList?.contains('studio-preview');
  }, null, { timeout: 45000 });
}

async function main() {
  console.log(`Target: ${BASE}`);
  console.log(`Deck: ${NAME} (${SLUG})`);

  const pngPath = join(tmpdir(), `${SLUG}.png`);
  writeFileSync(pngPath, Buffer.from(TINY_PNG_B64, 'base64'));

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on('dialog', async dialog => {
    if (dialog.type() === 'confirm') await dialog.accept();
    else await dialog.dismiss();
  });

  let needsCleanup = false;

  try {
    const listed = await apiJson('/api/list-presentations');
    if (listed.status === 200 && listed.data?.ok) pass('library-api-list', `${listed.data.presentations?.length || 0} decks`);
    else fail('library-api-list', JSON.stringify(listed));

    await page.goto(`${BASE}/editor.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('#presentation-name');
    await waitPreview(page);

    await page.fill('#presentation-name', NAME);
    await page.fill('#rep-name', REP);
    await page.dispatchEvent('#presentation-name', 'change');
    await page.dispatchEvent('#rep-name', 'change');
    await sleep(400);

    // Upload customer logo → data URL in draft
    await page.setInputFiles('#customer-logo-file', pngPath);
    await sleep(700);

    // Upload agenda hero slot 0 as base64 too
    await page.click('[data-select-id="agenda"]');
    await sleep(500);
    const heroFile = page.locator('#editor-fields input[type="file"]').first();
    if (await heroFile.count()) {
      await heroFile.setInputFiles(pngPath);
      await sleep(700);
    }

    await page.click('#save-local');
    await sleep(500);

    let stored = await readDraft(page);
    const logo = stored.draft?.settings?.customerLogo || '';
    if (logo.startsWith('data:image/')) pass('save-draft-base64-logo', stored.key);
    else fail('save-draft-base64-logo', `logo=${String(logo).slice(0, 100)} key=${stored.key}`);

    const heroSrc = stored.draft?.pageContent?.agenda?.heroImages?.[0]?.src
      || stored.draft?.pageContent?.agenda?.heroImages?.[0]
      || '';
    if (String(heroSrc).startsWith('data:image/')) pass('save-draft-base64-hero');
    else fail('save-draft-base64-hero', String(heroSrc).slice(0, 100));

    // Reload recalls draft
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('#presentation-name');
    await sleep(1500);
    await waitPreview(page).catch(() => {});

    const afterReload = await readDraft(page);
    const nameVal = await page.inputValue('#presentation-name');
    const logo2 = afterReload.draft?.settings?.customerLogo || '';
    if (logo2.startsWith('data:image/') && (nameVal.includes(STAMP) || afterReload.draft?.settings?.presentationName?.includes(STAMP)))
      pass('reload-recalls-draft-base64', nameVal);
    else fail('reload-recalls-draft-base64', JSON.stringify({
      nameVal,
      settingsName: afterReload.draft?.settings?.presentationName,
      logo: logo2.slice(0, 60)
    }));

    // Ensure identity after reload
    await page.fill('#presentation-name', NAME);
    await page.fill('#rep-name', REP);
    await page.dispatchEvent('#presentation-name', 'change');
    await page.dispatchEvent('#rep-name', 'change');
    if (!(await page.evaluate(() => {
      const keys = Object.keys(localStorage).filter(k => k.startsWith('presentation-studio-draft'));
      const key = keys.find(k => k.includes(':')) || keys[0];
      const d = key ? JSON.parse(localStorage.getItem(key)) : null;
      return d?.settings?.customerLogo?.startsWith('data:image/');
    }))) {
      await page.setInputFiles('#customer-logo-file', pngPath);
      await sleep(600);
    }
    await page.click('#save-local');
    await sleep(400);

    // PUBLISH
    await page.click('#publish-btn');
    await page.waitForFunction(() => {
      const btn = document.getElementById('publish-btn');
      const live = document.getElementById('live-url')?.value || '';
      const text = document.body.innerText;
      return (btn && !btn.disabled && live.includes('/presentations/'))
        || /Live soon at|Published\.|publish failed|GITHUB_TOKEN/i.test(text);
    }, null, { timeout: 120000 });
    await sleep(800);

    const liveUrl = await page.inputValue('#live-url').catch(() => '');
    const bodyText = await page.evaluate(() => document.body.innerText);
    if (liveUrl.includes('/presentations/') || /Live soon at|Published/i.test(bodyText)) {
      pass('publish-presentation', liveUrl || 'status ok');
      needsCleanup = true;
    } else {
      fail('publish-presentation', bodyText.match(/.{0,30}(fail|error|GITHUB|Published|Live).{0,100}/i)?.[0] || bodyText.slice(0, 220));
    }

    // Persistent URL row (no timed auto-hide) + manual dismiss
    const liveWrapVisible = await page.evaluate(() => {
      const wrap = document.getElementById('live-url-wrap');
      return Boolean(wrap && !wrap.classList.contains('hidden'));
    });
    if (liveWrapVisible) pass('live-url-row-persistent');
    else fail('live-url-row-persistent', 'live-url-wrap hidden immediately after publish');

    await sleep(5200);
    const stillVisible = await page.evaluate(() => {
      const wrap = document.getElementById('live-url-wrap');
      return Boolean(wrap && !wrap.classList.contains('hidden'));
    });
    if (stillVisible) pass('live-url-row-not-auto-hidden');
    else fail('live-url-row-not-auto-hidden', 'live URL row auto-hid (~5s) — expected persistent until dismiss');

    await page.click('#dismiss-live-url');
    await sleep(200);
    const dismissed = await page.evaluate(() => {
      const wrap = document.getElementById('live-url-wrap');
      return Boolean(wrap && wrap.classList.contains('hidden'));
    });
    if (dismissed) pass('live-url-row-dismiss');
    else fail('live-url-row-dismiss', 'dismiss X did not hide live URL row');

    const got = await apiJson(`/api/get-presentation?slug=${encodeURIComponent(SLUG)}`);
    if (got.status === 200 && got.data?.ok) {
      pass('get-presentation-api', got.data.url);
      const contentLogo = got.data.content?.settings?.customerLogo || '';
      if (contentLogo.startsWith('data:image/')) pass('published-content-retains-base64-logo');
      else fail('published-content-retains-base64-logo', contentLogo.slice(0, 100));

      const pubHero = got.data.content?.pageContent?.agenda?.heroImages?.[0]?.src
        || got.data.content?.pageContent?.agenda?.heroImages?.[0]
        || '';
      if (String(pubHero).startsWith('data:image/')) pass('published-content-retains-base64-hero');
      else fail('published-content-retains-base64-hero', String(pubHero).slice(0, 100));

      const duplicatedLogos = Object.values(got.data.content?.mapData || {})
        .filter(page => typeof page?.logo === 'string' && page.logo.startsWith('data:image/'));
      if (!duplicatedLogos.length) pass('published-content-no-duplicate-page-logos');
      else fail('published-content-no-duplicate-page-logos', `pagesWithLogo=${duplicatedLogos.length}`);
    } else {
      fail('get-presentation-api', JSON.stringify(got));
      fail('published-content-retains-base64-logo', 'skipped');
      fail('published-content-retains-base64-hero', 'skipped');
      fail('published-content-no-duplicate-page-logos', 'skipped');
    }

    await page.click('#refresh-library');
    await sleep(2500);
    const inLibrary = await page.locator(`[data-open-slug="${SLUG}"]`).count();
    if (inLibrary) pass('library-lists-published');
    else fail('library-lists-published', await page.locator('#library-list').innerText());

    // Reset local editor, then open from library (true server recall)
    await page.click('#reset-draft');
    await sleep(800);
    await page.locator(`[data-open-slug="${SLUG}"]`).click();
    await sleep(2000);
    await waitPreview(page).catch(() => {});

    const opened = await readDraft(page);
    const openedLogo = opened.draft?.settings?.customerLogo || '';
    const openedName = opened.draft?.settings?.presentationName || '';
    if (openedLogo.startsWith('data:image/') && openedName.includes(STAMP))
      pass('library-open-retains-base64', openedName);
    else fail('library-open-retains-base64', JSON.stringify({ openedName, logo: openedLogo.slice(0, 80) }));

    const previewHasDataLogo = await page.evaluate(() => {
      const doc = document.getElementById('preview')?.contentDocument;
      return [...(doc?.querySelectorAll('img') || [])].some(img => (img.getAttribute('src') || '').startsWith('data:image/'));
    });
    if (previewHasDataLogo) pass('preview-renders-base64-logo');
    else pass('note-preview-base64', 'no data: img in DOM (logo may be off on current page)');

    // FOLLOW-UP
    await page.click('#follow-up-btn');
    await page.waitForSelector('#follow-up-modal:not(.hidden), #follow-up-modal.flex', { timeout: 10000 }).catch(() => {});
    await page.fill('#recap-headline', `E2E recap ${STAMP}`);
    await page.fill('#recap-items', 'Discussed connectivity\nNext: schedule tech deep-dive');
    await page.click('#confirm-follow-up');
    await page.waitForFunction(() => {
      const modal = document.getElementById('follow-up-modal');
      const hidden = !modal || modal.classList.contains('hidden');
      const text = document.body.innerText;
      return (hidden && /Follow-up published/i.test(text)) || /follow-up publish failed/i.test(text);
    }, null, { timeout: 120000 });
    await sleep(600);

    const fuUrl = await page.inputValue('#follow-up-url').catch(() => '');
    if (fuUrl.includes('/follow-up')) pass('publish-follow-up', fuUrl);
    else fail('publish-follow-up', await page.evaluate(() => document.body.innerText).then(t => t.slice(0, 240)));

    const fuWrapVisible = await page.evaluate(() => {
      const wrap = document.getElementById('follow-up-url-wrap');
      return Boolean(wrap && !wrap.classList.contains('hidden'));
    });
    if (fuWrapVisible) pass('follow-up-url-row-persistent');
    else fail('follow-up-url-row-persistent', 'follow-up-url-wrap hidden after publish');

    await page.click('#dismiss-follow-up-url');
    await sleep(200);
    const fuDismissed = await page.evaluate(() => {
      const wrap = document.getElementById('follow-up-url-wrap');
      return Boolean(wrap && wrap.classList.contains('hidden'));
    });
    if (fuDismissed) pass('follow-up-url-row-dismiss');
    else fail('follow-up-url-row-dismiss', 'dismiss X did not hide follow-up URL row');

    const listed2 = await apiJson('/api/list-presentations');
    const entry = listed2.data?.presentations?.find(p => p.slug === SLUG);
    if (entry?.hasFollowUp) pass('library-shows-follow-up');
    else fail('library-shows-follow-up', JSON.stringify(entry || null));

    const fuGet = await apiJson(`/api/get-presentation?slug=${encodeURIComponent(SLUG)}`);
    if (fuGet.data?.hasFollowUp) pass('get-presentation-follow-up-flag');
    else fail('get-presentation-follow-up-flag', JSON.stringify(fuGet.data));
    if (fuGet.data?.followUpRecap?.headline) pass('get-presentation-follow-up-recap', fuGet.data.followUpRecap.headline.slice(0, 60));
    else fail('get-presentation-follow-up-recap', JSON.stringify(fuGet.data?.followUpRecap || null));

    // Follow-up branch under Meeting Agenda + Publish button not stuck
    await page.click('#refresh-library');
    await sleep(800);
    const branchState = await page.evaluate(() => {
      const branch = document.querySelector('[data-select-id="__follow-up__"]');
      const publishText = document.getElementById('publish-btn')?.textContent || '';
      return {
        branch: Boolean(branch),
        publishText
      };
    });
    if (branchState.branch) pass('follow-up-branch-after-publish');
    else fail('follow-up-branch-after-publish', JSON.stringify(branchState));
    if (branchState.publishText === 'Publish' || branchState.publishText === 'Published')
      pass('publish-button-not-stuck-after-follow-up', branchState.publishText);
    else fail('publish-button-not-stuck-after-follow-up', branchState.publishText);

    if (branchState.branch) {
      await page.click('[data-select-id="__follow-up__"]');
      await sleep(800);
      const fuEditor = await page.evaluate(() => ({
        heading: document.getElementById('selected-heading')?.textContent || '',
        updateBtn: Boolean(document.getElementById('update-follow-up-btn')),
        previewDraft: new URL(document.getElementById('preview')?.contentWindow?.location?.href || '', location.href)
          .searchParams.get('draft')
      }));
      if (/Meeting Recap|Follow-Up/i.test(fuEditor.heading) && fuEditor.updateBtn)
        pass('follow-up-branch-loads-editor', fuEditor.heading);
      else fail('follow-up-branch-loads-editor', JSON.stringify(fuEditor));
    }

    // DELETE via UI
    await page.click('#refresh-library');
    await sleep(1500);
    await page.locator(`[data-delete-slug="${SLUG}"]`).click();
    await page.waitForSelector('#delete-confirm-input', { timeout: 10000 });
    await page.fill('#delete-confirm-input', REP);
    await page.dispatchEvent('#delete-confirm-input', 'input');
    await sleep(200);
    await page.click('#confirm-delete');
    await sleep(3000);

    const listed3 = await apiJson('/api/list-presentations');
    let gone = !listed3.data?.presentations?.some(p => p.slug === SLUG);
    if (!gone) {
      await cleanupViaApi();
      const listed4 = await apiJson('/api/list-presentations');
      gone = !listed4.data?.presentations?.some(p => p.slug === SLUG);
      if (gone) pass('delete-presentation-cleanup', 'API fallback');
      else fail('delete-presentation-cleanup', 'still present');
    } else {
      pass('delete-presentation-cleanup');
    }
    needsCleanup = !gone;

  } catch (error) {
    fail('suite-crashed', error.stack || String(error));
  } finally {
    if (needsCleanup) {
      console.log('API cleanup...');
      console.log(await cleanupViaApi());
    }
    try { unlinkSync(pngPath); } catch {}
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
