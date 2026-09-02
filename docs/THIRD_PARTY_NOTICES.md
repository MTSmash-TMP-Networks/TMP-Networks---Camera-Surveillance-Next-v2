# Third-Party Software Notices

TMP Networks Camera Surveillance uses open-source software. Copyright remains with the respective authors. This notice is a practical inventory and does not replace the license texts supplied by each upstream project or container image.

## Direct application dependencies

| Component | Included version | License |
|---|---:|---|
| CoreUI | 5.9.0 | MIT |
| Popper.js (`@popperjs/core`) | 2.11.8 | MIT |
| React / React DOM | 19.2.7 | MIT |
| React Router DOM | 7.18.1 | MIT |
| Redux Toolkit | 2.12.0 | MIT |
| React Redux | 9.3.0 | MIT |
| hls.js | 1.6.16 | Apache-2.0 |
| Lucide React | 1.25.0 | ISC |
| Express | 5.2.1 | MIT |
| cors | 2.8.6 | MIT |
| express-rate-limit | 8.6.0 | MIT |
| Helmet | 8.3.0 | MIT |
| jsonwebtoken | 9.0.3 | MIT |
| bcryptjs | 3.0.3 | BSD-3-Clause |
| onvif | 0.8.1 | MIT |
| Pino / pino-http | 10.3.1 / 11.0.0 | MIT |
| Zod | 4.4.3 | MIT |
| digest-fetch | 3.1.1 | ISC |

## Runtime and container components

| Component | Version/pin used by this project | Primary license or notice |
|---|---:|---|
| Node.js | 24.18.0 container image | MIT plus bundled third-party notices |
| FFmpeg | Debian Bookworm package | LGPL/GPL terms depend on the packaged build and enabled libraries |
| go2rtc | 1.19.2 | MIT |
| Nginx | 1.29.8 Alpine image | BSD-2-Clause |
| Caddy | 2.11.4 Alpine image | Apache-2.0 |
| Docker CLI image | 27-cli | Apache-2.0 plus image package notices |
| SQLite | distribution package | Public domain |
| nmap | Debian package | Nmap Public Source License / bundled notices |

The project references those container images and distribution packages; it does not relicense them. When redistributing prebuilt images, preserve the notices and source-offer obligations applicable to the exact binaries you distribute.

## Development dependencies

Build and test tooling includes Vite, Vitest, ESLint, Supertest and their transitive dependencies. Their license metadata is recorded in `frontend/package-lock.json` and `backend/package-lock.json`.

## Trademarks and compatibility

ONVIF, Synology, Hikvision and other third-party names are used only for factual compatibility descriptions. All trademarks belong to their respective owners. No affiliation, sponsorship or certification is implied.

## Source and license texts

For every customer release, keep the package lock files unchanged and retain this notice. Where an upstream license requires reproduction of the complete license text, include it in the binary or container distribution created for customers. The CoreUI and Popper MIT license texts used by this release are retained under `docs/third-party/` in the source package. The normal source package builds the referenced upstream components from public package repositories and container registries.
