import type { BookDTO, BookId } from './books';
import type { WordCardDTO, WordId } from './words';

export interface ProgressDTO {
  bookId: BookId;
  bookVersion: number;
  totalWords: number;
  learnedCount: number;
  lastCompletedIndex: number | null;
  lastCompletedWordId: WordId | null;
  revision: number;
  isCompleted: boolean;
  progressPercent: number;
  startedAt: string;
  lastStudiedAt: string;
  completedAt: string | null;
}

export type StudySnapshot =
  | {
      state: 'learning';
      book: BookDTO;
      progress: ProgressDTO | null;
      currentWord: WordCardDTO;
    }
  | {
      state: 'completed';
      book: BookDTO;
      progress: ProgressDTO;
      currentWord: null;
    };

export interface AdvanceResult {
  state: 'learning' | 'completed';
  progress: ProgressDTO;
  nextWord: WordCardDTO | null;
}

export interface StudyWriteRequest {
  wordId: WordId;
  bookVersion: number;
  expectedRevision: number;
}

export interface ProgressSummary {
  totalLearned: number;
  learningBooks: number;
  completedBooks: number;
}

export interface BookProgressItem {
  book: BookDTO;
  progress: ProgressDTO;
}

export interface MyProgress {
  summary: ProgressSummary;
  recent: BookProgressItem | null;
  books: BookProgressItem[];
}

export interface BookProgressLookup {
  bookId: BookId;
  available: boolean;
  progress: ProgressDTO | null;
}
