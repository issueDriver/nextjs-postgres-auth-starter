import type {
  CatalogItemDTO,
  Definition,
  ExamExample,
  Example,
  Phrase,
  RelatedWordGroup,
  SynonymGroup,
  Translation,
  WordCardDTO,
  WordDetailDTO,
} from 'lib/contracts/words';

/** 与 public.words 一致的行结构；id 为 bigint 的十进制字符串。 */
export interface WordRow {
  id: string;
  wordRank: number | null;
  headWord: string | null;
  content: unknown;
  bookId: string | null;
  studyOrder: number | null;
}

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function list(value: unknown): Obj[] {
  return Array.isArray(value) ? value.filter(isObj) : [];
}

/** 读取 `body[key][arrayKey]` 形式的模块数组，如 sentence.sentences。 */
function nested(body: Obj, key: string, arrayKey: string): Obj[] {
  const inner = body[key];
  return isObj(inner) ? list(inner[arrayKey]) : [];
}

export function normalizePos(pos: unknown): string | null {
  const value = text(pos);
  if (!value) return null;
  return `${value.replace(/\.+$/, '')}.`;
}

function phone(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const stripped = raw.replace(/^\/+|\/+$/g, '').trim();
  return stripped === '' ? null : stripped;
}

/** 识别 tech.md 6.1 中的三类包装，返回学习内容、来源 ID 与备用词头。 */
function unwrap(content: unknown): { body: Obj; sourceWordId: string | null; wordHead: string | null } {
  if (content === null || content === undefined) {
    return { body: {}, sourceWordId: null, wordHead: null };
  }
  if (!isObj(content)) throw new Error('BOOK_DATA_INVALID');

  if (isObj(content.word)) {
    const word = content.word;
    return {
      body: isObj(word.content) ? word.content : {},
      sourceWordId: text(word.wordId),
      wordHead: text(word.wordHead),
    };
  }
  if ('wordHead' in content || 'wordId' in content) {
    return {
      body: isObj(content.content) ? content.content : {},
      sourceWordId: text(content.wordId),
      wordHead: text(content.wordHead),
    };
  }
  return { body: content, sourceWordId: null, wordHead: null };
}

interface Parsed {
  row: WordRow & { bookId: string; studyOrder: number };
  headWord: string;
  sourceWordId: string | null;
  body: Obj;
}

function parse(row: WordRow): Parsed {
  if (row.bookId === null || row.studyOrder === null) throw new Error('BOOK_DATA_INVALID');
  const { body, sourceWordId, wordHead } = unwrap(row.content);
  const headWord = text(row.headWord) ?? wordHead;
  if (!headWord) throw new Error('BOOK_DATA_INVALID');
  return {
    row: row as Parsed['row'],
    headWord,
    sourceWordId,
    body,
  };
}

function translations(body: Obj): Translation[] {
  return list(body.trans)
    .map((t) => ({ pos: normalizePos(t.pos), zh: text(t.tranCn), en: text(t.tranOther) }))
    .filter((t) => t.zh || t.en);
}

function firstDefinition(items: Translation[]): Definition {
  const zh = items.find((t) => t.zh);
  if (zh) return { pos: zh.pos, text: zh.zh! };
  const en = items.find((t) => t.en);
  if (en) return { pos: en.pos, text: en.en! };
  return { pos: null, text: '暂无释义' };
}

function examples(body: Obj): Example[] {
  return nested(body, 'sentence', 'sentences')
    .map((s) => ({ en: text(s.sContent), zh: text(s.sCn) }))
    .filter((s): s is Example => s.en !== null);
}

function examExamples(body: Obj): ExamExample[] {
  return nested(body, 'realExamSentence', 'sentences')
    .map((s) => {
      const info = isObj(s.sourceInfo) ? s.sourceInfo : {};
      const parts = [info.level, info.year, info.paper, info.type]
        .map((part) => (typeof part === 'number' ? String(part) : text(part)))
        .filter((part): part is string => part !== null);
      return { en: text(s.sContent), source: parts.length > 0 ? parts.join(' / ') : null };
    })
    .filter((s): s is ExamExample => s.en !== null);
}

function phrases(body: Obj): Phrase[] {
  return nested(body, 'phrase', 'phrases')
    .map((p) => ({ en: text(p.pContent), zh: text(p.pCn) }))
    .filter((p): p is Phrase => p.en !== null);
}

function synonyms(body: Obj): SynonymGroup[] {
  return nested(body, 'syno', 'synos')
    .map((s) => ({
      pos: normalizePos(s.pos),
      tran: text(s.tran),
      words: list(s.hwds)
        .map((h) => text(h.w))
        .filter((w): w is string => w !== null),
    }))
    .filter((s) => s.words.length > 0 || s.tran);
}

function relatedWords(body: Obj): RelatedWordGroup[] {
  return nested(body, 'relWord', 'rels')
    .map((r) => ({
      pos: normalizePos(r.pos),
      words: list(r.words)
        .map((w) => ({ word: text(w.hwd), tran: text(w.tran) }))
        .filter((w): w is { word: string; tran: string | null } => w.word !== null),
    }))
    .filter((r) => r.words.length > 0);
}

export function toWordCard(row: WordRow): WordCardDTO {
  const { row: r, headWord, body } = parse(row);
  return {
    id: r.id,
    bookId: r.bookId,
    orderIndex: r.studyOrder,
    headWord,
    phonetic: phone(body.ukphone) ?? phone(body.usphone) ?? phone(body.phone),
    definition: firstDefinition(translations(body)),
    example: examples(body)[0] ?? null,
  };
}

export function toCatalogItem(row: WordRow, learnedCount: number): CatalogItemDTO {
  const { row: r, headWord, body } = parse(row);
  return {
    id: r.id,
    orderIndex: r.studyOrder,
    headWord,
    shortDefinition: firstDefinition(translations(body)),
    isLearned: r.studyOrder < learnedCount,
  };
}

export function toWordDetail(row: WordRow): WordDetailDTO {
  const { row: r, headWord, sourceWordId, body } = parse(row);
  const uk = phone(body.ukphone);
  const us = phone(body.usphone);
  return {
    id: r.id,
    bookId: r.bookId,
    orderIndex: r.studyOrder,
    headWord,
    sourceWordId,
    phonetics: { uk, us, general: uk || us ? null : phone(body.phone) },
    translations: translations(body),
    examples: examples(body),
    examExamples: examExamples(body),
    phrases: phrases(body),
    synonyms: synonyms(body),
    relatedWords: relatedWords(body),
  };
}
