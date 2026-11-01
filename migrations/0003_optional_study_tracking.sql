-- Reserved tracking structures. Existing learning progress remains authoritative.
CREATE TABLE public.study_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id integer NOT NULL,
  book_id text NOT NULL,
  book_version integer NOT NULL,
  status text NOT NULL DEFAULT 'active',
  learned_count integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT study_sessions_pkey PRIMARY KEY (id),
  CONSTRAINT study_sessions_owner_unique UNIQUE (id, user_id, book_id, book_version),
  CONSTRAINT study_sessions_user_fk
    FOREIGN KEY (user_id) REFERENCES public."User" (id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT study_sessions_book_fk
    FOREIGN KEY (book_id) REFERENCES public.books ("bookId")
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT study_sessions_version_positive CHECK (book_version >= 1),
  CONSTRAINT study_sessions_status_check
    CHECK (status IN ('active', 'completed', 'abandoned')),
  CONSTRAINT study_sessions_count_nonnegative CHECK (learned_count >= 0),
  CONSTRAINT study_sessions_end_consistent CHECK (
    (status = 'active' AND ended_at IS NULL)
    OR (status <> 'active' AND ended_at IS NOT NULL AND ended_at >= started_at)
  )
);

CREATE INDEX study_sessions_user_started_idx
  ON public.study_sessions (user_id, started_at DESC, id);

CREATE TABLE public.user_word_progress (
  user_id integer NOT NULL,
  book_id text NOT NULL,
  word_id bigint NOT NULL,
  book_version integer NOT NULL,
  status text NOT NULL DEFAULT 'new',
  study_count integer NOT NULL DEFAULT 0,
  first_studied_at timestamptz NULL,
  last_studied_at timestamptz NULL,
  learned_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_word_progress_pkey PRIMARY KEY (user_id, book_id, word_id),
  CONSTRAINT user_word_progress_user_fk
    FOREIGN KEY (user_id) REFERENCES public."User" (id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT user_word_progress_book_fk
    FOREIGN KEY (book_id) REFERENCES public.books ("bookId")
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT user_word_progress_word_fk
    FOREIGN KEY (book_id, word_id) REFERENCES public.words ("bookId", id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT user_word_progress_version_positive CHECK (book_version >= 1),
  CONSTRAINT user_word_progress_status_check
    CHECK (status IN ('new', 'learning', 'learned')),
  CONSTRAINT user_word_progress_count_nonnegative CHECK (study_count >= 0),
  CONSTRAINT user_word_progress_times_consistent CHECK (
    (first_studied_at IS NULL AND last_studied_at IS NULL)
    OR (first_studied_at IS NOT NULL AND last_studied_at IS NOT NULL
      AND last_studied_at >= first_studied_at)
  ),
  CONSTRAINT user_word_progress_learned_consistent CHECK (
    (status = 'learned' AND learned_at IS NOT NULL AND first_studied_at IS NOT NULL
      AND last_studied_at IS NOT NULL
      AND learned_at BETWEEN first_studied_at AND last_studied_at)
    OR (status <> 'learned' AND learned_at IS NULL)
  )
);

CREATE INDEX user_word_progress_word_idx
  ON public.user_word_progress (book_id, word_id);

CREATE TABLE public.study_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id integer NOT NULL,
  book_id text NOT NULL,
  book_version integer NOT NULL,
  session_id uuid NULL,
  word_id bigint NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT study_events_pkey PRIMARY KEY (id),
  CONSTRAINT study_events_user_fk
    FOREIGN KEY (user_id) REFERENCES public."User" (id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT study_events_book_fk
    FOREIGN KEY (book_id) REFERENCES public.books ("bookId")
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT study_events_word_fk
    FOREIGN KEY (book_id, word_id) REFERENCES public.words ("bookId", id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT study_events_session_fk
    FOREIGN KEY (session_id, user_id, book_id, book_version)
    REFERENCES public.study_sessions (id, user_id, book_id, book_version)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT study_events_version_positive CHECK (book_version >= 1),
  CONSTRAINT study_events_type_nonempty CHECK (btrim(event_type) <> ''),
  CONSTRAINT study_events_payload_object CHECK (jsonb_typeof(payload) = 'object')
);

CREATE INDEX study_events_user_occurred_idx
  ON public.study_events (user_id, occurred_at DESC, id);
CREATE INDEX study_events_session_occurred_idx
  ON public.study_events (session_id, occurred_at, id)
  WHERE session_id IS NOT NULL;
CREATE INDEX study_events_word_idx ON public.study_events (book_id, word_id);

COMMENT ON TABLE public.study_sessions IS
  'Reserved for learning visits, not authentication sessions; currently not written by the application.';
COMMENT ON TABLE public.user_word_progress IS
  'Reserved per-word state; user_book_progress remains the current learning cursor.';
COMMENT ON TABLE public.study_events IS
  'Reserved learning event log; deleting a session also deletes its associated events.';

REVOKE ALL PRIVILEGES ON TABLE
  public.study_sessions, public.user_word_progress, public.study_events FROM PUBLIC;

DO $permissions$
DECLARE exposed_role text;
BEGIN
  FOR exposed_role IN
    SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')
  LOOP
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON TABLE public.study_sessions, public.user_word_progress, public.study_events FROM %I',
      exposed_role
    );
  END LOOP;
END
$permissions$;
