// Builds Numbskull into a single self-contained HTML file.
//   node build.mjs           -> docs/index.html (the playable game, served by GitHub Pages)
//                               + dist/embed.html (body-only version for embedding in other pages)
//   node build.mjs --serve   -> rebuilds on change and serves on http://localhost:8080
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const serve = process.argv.includes('--serve');
const dev = serve || process.argv.includes('--dev');

async function build() {
  const t0 = Date.now();
  const res = await esbuild.build({
    entryPoints: ['src/main.js'],
    bundle: true,
    format: 'iife',
    minify: !dev,
    sourcemap: dev ? 'inline' : false,
    write: false,
    target: ['es2020'],
    legalComments: 'none',
    logLevel: 'warning',
  });
  const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  // fonts are embedded so the game works offline and from a single file
  const font = (family, file, weight) => {
    const b64 = fs.readFileSync(`node_modules/@fontsource/${file}`).toString('base64');
    return `@font-face{font-family:"${family}";font-style:normal;font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${b64}) format("woff2")}`;
  };
  const fonts = [
    font('Dela Gothic One', 'dela-gothic-one/files/dela-gothic-one-latin-400-normal.woff2', 400),
    font('Permanent Marker', 'permanent-marker/files/permanent-marker-latin-400-normal.woff2', 400),
    font('Atkinson Hyperlegible', 'atkinson-hyperlegible/files/atkinson-hyperlegible-latin-400-normal.woff2', 400),
    font('Atkinson Hyperlegible', 'atkinson-hyperlegible/files/atkinson-hyperlegible-latin-700-normal.woff2', 700),
  ].join('\n');
  const css = fonts + '\n' + fs.readFileSync('src/style.css', 'utf8');
  let body = fs.readFileSync('src/body.html', 'utf8');
  body = body.replace('/* BUILD:CSS */', () => css).replace('<!-- BUILD:JS -->', () => `<script>${js}</script>`);
  // split head material (title, font links, style) from the page body
  const cut = body.indexOf('<canvas id="gl"');
  const head = body.slice(0, cut).trim();
  const rest = body.slice(cut).trim();
  const tpl = fs.readFileSync('src/index.html', 'utf8');
  const full = tpl.replace('<title>Numbskull</title>\n', '').replace('<!-- BUILD:HEAD -->', () => head).replace('<!-- BUILD:BODY -->', () => rest);
  fs.mkdirSync('docs', { recursive: true });
  fs.mkdirSync('dist', { recursive: true });
  fs.writeFileSync('docs/index.html', full);
  fs.writeFileSync('docs/.nojekyll', '');
  fs.writeFileSync('dist/embed.html', body);
  console.log(`built docs/index.html  ${(full.length / 1024).toFixed(0)} KB  in ${Date.now() - t0} ms`);
}

await build();

if (serve) {
  let timer = null;
  fs.watch('src', { recursive: true }, () => { clearTimeout(timer); timer = setTimeout(() => build().catch(e => console.error(e.message)), 80); });
  http.createServer((req, res) => {
    const f = path.join('docs', req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
    fs.readFile(f, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  }).listen(8080, () => console.log('serving on http://localhost:8080'));
}
