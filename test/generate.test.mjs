import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generate } from '../src/generate.mjs';
import { ConfigError } from '../src/config.mjs';
import { THEMES } from '../src/themes.mjs';
import { wrap, fit, sansWidth, slug } from '../src/util.mjs';
import { inline } from '../src/readme.mjs';

const sample = JSON.parse(readFileSync(new URL('../profile.config.json', import.meta.url), 'utf8'));
const svgsOf = (files) => Object.entries(files).filter(([path]) => path.endsWith('.svg'));

/** Throws unless `xml` has balanced tags and no bare ampersands. */
function assertWellFormed(xml, label) {
  const bare = xml.match(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i);
  assert.equal(bare, null, `${label}: bare "&" near "${xml.slice(bare?.index ?? 0, (bare?.index ?? 0) + 30)}"`);
  const stack = [];
  // <style> holds CSS, which may contain ">" but never markup.
  const markup = xml.replace(/<style>[\s\S]*?<\/style>/g, '<style></style>');
  for (const [, close, name, , selfClose] of markup.matchAll(/<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|[^">])*?)(\/?)>/g)) {
    if (selfClose) continue;
    if (close) assert.equal(stack.pop(), name, `${label}: unexpected </${name}>`);
    else stack.push(name);
  }
  assert.deepEqual(stack, [], `${label}: unclosed tags`);
}

test('the sample config builds every expected file', () => {
  const files = generate(sample);
  for (const path of ['README.md', 'assets/hero.svg', 'assets/divider.svg', 'assets/featured.svg', 'assets/stack.svg', 'assets/footer.svg']) {
    assert.ok(files[path], `missing ${path}`);
  }
  assert.equal(Object.keys(files).filter((p) => p.startsWith('assets/project-')).length, sample.projects.length);
  assert.equal(Object.keys(files).filter((p) => p.startsWith('assets/link-')).length, sample.links.length);
});

test('every image the README references is generated, and vice versa', () => {
  const files = generate(sample);
  const referenced = new Set([...files['README.md'].matchAll(/src="(assets\/[^"]+)"/g)].map((m) => m[1]));
  const generated = new Set(Object.keys(files).filter((p) => p.startsWith('assets/')));
  assert.deepEqual([...referenced].sort(), [...generated].sort());
});

test('every theme produces well-formed SVG', () => {
  for (const theme of Object.keys(THEMES)) {
    for (const [path, content] of svgsOf(generate(sample, { theme }))) assertWellFormed(content, `${theme}/${path}`);
  }
});

test('every artwork and tile count produces well-formed SVG', () => {
  for (const art of ['qr', 'orbit', 'bars']) {
    for (let count = 1; count <= 4; count++) {
      const featured = { ...sample.featured, art, features: sample.featured.features.slice(0, count) };
      assertWellFormed(generate({ ...sample, featured })['assets/featured.svg'], `${art}/${count}`);
    }
  }
});

test('builds are deterministic', () => {
  assert.deepEqual(generate(sample), generate(sample));
});

test('a name-only config builds a minimal profile', () => {
  const files = generate({ name: 'Solo' });
  assert.deepEqual(Object.keys(files).sort(), ['README.md', 'assets/divider.svg', 'assets/hero.svg']);
  assert.match(files['README.md'], /profile-forge/);
  assert.doesNotMatch(generate({ name: 'Solo', credit: false })['README.md'], /profile-forge/);
});

test('hostile text is escaped everywhere', () => {
  const evil = `<script>alert("x")</script> & <b>`;
  const files = generate({
    name: evil,
    taglines: [evil],
    status: evil,
    location: evil,
    links: [{ label: evil, text: evil, url: 'https://example.com/?a=1&b=2' }],
    about: { rows: [{ label: evil, value: evil }] },
    featured: { name: evil, lead: { title: evil, text: evil }, features: [{ icon: 'bolt', title: evil, text: evil }], stack: [evil] },
    projects: [{ name: evil, tag: evil, description: evil, stack: [evil] }],
    toolkit: [evil],
    footer: evil,
  });
  for (const [path, content] of svgsOf(files)) {
    assertWellFormed(content, path);
    assert.doesNotMatch(content, /<script|<b>/i, path);
  }
  assert.doesNotMatch(files['README.md'], /<script/i);
});

test('long and CJK text is shortened to fit instead of overflowing', () => {
  const long = 'An extraordinarily long description that keeps going well past anything a card could hold, '.repeat(4);
  const files = generate({
    name: 'A Remarkably Long Name That Would Never Fit At Full Size',
    projects: [{ name: '木漏れ日商店'.repeat(6), description: long, stack: Array(8).fill('Technology') }],
    toolkit: ['An absurdly long toolkit entry that is wider than the whole row of chips'],
  });
  const card = files['assets/project-item.svg'];
  assert.ok(card, 'a name with no ASCII letters still gets a file name');
  assert.equal((card.match(/class="dsc"/g) ?? []).length, 2);
  assert.match(card, /…/);
  assert.match(files['assets/hero.svg'], /font: 800 30px/);
});

test('wrap respects the width and line limits', () => {
  const text = 'the quick brown fox jumps over the lazy dog again and again and again';
  const lines = wrap(text, 14, 200, 2);
  assert.equal(lines.length, 2);
  for (const line of lines) assert.ok(sansWidth(line, 14) <= 200, line);
  assert.ok(lines[1].endsWith('…'));
  assert.deepEqual(wrap('short', 14, 200, 2), ['short']);
  assert.deepEqual(wrap('', 14, 200, 2), []);
  assert.equal(fit('', 14, 200), '');
  assert.ok(sansWidth(fit('日本語'.repeat(20), 14, 100), 14) <= 100);
});

test('slug and inline helpers', () => {
  assert.equal(slug('Tessera UI'), 'tessera-ui');
  assert.equal(slug('日本語'), 'item');
  assert.equal(inline('**bold** and [a link](https://example.com) & `code`'),
    '<b>bold</b> and <a href="https://example.com">a link</a> &amp; <code>code</code>');
  assert.doesNotMatch(inline('[x](javascript:alert(1))'), /<a /);
});

test('duplicate names get distinct files', () => {
  const files = generate({ name: 'Dup', projects: [{ name: 'Same' }, { name: 'Same' }] });
  assert.ok(files['assets/project-same.svg'] && files['assets/project-same-2.svg']);
});

test('config problems are reported together, in plain words', () => {
  assert.throws(
    () => generate({
      theme: 'nope',
      links: [{ label: 'Site', text: 'x', url: 'javascript:alert(1)' }],
      featured: { name: 'X', art: 'spiral', lead: { title: 'T' }, features: [{ icon: 'unicorn', title: 'A' }] },
      activity: { streak: true },
      sections: { nonsense: 'x' },
    }),
    (err) => {
      assert.ok(err instanceof ConfigError);
      const all = err.problems.join('\n');
      for (const expected of ['name: required', 'unknown theme "nope"', 'links[0].url', 'unknown artwork "spiral"', 'unknown icon "unicorn"', 'activity.streak', 'sections.nonsense']) {
        assert.ok(all.includes(expected), `expected a problem mentioning ${expected}\n${all}`);
      }
      return true;
    },
  );
  assert.throws(() => generate([]), ConfigError);
  assert.throws(() => generate({ name: 'X', featured: { name: 'Y', lead: { title: 'T' }, features: [] } }), /between 1 and 4/);
});

test('custom themes override a base and reject bad colours', () => {
  const files = generate({ name: 'X', theme: { base: 'paper', a1: '#123456' } });
  assert.match(files['assets/hero.svg'], /#123456/);
  assert.throws(() => generate({ name: 'X', theme: { a1: 'red' } }), /6-digit hex/);
  assert.throws(() => generate({ name: 'X', theme: { nope: '#000000' } }), /unknown colour token/);
});

test('the streak badge is opt-in and uses the theme colours', () => {
  assert.doesNotMatch(generate(sample)['README.md'], /streak-stats/);
  const readme = generate({ ...sample, github: 'octocat', activity: { streak: true } })['README.md'];
  assert.match(readme, /streak-stats\.demolab\.com\?user=octocat&/);
  assert.match(readme, /ring=67E8F9/);
  assert.match(readme, /stroke=262D37&/);
});
