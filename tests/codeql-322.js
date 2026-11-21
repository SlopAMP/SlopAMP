// 3.2.2: GitHub code scanning (CodeQL) alerts #3-#7: the text clean-ups made complete, with nothing different for
// normal text. Each new function is read from the app's source and run next to its 3.2.1 version (read from git, tag
// v3.2.1), on normal text (which must come out exactly the same) and on made-up text:
//   - cleanSkinCss (main.js; imported and user skins): the whole clean-up runs until nothing changes, so @import,
//     <style>, url(), expression( and -moz-binding pieced together around something it removes go too; behavior:
//     becomes x-behavior: once (3.2.1 grew x-x-…); text that never settles gives nothing. The 10 built-in skins and an
//     exported skin: the same as 3.2.1. In the running app: a crafted user skin comes back clean (skin:css).
//   - htmlText (main.js; an X post's title from its oEmbed HTML): tags stripped until none is left, then entities,
//     &amp; last: "&amp;#60;" stays "&#60;" (3.2.1 made it "<"). A real post's HTML: the same title as 3.2.1.
//   - capParse (app.js; .srt / .vtt captions): tags and {\…} codes stripped until none is left, then entities. A .srt
//     with tags, a .vtt with cue settings and a NOTE, and YouTube's rolling auto-captions: the same lines as 3.2.1,
//     also in the running app; capParse and capPasteLines find timing lines by a plain search (no regex literal
//     for the arrow, which CodeQL's js/bad-tag-filter took for an HTML comment filter).
// Run (Linux, xvfb): SLOPAMP_ELECTRON=… xvfb-run -a node tests/codeql-322.js   (needs git and the v3.2.1 tag)
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const { launch, APP } = require('./lib');
const fails = []; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails.push(m); };
const short = (s) => JSON.stringify(String(s).length > 110 ? `${String(s).slice(0, 110)}…` : String(s));

