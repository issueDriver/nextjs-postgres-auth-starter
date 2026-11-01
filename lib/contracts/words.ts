import type { BookDTO, BookId } from './books';
import type { ProgressDTO } from './study';

/** 数据库 words.id 的十进制字符串，禁止转换成 Number。 */
export type WordId = string;

export interface Definition {
  pos: string | null;
  text: string;
}

export interface Example {
  en: string;
  zh: string | null;
}

export interface WordCardDTO {
  id: WordId;
  bookId: BookId;
  orderIndex: number;
  headWord: string;
  phonetic: string | null;
  definition: Definition;
  example: Example | null;
}

export interface Translation {
  pos: string | null;
  zh: string | null;
  en: string | null;
}

export interface ExamExample {
  en: string;
  source: string | null;
}

export interface Phrase {
  en: string;
  zh: string | null;
}

export interface SynonymGroup {
  pos: string | null;
  tran: string | null;
  words: string[];
}

export interface RelatedWordGroup {
  pos: string | null;
  words: { word: string; tran: string | null }[];
}

export interface WordDetailDTO {
  id: WordId;
  bookId: BookId;
  orderIndex: number;
  headWord: string;
  sourceWordId: string | null;
  phonetics: { uk: string | null; us: string | null; general: string | null };
  translations: Translation[];
  examples: Example[];
  examExamples: ExamExample[];
  phrases: Phrase[];
  synonyms: SynonymGroup[];
  relatedWords: RelatedWordGroup[];
}

export interface CatalogItemDTO {
  id: WordId;
  orderIndex: number;
  headWord: string;
  shortDefinition: Definition;
  isLearned: boolean;
}

export interface CatalogPage {
  book: BookDTO;
  progress: ProgressDTO | null;
  items: CatalogItemDTO[];
  nextCursor: string | null;
}

export interface WordDetailResult {
  book: BookDTO;
  word: WordDetailDTO;
}
