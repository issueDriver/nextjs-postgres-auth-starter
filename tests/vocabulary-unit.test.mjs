import './support/typescript-hook.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
const { coverSource } = await import('../components/books/cover-source.ts');
const { loginHref, parseReturnTo, targetPath } = await import('../lib/auth/safe-return-to.ts');
const { isValidUserId, normalizeEmail, validateAuthInput } = await import('../lib/validation/auth.ts');
const requests = await import('../lib/validation/requests.ts');
const { toCatalogItem, toWordCard, toWordDetail } = await import('../lib/words/normalize.ts');
const { pronunciationUrl } = await import('../lib/words/pronunciation.ts');

test('Youdao pronunciation encodes the headword and maps British and American accents', () => {
  for (const word of ['fetch', ' give up ', "it's", 'a&b?type=2#fragment', 'café']) {
    for (const [accent, type] of [['uk', '1'], ['us', '2']]) {
      const url = new URL(pronunciationUrl(word, accent));
      assert.equal(url.origin, 'https://dict.youdao.com');
      assert.equal(url.pathname, '/dictvoice');
      assert.deepEqual([...url.searchParams], [['audio', word.trim()], ['type', type]]);
      assert.equal(url.hash, '');
    }
  }
});

test('registration normalizes emails and respects the database and bcrypt input limits', () => {
  assert.equal(normalizeEmail('  Reader@EXAMPLE.test  '), 'reader@example.test');
  assert.deepEqual(validateAuthInput(' Reader@EXAMPLE.test ', 'password123', 'register'), {
    ok: true, data: { email: 'reader@example.test', password: 'password123' },
  });
  for (const email of ['', '   ', 'missing-at', 'two@@example.test', `${'a'.repeat(60)}@test`]) {
    assert.equal(validateAuthInput(email, 'password123', 'register').ok, false, email);
  }
  assert.equal(validateAuthInput('a'.repeat(55) + '@test.dev', 'password123', 'register').ok, true);
  assert.equal(validateAuthInput('reader@example.test', '1234567', 'register').ok, false);
  assert.equal(validateAuthInput('reader@example.test', 'a'.repeat(72), 'register').ok, true);
  assert.equal(validateAuthInput('reader@example.test', 'a'.repeat(73), 'register').ok, false);
  assert.equal(validateAuthInput('reader@example.test', '字'.repeat(24), 'register').ok, true);
  assert.equal(validateAuthInput('reader@example.test', '字'.repeat(25), 'register').ok, false);
  assert.equal(validateAuthInput(null, 'password123', 'register').ok, false);
  assert.equal(validateAuthInput('reader@example.test', { password: 'password123' }, 'register').ok, false);
});

test('login accepts existing short passwords and does not trim credential content', () => {
  assert.deepEqual(validateAuthInput(' reader@example.test ', '  old ', 'login'), {
    ok: true, data: { email: 'reader@example.test', password: '  old ' },
  });
  assert.equal(validateAuthInput('reader@example.test', 'x', 'login').ok, true);
  assert.equal(validateAuthInput('reader@example.test', '', 'login').ok, false);
});

test('session user IDs stay inside the positive PostgreSQL integer range', () => {
  for (const value of ['1', '2147483647']) assert.equal(isValidUserId(value), true);
  for (const value of [1, '', '0', '-1', '1.5', '2147483648', '1 OR 1=1', null]) {
    assert.equal(isValidUserId(value), false, String(value));
  }
});

