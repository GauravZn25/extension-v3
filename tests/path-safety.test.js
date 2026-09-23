// Pulls safeDownloadPath out of the real background.js and throws hostile
// inputs at it, validating the output against an independently-written
// restatement of Chrome's own rules.
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'background.js'), 'utf8');

const start = src.indexOf('const WINDOWS_RESERVED_NAMES');
const end = src.indexOf('function getExtFromUrl');
if (start < 0 || end < 0) { console.error('could not locate the sanitizer block'); process.exit(1); }
eval(src.slice(start, end));

const ILLEGAL = /[<>:"\\|?*]/;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

function invalidReason(p) {
  if (typeof p !== 'string' || p.length === 0) return 'empty path';
  if (p.length > 200) return 'too long (' + p.length + ')';
  if (p[0] === '/' || p[0] === '\\') return 'leading separator';
  if (/^[A-Za-z]:/.test(p)) return 'absolute path';
  if (/[\u0000-\u001f\u007f]/.test(p)) return 'control character';
  const parts = p.split('/');
  for (const c of parts) {
    if (!c) return 'empty component';
    if (c === '.' || c === '..') return 'traversal component';
    if (ILLEGAL.test(c)) return 'illegal char in "' + c + '"';
    if (/[. ]$/.test(c)) return 'component ends with dot/space: "' + c + '"';
    if (/^[. ]/.test(c)) return 'component starts with dot/space: "' + c + '"';
    if (RESERVED.test(c)) return 'windows reserved name "' + c + '"';
  }
  return null;
}

const cases = [
  ['normal',              'reddit_downloads', 'My Cool Post',   'image_1',       'jpg'],
  ['EMPTY title',         'reddit_downloads', '',               '',              'jpg'],
  ['only illegal chars',  'reddit_downloads', '<<<>>>',         '???',           'jpg'],
  ['only whitespace',     'reddit_downloads', '   ',            '  ',            'jpg'],
  ['only dots',           'reddit_downloads', '...',            '..',            'jpg'],
  ['trailing dot',        'reddit_downloads', 'Post.',          'file.',         'jpg'],
  ['trailing space',      'reddit_downloads', 'Post ',          'file ',         'jpg'],
  ['reserved CON',        'reddit_downloads', 'CON',            'NUL',           'jpg'],
  ['reserved com1.txt',   'reddit_downloads', 'com1.txt',       'LPT9',          'jpg'],
  ['traversal',           '../../etc',        '..',             '../evil',       'jpg'],
  ['leading slash',       '/abs/path',        'Post',           'file',          'jpg'],
  ['windows absolute',    'C:\\Users\\x',     'Post',           'file',          'jpg'],
  ['double slashes',      'a//b',             '',               'file',          'jpg'],
  ['control chars',       'reddit_downloads', 'Po\u0001st\u001f', 'fi\u0000le',  'jpg'],
  ['unicode title',       'reddit_downloads', 'C\u00e0 Ph\u00ea Mu\u1ed1i', 'anh_1', 'jpg'],
  ['emoji title',         'reddit_downloads', '\u{1F389}\u{1F389}', '\u{1F680}', 'png'],
  ['arabic RTL',          'reddit_downloads', '\u0645\u0631\u062d\u0628\u0627', '\u0635\u0648\u0631\u0629', 'jpg'],
  ['very long title',     'reddit_downloads', 'x'.repeat(400),  'y'.repeat(400), 'jpeg'],
  ['long folder too',     'z'.repeat(300),    'w'.repeat(300),  'v'.repeat(300), 'png'],
  ['bad extension',       'reddit_downloads', 'Post',           'file',          '../sh'],
  ['empty extension',     'reddit_downloads', 'Post',           'file',          ''],
  ['null / undefined',    'reddit_downloads', null,             undefined,       'jpg'],
  ['newlines and tabs',   'reddit_downloads', 'line1\nline2',   'a\tb',          'jpg'],
  ['quotes and pipes',    'reddit_downloads', 'He said "hi" | ok', 'a*b?c',      'jpg'],
  ['dot-only extension',  'reddit_downloads', 'Post',           'file',          '...'],
  ['everything at once',  '  ../C:\\x//  ',   '<>:"|?*',        '   ...   ',     '<>'],
];

let fails = 0;
for (const [label, base, folder, file, ext] of cases) {
  let out = null, err = null;
  try {
    out = safeDownloadPath([base, folder, file], ext);
    err = invalidReason(out);
  } catch (e) {
    err = 'THREW: ' + e.message;
  }
  if (err) fails++;
  const shown = out && out.length > 72 ? out.slice(0, 69) + '...' : out;
  console.log('  ' + (err ? 'FAIL' : 'ok  ') + ' ' + label.padEnd(20) + ' -> ' + (err ? err : JSON.stringify(shown)));
}

// Two-segment form (individual mode) and the zip path use the same function.
for (const [label, base, name, ext] of [
  ['individual mode', 'reddit_downloads', '', 'jpg'],
  ['zip mode',        'reddit_downloads', '...', 'zip'],
]) {
  const out = safeDownloadPath([base, name], ext);
  const err = invalidReason(out);
  if (err) fails++;
  console.log('  ' + (err ? 'FAIL' : 'ok  ') + ' ' + label.padEnd(20) + ' -> ' + (err ? err : JSON.stringify(out)));
}

console.log(fails ? '\n' + fails + ' FAILURE(S)' : '\nAll ' + (cases.length + 2) + ' inputs produce a path Chrome accepts.');
process.exit(fails ? 1 : 0);
