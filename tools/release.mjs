#!/usr/bin/env node
// Edu Snigdho আপডেট রিলিজ টুল (Node.js 18+ লাগবে)
//   node tools/release.mjs init
//   node tools/release.mjs release --version 1.0.1 --note "ফোনে মেনুর ফিক্স"
//   node tools/release.mjs release --notice "জরুরি বার্তা" --id n1 --audience all --level warn --until 2026-12-31
//   node tools/release.mjs release --clear-notice
import { webcrypto } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { subtle } = webcrypto;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEY = join(root, 'private.jwk.json');
const DOCS = join(root, 'docs');
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const sha = async (t) => Buffer.from(await subtle.digest('SHA-256', Buffer.from(t))).toString('hex');
const ALG = { name: 'ECDSA', namedCurve: 'P-256' };

function args(list) {
  const o = { note: [] };
  for (let i = 0; i !== list.length; i++) {
    const a = list[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    if (k === 'clear-notice') { o['clear-notice'] = true; continue; }
    const v = list[++i];
    if (k === 'note') o.note.push(v); else o[k] = v;
  }
  return o;
}

async function init() {
  if (existsSync(KEY)) { console.error('private.jwk.json আগে থেকেই আছে। নতুন কী বানালে আগের সব সাইটের আপডেট বন্ধ হয়ে যাবে, তাই থামানো হলো।'); process.exit(1); }
  const kp = await subtle.generateKey(ALG, true, ['sign', 'verify']);
  const priv = await subtle.exportKey('jwk', kp.privateKey);
  const pub = await subtle.exportKey('jwk', kp.publicKey);
  writeFileSync(KEY, JSON.stringify(priv, null, 2));
  console.log('তৈরি হয়েছে: private.jwk.json (গোপন রাখুন, কখনো GitHub-এ তুলবেন না, ব্যাকআপ রাখুন)\n');
  console.log('থিম XML-এর CFG-তে pub-এর জায়গায় এটা বসান:\n');
  console.log(`pub:{kty:'EC',crv:'P-256',x:'${pub.x}',y:'${pub.y}'}`);
}

async function release(o) {
  if (!existsSync(KEY)) { console.error('আগে `node tools/release.mjs init` চালান।'); process.exit(1); }
  mkdirSync(DOCS, { recursive: true });
  const mf = join(DOCS, 'manifest.json');
  let prev = {};
  if (existsSync(mf)) { try { prev = JSON.parse(JSON.parse(readFileSync(mf, 'utf8')).p); } catch {} }
  const version = o.version || prev.version;
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) { console.error('--version দিন (যেমন 1.0.1)।'); process.exit(1); }

  const payload = { version, date: new Date().toISOString().slice(0, 10), notes: o.note.length ? o.note : (o.version ? [] : prev.notes || []) };
  const keep = new Set(['manifest.json', 'index.html', '.nojekyll']);
  for (const ext of ['css', 'js']) {
    const f = join(root, 'src', `patch.${ext}`);
    const code = existsSync(f) ? readFileSync(f, 'utf8') : '';
    if (!code.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '').trim()) continue;
    const h = await sha(code);
    const name = `patch.${h.slice(0, 10)}.${ext}`;
    writeFileSync(join(DOCS, name), code);
    payload[ext] = { u: name, h };
    keep.add(name);
  }
  if (o['clear-notice']) { /* বার্তা বাদ */ }
  else if (o.notice) {
    payload.notice = { id: o.id || ('n' + Date.now()), text: o.notice, level: o.level || 'info', audience: o.audience || 'owner' };
    if (o.until) payload.notice.until = o.until;
    if (o.link) payload.notice.link = o.link;
  } else if (prev.notice) payload.notice = prev.notice;

  for (const f of readdirSync(DOCS)) if (!keep.has(f) && /^patch\./.test(f)) unlinkSync(join(DOCS, f));

  const priv = JSON.parse(readFileSync(KEY, 'utf8'));
  const key = await subtle.importKey('jwk', priv, ALG, false, ['sign']);
  const p = JSON.stringify(payload);
  const sig = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, Buffer.from(p));
  const pubKey = await subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: priv.x, y: priv.y }, ALG, false, ['verify']);
  if (!(await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pubKey, sig, Buffer.from(p)))) { console.error('স্বাক্ষর যাচাই ব্যর্থ।'); process.exit(1); }
  writeFileSync(mf, JSON.stringify({ p, s: b64u(sig) }));
  writeFileSync(join(DOCS, '.nojekyll'), '');
  if (!existsSync(join(DOCS, 'index.html'))) writeFileSync(join(DOCS, 'index.html'), '<!doctype html><meta charset="utf-8"><title>Edu Snigdho updates</title>');
  console.log(`রিলিজ তৈরি: ভার্সন ${version}`);
  console.log('  CSS:', payload.css ? payload.css.u : 'নেই', '| JS:', payload.js ? payload.js.u : 'নেই', '| বার্তা:', payload.notice ? payload.notice.id : 'নেই');
  console.log('এখন docs ফোল্ডারসহ git commit ও push করুন।');
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'init') await init();
else if (cmd === 'release') await release(args(rest));
else console.log('ব্যবহার:\n  node tools/release.mjs init\n  node tools/release.mjs release --version 1.0.1 --note "বিবরণ"\n  node tools/release.mjs release --notice "বার্তা" --id n1 --audience all --level warn --until 2026-12-31\n  node tools/release.mjs release --clear-notice');
