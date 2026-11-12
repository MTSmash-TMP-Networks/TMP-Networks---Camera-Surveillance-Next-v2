# TMP Camera Surveillance Next 2.20.39 - Intel N97 VAAPI acceleration

- New opt-in Intel VAAPI hardware encoding for go2rtc H.264 stream normalization.
- Safe, non-privileged /dev/dri/renderD128 mapping and preflight hardware encode test.
- Video startup retries CPU mode on VAAPI startup failure; other hosts remain unchanged.
- Intel GPU utilization and shared RAM are reported separately from acceleration settings.
- Server update 2.20.38 -> 2.20.39 is compatible. Run `sudo sh ./scripts/intel-vaapi.sh --check`, then `--enable`, and recreate only mediamtx/backend if the test succeeds. This briefly interrupts active streams.
