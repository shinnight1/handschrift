// Prüft, was Suchmaschinen und Chatbots lesen: strukturierte Daten, Canonical, Sitemap, llms.txt.
// Strukturierte Daten, die nicht zum sichtbaren Text passen, wertet Google als Täuschung.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { withFaq, FAQ_PAGES } from '../tools/structured-data.mjs';

const ORIGIN = 'https://siebwrite.de/';
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const sitemap = read('sitemap.xml');
const LOCS = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const fileOf = (url) => `${url.slice(ORIGIN.length)}index.html`;
const ldBlocks = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const ldNodes = (html) => ldBlocks(html).map((b) => JSON.parse(b)).flatMap((b) => b['@graph'] ?? [b]);

test('Sitemap: jede Adresse gibt es als Seite, mit Canonical auf sich selbst und ohne noindex', () => {
  assert.ok(LOCS.length > 0);
  for (const url of LOCS) {
    const file = fileOf(url);
    assert.ok(existsSync(new URL(`../${file}`, import.meta.url)), `${url}: ${file} fehlt`);
    const html = read(file);
    assert.ok(html.includes(`<link rel="canonical" href="${url}">`), `${file}: Canonical auf ${url}`);
    assert.ok(!/name="robots" content="[^"]*noindex/.test(html), `${file}: steht in der Sitemap, aber auf noindex`);
  }
});

test('Sprachfassungen verweisen gegenseitig aufeinander (hreflang)', () => {
  for (const url of LOCS) {
    const html = read(fileOf(url));
    for (const [, , href] of html.matchAll(/<link rel="alternate" hreflang="(de|en)" href="([^"]+)">/g)) {
      if (href === url) continue;
      assert.ok(LOCS.includes(href), `${fileOf(url)}: ${href} steht nicht in der Sitemap`);
      assert.ok(read(fileOf(href)).includes(`href="${url}"`), `${href} verweist nicht zurück auf ${url}`);
    }
  }
});

test('Strukturierte Daten: gültiges JSON, FAQ wörtlich wie auf der Seite (sonst node tools/structured-data.mjs)', () => {
  for (const url of LOCS) {
    const file = fileOf(url);
    const html = read(file);
    ldNodes(html); // wirft bei kaputtem JSON
    assert.equal(withFaq(html), html, `${file}: FAQ in den strukturierten Daten ist nicht aktuell`);
  }
  for (const page of FAQ_PAGES) {
    const faq = ldNodes(read(page)).find((n) => n['@type'] === 'FAQPage');
    assert.ok(faq?.mainEntity?.length >= 3, `${page}: FAQPage mit mindestens drei Fragen`);
  }
});

test('Strukturierte Daten nennen keinen Personennamen (das Impressum bleibt aus der Suche)', () => {
  for (const url of LOCS) {
    for (const block of ldBlocks(read(fileOf(url)))) {
      assert.ok(!/Siebrecht|"@type":\s*"Person"/.test(block), `${url}: kein Name in den strukturierten Daten`);
    }
  }
});

test('llms.txt verlinkt nur Seiten, die es gibt', () => {
  const llms = read('llms.txt');
  assert.match(llms, /^# Siebwrite/);
  for (const [, url] of llms.matchAll(/\((https:\/\/siebwrite\.de\/[^)]*)\)/g)) {
    assert.ok(LOCS.includes(url), `llms.txt: ${url} steht nicht in der Sitemap`);
  }
});