// a top-level function's source: from "function name(" to the "}" that closes it at the start of a line
const fnSrc = (src, name) => {
  const i = src.indexOf(`\nfunction ${name}(`); if (i < 0) throw new Error(`function ${name} not found`);
  return src.slice(i + 1, src.indexOf('\n}\n', i) + 2);
};
const load = (src, name, pre = '') => new Function(`${pre}\n${fnSrc(src, name)}\nreturn ${name};`)();   // eslint-disable-line no-new-func
let old;
try { old = (f) => execFileSync('git', ['-C', path.join(__dirname, '..'), 'show', `v3.2.1:${f}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); old('package.json'); }
catch (_) { console.log('needs git and the v3.2.1 tag (git fetch --tags)'); process.exit(2); }
const cur = (f) => fs.readFileSync(path.join(APP, f), 'utf8');
const MAIN = cur('src/main.js'), APPJS = cur('src/renderer/app.js'), MAIN0 = old('src/main.js'), APPJS0 = old('src/renderer/app.js');
const N = { skin: load(MAIN, 'cleanSkinCss'), html: load(MAIN, 'htmlText'), cap: load(APPJS, 'capParse', 'let capSeq = 0;') };
const O = { skin: load(MAIN0, 'cleanSkinCss'), html: load(MAIN0, 'htmlText'), cap: load(APPJS0, 'capParse', 'let capSeq = 0;') };
const lines = (l) => JSON.stringify(l.map(({ a, b, t }) => ({ a, b, t })));     // capParse's lines without their ids

// what must not be left: a tag ("<" … ">" with something between), and in a skin each thing the clean-up removes
const hasTag = (s) => { for (let i = s.indexOf('<'); i >= 0; i = s.indexOf('<', i + 1)) { const j = s.indexOf('>', i + 1); if (j > i + 1) return true; } return false; };
const lc = (s) => String(s).toLowerCase();
const urlLeft = (s) => { const t = lc(s); for (let i = t.indexOf('url('); i >= 0; i = t.indexOf('url(', i + 1)) if (!/^url\(\s*['"]?data:/.test(t.slice(i))) return true; return false; };
const skinBad = (s) => ['@import', '<style', '</style', 'expression(', '-moz-binding'].filter(w => lc(s).replace(/\s+/g, '').includes(w))
  .concat(urlLeft(s) ? ['url('] : [], /(?<!x-)behavior\s*:/i.test(s) ? ['behavior:'] : []);

(async () => {
  // ---------- cleanSkinCss ----------
  const dir = path.join(APP, 'src/renderer/skins'), built = fs.readdirSync(dir).filter(f => f.endsWith('.css')).sort();
  const same = built.filter(f => { const t = fs.readFileSync(path.join(dir, f), 'utf8'); return N.skin(t) === O.skin(t) && N.skin(t) === t; });
  ok(built.length >= 10 && same.length === built.length, `the ${built.length} built-in skins come out exactly as from 3.2.1 (and unchanged): ${built.filter(f => !same.includes(f)).join(', ') || 'all'}`);
  const exported = '/* SlopAMP skin: "Night Drive" — made with the Skin Editor from "Synthwave".\n'
    + '   slopamp: {"name":"Night Drive","baseName":"Synthwave","swatches":["#1a0f2e","#ff3cac","#2bd2ff"]}\n'
    + '   Loaded on top of classic.css; only what differs from Classic is here.\n'
    + '   To share it, share this file: Library → SKINS → Import adds it to another SlopAMP. */\n'
    + ':root {\n  --frame-outer: #1a0f2e;\n  --green: #2bd2ff;\n  --menu-accent: #ff3cac;\n  --font-lcd: "DejaVu Sans Mono", monospace;\n}\n\n'
    + '.lcd { background-image: url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="); }\n'
    + '.btn::after { content: "\\25B6"; } /* ▶ */\n@media (max-width: 320px) { .eq-bars { display: none; } }\n';
  ok(N.skin(exported) === O.skin(exported) && N.skin(exported) === exported, 'an exported skin (header, colours, a data: picture, extra rules) comes out exactly as from 3.2.1');
  const tricky = [
    ['nested @import', "@im@import 'a.css';port url(https://example.com/x.css);\n:root { --a: #000; }"],
    ['@import split by <style>', '@imp<style>ort "https://example.com/x.css";'],
    ['split <style>', '<sty<style>le>body { color: red }</sty</style>le>'],
    ['url( split by <style>', '.a { background: ur<style>l(https://example.com/p.png) }'],
    ['url( split by @import', '.a { background: ur@import;l(https://example.com/p.png) }'],
    ['url(url(…))', '.a { background: url(url(https://example.com/p.png)) }'],
    ['mixed case', "@ImPoRt 'x.css'; <STYLE>.a{ background: URL( https://example.com/p.png ) }</StYlE >"],
    ['expression( split', '.a { width: expres<style>sion(alert(1)) }'],
    ['-moz-binding split', '.a { -moz-bin<style>ding: url(x.xml#b) }'],
    ['behavior: split', '.a { beha<style>vior: url(x.htc) }'],
    ['behavior:', '.a { behavior: url(x.htc); -ms-behavior: url(y.htc) }'],
  ];
  for (const [what, t] of tricky) {
    const n = N.skin(t), bad = skinBad(n);
    ok(!bad.length && N.skin(n) === n, `skin, ${what}: nothing left (${bad.join(', ') || 'clean'}) and it stays as it is: ${short(n)}`);
  }
  ok(skinBad(O.skin(tricky[0][1])).includes('@import') && skinBad(O.skin(tricky[2][1])).includes('<style'), `(3.2.1 left them: ${short(O.skin(tricky[0][1]))}, ${short(O.skin(tricky[2][1]))})`);
  const beh = '.a { behavior: url(x.htc) }';
  ok(N.skin(N.skin(beh)) === N.skin(beh) && /x-behavior:/.test(N.skin(beh)) && O.skin(O.skin(beh)) !== O.skin(beh), `behavior: becomes x-behavior: once: ${short(N.skin(N.skin(beh)))} (3.2.1 the second time: ${short(O.skin(O.skin(beh)))})`);
  let deep = '<style>'; for (let i = 0; i < 12; i++) deep = `<sty${deep}le>`;
  ok(N.skin(`:root { --a: #000; }\n${deep}`) === '', 'text that is still changing after 10 rounds (12 nested <style>): nothing is kept');
  let five = '<style>'; for (let i = 0; i < 5; i++) five = `<sty${five}le>`;
  ok(N.skin(`:root { --a: #000; }\n${five}.b { color: red }`) === ':root { --a: #000; }\n.b { color: red }', `5 nested <style> settle and the rest is kept: ${short(N.skin(`:root { --a: #000; }\n${five}.b { color: red }`))}`);

  // ---------- htmlText (X titles) ----------
  const post = 'Big news: SlopAMP 3.2 runs on Linux too &amp; docks like it does on Windows 🐧<br><br>Grab it 👉 '
    + '<a href="https://t.co/AbC123xyz">https://t.co/AbC123xyz</a> &quot;free&quot; &amp; open, it&#39;s yours &lt;3 '
    + '<a href="https://twitter.com/hashtag/Linux?src=hash&amp;ref_src=twsrc%5Etfw">#Linux</a> it&#8217;s here&nbsp;now &mdash; '
    + 'don&apos;t wait &gt;&gt; <a href="https://t.co/PiC456">pic.twitter.com/PiC456</a>';
  ok(N.html(post) === O.html(post), `a real post's HTML gives the same title as 3.2.1: ${short(N.html(post))}`);
  const normal = ['Tom &amp; Jerry', 'a &lt;b&gt; c', 'x<br/>y<BR>z', '5 &gt; 3 &amp;&amp; 2 &lt; 4', 'caf&#233; &#128512;', 'plain text', ''];
  ok(normal.every(t => N.html(t) === O.html(t)), `normal titles: the same as 3.2.1 (${normal.map(t => short(N.html(t))).join(' · ')})`);
  for (const [what, t, want] of [
    ['double-encoded <', '&amp;#60;script&amp;#62;alert(1)&amp;#60;/script&amp;#62;', '&#60;script&#62;alert(1)&#60;/script&#62;'],
    ['double-encoded &lt;', '&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;', '&lt;script&gt;alert(1)&lt;/script&gt;'],
    ['&#38;amp;', 'a &#38;amp; b &#38;lt;i&#38;gt;', 'a &amp; b &lt;i&gt;'],
  ]) ok(N.html(t) === want && !N.html(t).includes('<'), `title, ${what}: decoded once, no "<": ${short(N.html(t))}`);
  ok(O.html('&amp;#60;script&amp;#62;') === '<script>', `(3.2.1 made "&amp;#60;script&amp;#62;" ${short(O.html('&amp;#60;script&amp;#62;'))})`);
  for (const t of ['<<b>script>alert(1)<</b>/script>', '<scr<b>ipt>alert(1)</scr</b>ipt>', '<<<a href="x">>>b<<i>>', '<SCRIPT\n>x</SCRIPT\t>']) {
    const n = N.html(t);
    ok(!hasTag(n) && N.html(n) === n, `title, tags inside tags: none left: ${short(t)} → ${short(n)}`);
  }

  // ---------- capParse (.srt / .vtt) ----------
  const SRT = '1\n00:00:01,000 --> 00:00:03,000\n<i>we left the city</i> at <b>midnight</b>\n\n'
    + '2\n00:00:04,000 --> 00:00:06,500\n{\\an8}<font color="#ffcc00">Tom &amp; Jerry</font>\n&lt;laughs&gt; &quot;ok&quot; it&#39;s&nbsp;fine\n\n'
    + '3\n00:00:07,000 --> 00:00:09,000\n- Two lines\n- <u>second</u> speaker\n\n4\n00:00:10,000 --> 00:00:09,000\nbackwards: skipped\n';
  const SRTW = `﻿${SRT.replace(/\n/g, '\r\n')}`;
  const VTT = 'WEBVTT\n\nNOTE made by hand --> not a cue\n\nintro\n00:00:00.500 --> 00:00:02.000 align:start position:10%\n<v Narrator>Hello</v> <c.colorE5E5E5>world</c>\n\n'
    + '00:02.500 --> 00:04.000\n<ruby>漢<rt>kan</rt></ruby> &amp; more\n';
  const AUTO = 'WEBVTT\nKind: captions\nLanguage: en\n\n00:00:00.500 --> 00:00:02.990 align:start position:0%\n \nhello<00:00:01.000><c> there</c><00:00:01.400><c> friends</c>\n\n'
    + '00:00:02.990 --> 00:00:03.000 align:start position:0%\nhello there friends\n \n\n'
    + '00:00:03.000 --> 00:00:05.500 align:start position:0%\nhello there friends\nhow<00:00:03.500><c> are</c><00:00:04.000><c> you</c>\n\n'
    + '00:00:05.500 --> 00:00:05.510 align:start position:0%\nhow are you\n \n\n00:00:05.510 --> 00:00:08.000 align:start position:0%\nhow are you\ngood<c> thanks</c>\n';
  const samples = { '.srt': SRT, '.srt (Windows line ends, BOM)': SRTW, '.vtt': VTT, "YouTube's auto-captions .vtt": AUTO };
  for (const [what, t] of Object.entries(samples)) ok(lines(N.cap(t)) === lines(O.cap(t)) && N.cap(t).length > 0, `captions, ${what}: the same lines as 3.2.1 (${N.cap(t).length}: ${short(N.cap(t).map(l => l.t).join(' | '))})`);
  const CRAFT = '1\n00:00:01,000 --> 00:00:02,000\n<<i>i>x <scr<b>ipt>alert(1)</scr<b>ipt> {\\{\\an8}an8}y &amp;lt;i&amp;gt; <<<b>>>z\n';
  const c = N.cap(CRAFT), ct = c.length ? c[0].t : '';
  ok(c.length === 1 && !hasTag(ct) && !ct.includes('{\\') && !ct.includes('<i>'), `captions, tags and {\\…} inside each other: none left: ${short(ct)}`);
  ok(!fnSrc(APPJS, 'capParse').includes('/-->/') && !fnSrc(APPJS, 'capPasteLines').includes('/-->/') && fnSrc(APPJS, 'capPasteLines').includes("includes('-->')"), 'capParse and capPasteLines find timing lines with a plain search (no regex literal for the arrow)');

  // ---------- in the running app ----------
  const H = path.join(os.tmpdir(), 'slopamp-test-codeql-322');
  const { app, win, errs } = await launch(H);
  const dl = await app.evaluate(({ app: a }) => a.getPath('downloads'));
  fs.mkdirSync(path.join(dl, 'SlopAMP', 'skins'), { recursive: true });
  const evil = `${exported}\n${tricky.map(([, t]) => t).join('\n')}\n`;
  fs.writeFileSync(path.join(dl, 'SlopAMP', 'skins', 'crafted.css'), evil);
  const got = await win.evaluate(() => window.phosphor.skinCss('user:crafted'));
  ok(typeof got === 'string' && got === N.skin(evil) && !skinBad(got).length, `the running app: a crafted user skin comes back cleaned (skin:css, ${got && got.length} chars, ${skinBad(got || '').join(', ') || 'nothing left'})`);
  const inApp = await win.evaluate((ss) => Object.fromEntries(Object.entries(ss).map(([k, t]) => [k, capParse(t).map(({ a, b, t: x }) => ({ a, b, t: x }))])), { ...samples, craft: CRAFT });
  ok(Object.keys(samples).every(k => JSON.stringify(inApp[k]) === lines(O.cap(samples[k]))) && JSON.stringify(inApp.craft) === lines(N.cap(CRAFT)), 'the running app: capParse gives the same lines as 3.2.1 for the samples, and the clean ones for the crafted file');
  ok(!errs.length, `no errors in the windows ${JSON.stringify(errs.slice(0, 3))}`);
  await app.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL OK');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
