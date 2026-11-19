/* Logto 1.46 audit hardening. The upstream MPL-2.0 notices and source remain intact. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = process.cwd();
assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'packages/core/package.json'))).version, '1.46.0');
const changes = [
  ['packages/core/src/utils/sensitive-data.ts', "new Set(['authorization', 'xfunctionskey', 'token'])", "new Set(['authorization', 'xfunctionskey', 'token', 'code', 'verificationcode', 'authorizationcode'])"],
  ['packages/core/build/main-5SWK6CWG.js', 'new Set(["authorization", "xfunctionskey", "token"])', 'new Set(["authorization", "xfunctionskey", "token", "code", "verificationcode", "authorizationcode"])'],
];
// Check every pinned source anchor before writing; fail closed on a different build.
const plans = changes.map(([file, before, after]) => {
  const target = path.join(root, file), original = fs.readFileSync(target, 'utf8');
  if (original.includes(after)) return { target, content: original };
  assert.equal(original.split(before).length, 2, 'Unexpected Logto audit sanitizer build');
  return { target, content: original.replace(before, after) };
});
const compiled = plans[1].content;
const start = compiled.indexOf('var sensitiveDataMask = ');
const end = compiled.indexOf('// src/middleware/koa-audit-log.ts', start);
assert(start > 0 && end > start);
const context = { isArray: Array.isArray, isRecord: value => value !== null && typeof value === 'object' && !Array.isArray(value) };
vm.createContext(context);
vm.runInContext(compiled.slice(start, end), context);
const sample = { code: '654321', password: 'synthetic-password', nested: [{ authorization_code: 'synthetic-oauth-code', verificationCode: '123456', cookie: 'synthetic-cookie' }], hasPassword: true, passwordVerified: false, status: 'incorrect', verificationId: 'public-receipt' };
const safe = context.sanitizeSensitiveDataRecord(sample);
assert.equal(safe.code, '******'); assert.equal(safe.password, '******');
assert.equal(safe.nested[0].authorization_code, '******'); assert.equal(safe.nested[0].verificationCode, '******'); assert.equal(safe.nested[0].cookie, '******');
assert.equal(safe.hasPassword, true); assert.equal(safe.passwordVerified, false); assert.equal(safe.status, 'incorrect'); assert.equal(safe.verificationId, 'public-receipt');
for (const plan of plans) fs.writeFileSync(plan.target, plan.content);
console.log('Logto 1.46.0 audit credential/code redaction verified.');
