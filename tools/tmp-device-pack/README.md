# TMP Device Pack Import Tool

This optional maintenance tool can build an additional camera-path catalog from a locally supplied source archive or an already extracted source directory.

The distribution package does not download, redistribute or bundle third-party device packs. It also does not include or invoke vendor-specific extraction software. The operator is responsible for obtaining source material legally and complying with its license and trademark terms.

## Usage with an extracted directory

```bash
./tools/tmp-device-pack/update_device_pack.sh /path/to/extracted-device-pack [source-version]
```

## Usage with a tar-compatible archive

```bash
./tools/tmp-device-pack/update_device_pack.sh /path/to/device-pack.spk [source-version]
```

The generated catalog is written to:

```text
backend/src/data/tmp-device-pack-catalog.json
```

Restart or rebuild the backend after generating a new catalog.

The main application works without this optional import tool. The bundled TMP Device Pack catalog is empty by default.
