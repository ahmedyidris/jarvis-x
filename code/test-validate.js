const { validateAction } = require('./validate.js');

const cases = [
  { a: null, want: 'not an object' },
  { a: 42, want: 'not an object' },
  { a: {}, want: 'unknown action "undefined"' },
  { a: {type:'delete', path:'code'}, want: 'unknown action "delete"' },
  { a: {type:'answer'}, want: 'answer with no text' },
  { a: {type:'answer', text:''}, want: 'answer with no text' },
  { a: {type:'answer', text:'   '}, want: 'answer with no text' },
  { a: {type:'answer', text:'here you go'}, want: null },
  { a: {type:'list'}, want: 'list requires a path' },
  { a: {type:'read', path:''}, want: 'read requires a path' },
  { a: {type:'write', path:123, content:'hi'}, want: 'write requires a path' },
  { a: {type:'list', path:'code/*.js'}, want: 'path contains a glob' },
  { a: {type:'read', path:'~/secrets'}, want: 'path must be relative' },
  { a: {type:'write', path:'/etc/shadow', content:'hi'}, want: 'path must be relative' },
  { a: {type:'read', path:'code/../../../etc/passwd'}, want: 'path escapes' },
  { a: {type:'list', path:'a/b/../c'}, want: 'path escapes' },
  { a: {type:'list', path:'nope-does-not-exist'}, want: 'no such directory' },
  { a: {type:'list', path:'code/validate.js'}, want: 'not a directory' },
  { a: {type:'list', path:'code'}, want: null },
  { a: {type:'list', path:'.'}, want: null },
  { a: {type:'read', path:'nope-does-not-exist.txt'}, want: 'no such file' },
  { a: {type:'read', path:'code'}, want: 'is a directory' },
  { a: {type:'read', path:'knowledge/Guidelines.md'}, want: null },
];

let pass = 0;
cases.forEach(tc => {
  const result = validateAction(tc.a);
  const r = result.reason || '';
  const ok = tc.want === null ? result.valid : r.includes(tc.want);
  pass += ok ? 1 : 0;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${tc.want ? tc.want.padEnd(6) : 'accept'.padEnd(6)} ${JSON.stringify(tc.a).slice(0,52).padEnd(54)} ${r || ''}`);
});
console.log(`\n${pass}/${cases.length} passed`);
