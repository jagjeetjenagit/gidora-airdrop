'use strict';
const crypto = require('crypto');

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const MAP = Object.fromEntries([...ALPHABET].map((c, i) => [c, BigInt(i)]));

function base58Decode(str) {
  if (typeof str !== 'string' || !str.length) throw new Error('empty');
  let num = 0n;
  for (const ch of str) {
    const v = MAP[ch];
    if (v === undefined) throw new Error('invalid base58');
    num = num * 58n + v;
  }
  const bytes = [];
  while (num > 0n) { bytes.unshift(Number(num & 0xffn)); num >>= 8n; }
  for (const ch of str) { if (ch === '1') bytes.unshift(0); else break; }
  return Buffer.from(bytes);
}

function base58Encode(buf) {
  let num = BigInt('0x' + (Buffer.from(buf).toString('hex') || '0'));
  let out = '';
  while (num > 0n) { out = ALPHABET[Number(num % 58n)] + out; num /= 58n; }
  for (const b of buf) { if (b === 0) out = '1' + out; else break; }
  return out;
}

function isValidAddress(addr) {
  if (typeof addr !== 'string' || addr.length < 32 || addr.length > 44) return false;
  try { return base58Decode(addr).length === 32; } catch { return false; }
}

/** Verify an ed25519 signature produced by wallet.signMessage(). */
function verifySignature(address, message, signatureB58) {
  try {
    const pub = base58Decode(address);
    const sig = base58Decode(signatureB58);
    if (pub.length !== 32 || sig.length !== 64) return false;
    const key = crypto.createPublicKey({
      key: { kty: 'OKP', crv: 'Ed25519', x: pub.toString('base64url') },
      format: 'jwk',
    });
    return crypto.verify(null, Buffer.from(message, 'utf8'), key, sig);
  } catch {
    return false;
  }
}

function shortAddress(a) {
  return a && a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a;
}

module.exports = { base58Decode, base58Encode, isValidAddress, verifySignature, shortAddress };
