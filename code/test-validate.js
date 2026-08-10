const { validate, KNOWN } = require('./validate.js');

// Each case: [proposal, want]. 'want' is 'accept' or 'reject'.
// Covers the structural checks in validate.js, one case per branch --
// plus a few combinations the inline suite in validate.js doesn't hit.
const cases = [
  // malformed input
  [null,                                                          'reject'],
  [42,                                                             'reject'],
  [{},                                                             'reject'],
  [{action:'delete',path:'code'},                                 'reject'],

  // answer
  [{action:'answer'},                                             'reject'],
  [{action:'answer',text:''},                                     'reject'],
  [{action:'answer',text:'   '},                                  'reject'],
  [{action:'answer',text:'here you go'},                          'accept'],

  // path presence/shape, shared by list/read/write
  [{action:'list'},                                               'reject'],
  [{action:'read',path:''},                                       'reject'],
  [{action:'write',path:123,content:'hi'},                        'reject'],
  [{action:'list',path:'code/*.js'},                              'reject'],
  [{action:'read',path:'~/secrets'},                              'reject'],
  [{action:'write',path:'/etc/shadow',content:'hi'},              'reject'],
  [{action:'read',path:'code/../../../etc/passwd'},               'reject'],
  [{action:'list',path:'a/b/../c'},                               'reject'],

  // list
  [{action:'list',path:'nope-does-not-exist'},                    'reject'],
  [{action:'list',path:'code/validate.js'},                       'reject'],
  [{action:'list',path:'code'},                                   'accept'],
  [{action:'list',path:'.'},                                      'accept'],

  // read
  [{action:'read',path:'nope-does-not-exist.txt'},                'reject'],
  [{action:'read',path:'code'},                                   'reject'],
  [{action:'read',path:'knowledge/Guidelines.md'},                'accept'],

  // write
  [{action:'write',path:'logs/scratch.txt'},                      'reject'],
  [{action:'write',path:'logs/scratch.txt',content:''},           'reject'],
  [{action:'write',path:'logs/scratch.txt',content:'  '},         'reject'],
  [{action:'write',path:'logs/scratch.txt',content:'TODO'},       'reject'],
  [{action:'write',path:'logs/scratch.txt',content:'Placeholder'},'reject'],
  [{action:'write',path:'logs/scratch.txt',content:'real data'},  'accept'],

  // git_log
  [{action:'git_log',n:-1},                                       'reject'],
  [{action:'git_log',n:0},                                        'reject'],
  [{action:'git_log',n:'abc'},                                    'reject'],
  [{action:'git_log',n:3},                                        'accept'],
  [{action:'git_log'},                                             'accept'],

  // shell
  [{action:'shell'},                                              'reject'],
  [{action:'shell',cmd:''},                                       'reject'],
  [{action:'shell',cmd:'ls'},                                     'accept'],

  // git_status has no extra fields to check
  [{action:'git_status'},                                         'accept'],
];

let pass = 0;
for (const [a, want] of cases) {
  const r = validate(a);
  const got = r ? 'reject' : 'accept';
  const ok = got === want;
  pass += ok ? 1 : 0;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${want.padEnd(6)} ${JSON.stringify(a).slice(0,52).padEnd(54)} ${r || ''}`);
}

// KNOWN sanity: every action validate() special-cases must actually be known.
const usesKnown = ['answer','list','read','write','git_log','git_status','shell']
  .every(k => KNOWN.has(k));
console.log(`${usesKnown ? 'ok  ' : 'FAIL'} KNOWN contains every action validate() special-cases`);
pass += usesKnown ? 1 : 0;
const total = cases.length + 1;

console.log(`\n${pass}/${total} passed`);
