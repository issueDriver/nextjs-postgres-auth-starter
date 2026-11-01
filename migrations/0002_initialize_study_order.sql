-- One-time initialization, not a command for rebuilding published books.
-- Table locks also block importers that do not yet follow the book-row protocol.
LOCK TABLE public.books, public.words, public.user_book_progress
  IN SHARE ROW EXCLUSIVE MODE;

DO $migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.user_book_progress) THEN
    RAISE EXCEPTION
      'Study order initialization refused: learning progress already exists. Use an explicit version migration instead.'
      USING ERRCODE = '23514';
  END IF;
END
$migration$;

-- Clear positions first so the unique index cannot reject position swaps.
UPDATE public.words SET "studyOrder" = NULL WHERE "studyOrder" IS NOT NULL;

WITH eligible AS (
  SELECT w.id,
    (row_number() OVER (
      PARTITION BY w."bookId"
      ORDER BY w."wordRank" ASC NULLS LAST, w.id ASC
    ) - 1)::integer AS study_order
  FROM public.words AS w
  JOIN public.books AS b ON b."bookId" = w."bookId"
  WHERE coalesce(
    nullif(btrim(w."headWord"), ''),
    CASE
      WHEN jsonb_typeof(w.content::jsonb #> '{word,wordHead}') = 'string'
      THEN nullif(btrim(w.content::jsonb #>> '{word,wordHead}'), '')
    END,
    CASE
      WHEN jsonb_typeof(w.content::jsonb -> 'wordHead') = 'string'
      THEN nullif(btrim(w.content::jsonb ->> 'wordHead'), '')
    END
  ) IS NOT NULL
)
UPDATE public.words AS w SET "studyOrder" = e.study_order
FROM eligible AS e WHERE w.id = e.id;

UPDATE public.books AS b
SET "wordCount" = (
    SELECT count(*)::integer FROM public.words AS w
    WHERE w."bookId" = b."bookId" AND w."studyOrder" IS NOT NULL
  ),
  "updatedAt" = now();

DO $migration$
DECLARE
  invalid_books bigint;
BEGIN
  SELECT count(*) INTO invalid_books
  FROM public.books AS b
  LEFT JOIN (
    SELECT "bookId", count(*) AS word_count,
      min("studyOrder") AS first_order, max("studyOrder") AS last_order
    FROM public.words
    WHERE "studyOrder" IS NOT NULL
    GROUP BY "bookId"
  ) AS sequence ON sequence."bookId" = b."bookId"
  WHERE b."wordCount" <> coalesce(sequence.word_count, 0)
     OR (b."wordCount" > 0 AND (
       sequence.first_order <> 0 OR sequence.last_order <> b."wordCount" - 1
     ));

  IF invalid_books > 0 THEN
    RAISE EXCEPTION
      'Study sequence verification failed for % books. The initialization transaction must be rolled back.',
      invalid_books USING ERRCODE = '23514';
  END IF;
END
$migration$;
