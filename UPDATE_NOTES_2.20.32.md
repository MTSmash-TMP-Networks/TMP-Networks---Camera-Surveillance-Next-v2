# TMP Camera Surveillance Next 2.20.32

Updater recovery hotfix for interrupted update jobs.

## Changes

- Detect persisted `running` update states after the updater process/container has restarted.
- Recover interrupted build/install/preflight jobs instead of leaving the Update Center stuck at 42% or another intermediate progress value.
- Mark interrupted jobs explicitly as failed/interrupted with 100% progress and a clear diagnostic message.
- Preserve the backup ID in the recovery message so an existing backup can still be selected for a manual rollback.
- Record interrupted update transactions in update history.
- Remove the previous 60-second recovery window that could miss a stale finishing state when the updater restarted quickly.
- Preserve the v2.20.31 recording timeline and continuous playback behavior unchanged.
