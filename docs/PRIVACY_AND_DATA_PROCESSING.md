# Privacy and Data Processing Notes

TMP Networks Camera Surveillance is designed for self-hosted operation. The operator controls cameras, accounts, recording storage and network access.

## Data processed by the application

- user accounts, password hashes, roles, session metadata and audit entries;
- camera addresses, encrypted camera credentials, ONVIF profiles and health information;
- live-stream session metadata, motion events, recording schedules and video files;
- optional webhooks and integration destinations configured by the operator.

## Default data flows

Video and credentials remain inside the configured deployment by default. The application can access public compatibility metadata and operator-configured endpoints. Cloud upload is not enabled by default.

## Optional AI event analysis

AI event analysis is disabled by default. When an administrator enables it, the application selects a small number of still images from a motion or recording event and sends only those event snapshots to the configured vision provider. The continuous camera stream is not uploaded by this feature.

- OpenAI can be selected as the provider, or an administrator can configure an OpenAI-compatible HTTP(S) endpoint, including a locally operated endpoint.
- The provider API key is encrypted at rest with the same server-side credential vault used for protected camera and notification secrets. The plaintext key is not returned to the browser after saving.
- AI results are stored as event/recording metadata and can be included in email notifications when the operator enables that option.
- The product prompt explicitly forbids facial identification and instructs the model to describe only visible activity without guessing identity, protected traits, health, intent or criminality. This is descriptive event analysis, not biometric identification.
- Provider terms, retention, regional processing, data-processing agreements and any additional legal requirements remain the responsibility of the operator. For cloud providers, review the provider's current API privacy and data-retention settings before enabling this feature.
- If the optional relevance filter is enabled, an email is suppressed only after a successful AI analysis explicitly marks the event as not notification-worthy. Provider failures do not silently suppress the normal motion alert.

## Operator responsibilities

The operator is responsible for legal basis, transparency notices, access control, retention, deletion, backups, processor agreements, network security and responses to data-subject requests. The software is a technical tool and is not a substitute for legal or data-protection advice.



## Standalone licensing

The application performs no license activation and sends no licensing identifier or installation fingerprint to TMP-SYSTEM-SERVICE GmbH.
