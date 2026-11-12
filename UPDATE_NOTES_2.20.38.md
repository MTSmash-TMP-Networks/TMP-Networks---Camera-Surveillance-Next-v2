# TMP Camera Surveillance Next 2.20.38 – Desktop client Electron installation

- Modern npm versions can block third-party postinstall scripts. The Linux client now uses the package-scoped allowScripts policy pinned to `electron@35.7.5`, without enabling scripts globally.
- If an earlier installation skipped the Electron runtime download, `install-linux.sh` retries the single approved Electron rebuild.
- The installer checks both the Electron native executable and installation marker plus the expected package version before reporting successful installation.
- Node.js 24 LTS local installation, desktop sandbox, TLS checks and server configuration remain unchanged.

## Upgrade

From installed server 2.20.37: use the ZIP Update-Center or GitHub update. Download the refreshed Linux client from the Desktop-Client page, unpack and run `sh ./install-linux.sh` as the normal desktop user.