test('request validators preserve bigint strings and bound pagination and progress versions', () => {
  assert.equal(requests.parseWordId('9007199254740993'), '9007199254740993');
  assert.equal(requests.parseWordId('9223372036854775807'), '9223372036854775807');
  for (const value of [9007199254740992, '0', '-1', '1.5', '9223372036854775808', '1; DROP TABLE words']) {
    assert.throws(() => requests.parseWordId(value), error => error.code === 'VALIDATION_FAILED');
  }
  assert.equal(requests.parseBookId('CET4_real-book'), 'CET4_real-book');
  for (const value of ['', '../other', 'a/b', 'a'.repeat(65), null]) {
    assert.throws(() => requests.parseBookId(value), error => error.code === 'VALIDATION_FAILED');
  }
  assert.deepEqual(requests.parsePagination('https://app.example.test/api/books?limit=100&cursor=valid-cursor'), { limit: 100, cursor: 'valid-cursor' });
  assert.deepEqual(requests.parsePagination('https://app.example.test/api/books'), {});
  for (const query of ['limit=0', 'limit=101', 'limit=1.5', 'limit=-1', 'limit=abc', 'cursor=', `cursor=${'a'.repeat(1025)}`]) {
    assert.throws(() => requests.parsePagination(`https://app.example.test/api/books?${query}`), error => error.code === 'VALIDATION_FAILED');
  }
  const request = { wordId: '9007199254740993', bookVersion: 1, expectedRevision: 0 };
  assert.deepEqual(requests.parseStudyWrite(request), request);
  for (const value of [null, [], { ...request, userId: 9 }, { ...request, learnedCount: 99 },
    { ...request, bookVersion: 0 }, { ...request, bookVersion: 2147483648 },
    { ...request, expectedRevision: -1 }, { ...request, expectedRevision: 0.5 }]) {
    assert.throws(() => requests.parseStudyWrite(value), error => error.code === 'VALIDATION_FAILED');
  }
});

test('write origins come from deployment configuration and never from the request Host', t => {
  const production = requests.trustedOrigins({
    NODE_ENV: 'production', APP_ORIGIN: 'https://app.example.test/some/path',
    AUTH_URL: 'https://auth.example.test', NEXTAUTH_URL: 'javascript:alert(1)', VERCEL_URL: 'preview.example.test',
  });
  assert.deepEqual([...production].sort(), ['https://app.example.test', 'https://auth.example.test', 'https://preview.example.test']);
  assert.equal(production.has('http://localhost:3001'), false);
  assert.equal(requests.trustedOrigins({ NODE_ENV: 'development' }).has('http://127.0.0.1:3001'), true);
  const originalOrigin = process.env.APP_ORIGIN;
  process.env.APP_ORIGIN = 'https://app.example.test';
  t.after(() => { if (originalOrigin === undefined) delete process.env.APP_ORIGIN; else process.env.APP_ORIGIN = originalOrigin; });
  requests.assertTrustedOrigin(new Request('https://app.example.test/api/write', { headers: { origin: 'https://app.example.test' } }));
  for (const headers of [{ host: 'attacker.example.test', origin: 'https://attacker.example.test' }, {}]) {
    assert.throws(() => requests.assertTrustedOrigin(new Request('https://app.example.test/api/write', { headers })), error => error.code === 'ORIGIN_NOT_ALLOWED');
  }
});

test('login recovery accepts complete application targets and rejects external or malformed routes', () => {
  for (const route of [
    '/learn/actual-book', '/learn/actual-book/complete', '/books/actual-book',
    '/books/actual-book/words/9007199254740993',
  ]) {
    const target = parseReturnTo(route);
    assert.ok(target);
    assert.equal(targetPath(target), route);
    assert.equal(new URL(loginHref(route), 'https://example.test').searchParams.get('returnTo'), route);
  }
  for (const route of [
    'https://example.test/books/book', '//example.test/books/book', 'javascript:alert(1)',
    '/books/../me', '/books/%2e%2e', '/books/%2Fexample', '/books/book/words/not-a-number',
    '/books/book/words/1/extra', '/learn/book/complete/extra', '/books\\example',
  ]) assert.equal(parseReturnTo(route), null, route);
});

test('covers use the supplied HTTPS source and reject unsafe or unsupported sources', () => {
  assert.equal(coverSource(' https://cdn.example.test/books/real-cover.jpg '), 'https://cdn.example.test/books/real-cover.jpg');
  for (const source of ['', null, undefined, '/covers/pretend.jpg', '//cdn.example.test/cover.jpg',
    'http://cdn.example.test/cover.jpg', 'data:image/png;base64,abc', 'javascript:alert(1)',
    'https://user:password@cdn.example.test/cover.jpg', 'not a url']) {
    assert.equal(coverSource(source), null, String(source));
  }
});

