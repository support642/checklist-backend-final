CREATE TABLE public.chatbot_report_confirmations (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    token_hash varchar(64) NOT NULL UNIQUE,
    username text NOT NULL,
    work_details text NOT NULL,
    report_status text NOT NULL,
    duration text NOT NULL,
    status text DEFAULT 'pending' NOT NULL,
    expires_at timestamptz NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    consumed_at timestamptz,
    report_id bigint UNIQUE,

    CONSTRAINT chatbot_confirmation_expiry_check
        CHECK (expires_at > created_at),

    CONSTRAINT chatbot_confirmation_state_check
        CHECK (
            (status = 'pending' AND consumed_at IS NULL AND report_id IS NULL)
            OR
            (status = 'consumed' AND consumed_at IS NOT NULL AND report_id IS NOT NULL)
        ),

    CONSTRAINT chatbot_report_confirmations_duration_check
        CHECK (length(trim(duration)) > 0),

    CONSTRAINT chatbot_report_confirmations_report_status_check
        CHECK (report_status IN ('Completed', 'In Progress', 'Pending')),

    CONSTRAINT chatbot_report_confirmations_status_check
        CHECK (status IN ('pending', 'consumed')),

    CONSTRAINT chatbot_report_confirmations_token_hash_check
        CHECK (token_hash ~ '^[a-f0-9]{64}$'),

    CONSTRAINT chatbot_report_confirmations_work_details_check
        CHECK (length(trim(work_details)) > 0),

    CONSTRAINT chatbot_report_confirmations_report_id_fkey
        FOREIGN KEY (report_id)
        REFERENCES public.working_date_history(id)
        ON DELETE RESTRICT,

    CONSTRAINT chatbot_report_confirmations_username_fkey
        FOREIGN KEY (username)
        REFERENCES public.users(user_name)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
);

CREATE INDEX idx_chatbot_confirmations_pending_expiry
    ON public.chatbot_report_confirmations(expires_at)
    WHERE status = 'pending';

CREATE INDEX idx_chatbot_confirmations_username
    ON public.chatbot_report_confirmations(username, created_at DESC);
