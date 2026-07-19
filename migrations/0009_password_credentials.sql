-- ============================================================================
-- Migration: 0009_password_credentials
-- LOCAL_CREDENTIAL_AUTH_V1
--
-- Adds a versioned password-credential digest to the existing user identity.
-- Existing users remain locked (NULL) until an operator provisions a digest;
-- there is deliberately no shared/default password and no plaintext column.
-- ============================================================================

BEGIN;

ALTER TABLE "user"
  ADD COLUMN password_hash TEXT NULL;

ALTER TABLE "user"
  ADD CONSTRAINT ck_user_password_hash_format CHECK (
    password_hash IS NULL OR password_hash LIKE 'scrypt$1$%'
  );

COMMENT ON COLUMN "user".password_hash IS
  'Versioned scrypt digest only; NULL means password login is disabled. Never plaintext.';

COMMIT;