const body = {
  ukphone: '/fetʃ/', usphone: 'fɛtʃ', phone: 'unused',
  trans: [null, { pos: 'n.', tranOther: 'English only' }, { pos: 'v', tranCn: '取回', tranOther: 'go and get' }],
  sentence: { sentences: [{ sContent: ' ' }, { sContent: 'Fetch a towel.', sCn: '取一条毛巾。' }, { sContent: 'Fetch water.' }] },
  phrase: { phrases: [{ pContent: 'fetch in', pCn: '引进' }, null, { pContent: '' }] },
  realExamSentence: { sentences: [{ sContent: '...fetch the data...', sourceInfo: { level: 'CET4', year: 2020, paper: '第一套', type: '阅读' } }] },
  syno: { synos: [{ pos: 'vt.', tran: '取来', hwds: [{ w: 'bring' }, { w: '' }] }] },
  relWord: { rels: [{ pos: 'adj', words: [{ hwd: 'fetching', tran: '迷人的' }, { hwd: null }] }] },
};

function wordRow(content) {
  return { id: '9007199254740993', wordRank: 1, headWord: 'fetch', content, bookId: 'fixture-book', studyOrder: 0 };
}

test('all supported dictionary wrappers produce the same card, retaining stable bigint IDs', () => {
  const contents = [body, { wordHead: 'fetch', wordId: 'source-1', content: body }, { word: { wordHead: 'fetch', wordId: 'source-1', content: body } }];
  for (const content of contents) {
    const card = toWordCard(wordRow(content));
    assert.equal(card.id, '9007199254740993');
    assert.equal(card.phonetic, 'fetʃ');
    assert.deepEqual(card.definition, { pos: 'v.', text: '取回' });
    assert.deepEqual(card.example, { en: 'Fetch a towel.', zh: '取一条毛巾。' });
  }
});

test('details keep every valid module in source order and normalize phonetics and parts of speech', () => {
  const detail = toWordDetail(wordRow({ word: { wordHead: 'fetch', wordId: 'source-1', content: body } }));
  assert.equal(detail.sourceWordId, 'source-1');
  assert.deepEqual(detail.phonetics, { uk: 'fetʃ', us: 'fɛtʃ', general: null });
  assert.equal(detail.translations.length, 2);
  assert.equal(detail.examples.length, 2);
  assert.equal(detail.examples[1].zh, null);
  assert.deepEqual(detail.phrases, [{ en: 'fetch in', zh: '引进' }]);
  assert.deepEqual(detail.examExamples, [{ en: '...fetch the data...', source: 'CET4 / 2020 / 第一套 / 阅读' }]);
  assert.deepEqual(detail.synonyms, [{ pos: 'vt.', tran: '取来', words: ['bring'] }]);
  assert.deepEqual(detail.relatedWords, [{ pos: 'adj.', words: [{ word: 'fetching', tran: '迷人的' }] }]);
});

test('missing dictionary fields have honest fallbacks and directory reads only mark confirmed words', () => {
  const row = wordRow(null);
  assert.deepEqual(toWordCard(row).definition, { pos: null, text: '暂无释义' });
  assert.equal(toWordCard(row).phonetic, null);
  assert.equal(toWordCard(row).example, null);
  assert.equal(toCatalogItem(row, 0).isLearned, false);
  assert.equal(toCatalogItem(row, 1).isLearned, true);
  assert.deepEqual(toWordDetail(row).examples, []);
  assert.equal(toWordCard(wordRow({ trans: [{ tranOther: 'English definition' }] })).definition.text, 'English definition');
  assert.throws(() => toWordCard({ ...row, headWord: null }), /BOOK_DATA_INVALID/);
  assert.throws(() => toWordDetail({ ...row, studyOrder: null }), /BOOK_DATA_INVALID/);
  assert.throws(() => toWordDetail(wordRow([])), /BOOK_DATA_INVALID/);
});
