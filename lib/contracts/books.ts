export type BookId = string;

export interface BookDTO {
  bookId: BookId;
  title: string;
  wordCount: number;
  coverUrl: string;
  tags: string[];
  bookVersion: number;
}

export interface BookPage {
  books: BookDTO[];
  nextCursor: string | null;
}
