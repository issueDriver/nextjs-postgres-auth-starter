import 'server-only';
import { sqlClient } from 'lib/db/client';
import { createVocabularyService } from './vocabulary-core';

export const {
  listBooks,
  getMyProgress,
  getBooksProgress,
  getCatalog,
  getWordDetail,
  getStudySnapshot,
  visitStudy,
  completeWord,
} = createVocabularyService(sqlClient);
