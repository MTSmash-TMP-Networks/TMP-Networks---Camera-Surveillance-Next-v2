#!/usr/bin/env python3
"""Safely extract a local TMP Device Pack source archive.

Only standard tar-compatible archives are processed. The tool does not download
third-party content and does not include or invoke vendor-specific extractors.
Nested tar-compatible payload archives are unpacked recursively.
"""

from __future__ import annotations

import argparse
import inspect
from pathlib import Path, PurePosixPath
import shutil
import tarfile

ARCHIVE_SUFFIXES = ('.tar', '.tgz', '.tar.gz', '.tar.bz2', '.tar.xz', '.spk')


def safe_members(archive: tarfile.TarFile, destination: Path):
    root = destination.resolve()
    for member in archive.getmembers():
        name = PurePosixPath(member.name)
        if name.is_absolute() or '..' in name.parts:
            raise RuntimeError(f'Unsafe archive path: {member.name}')
        target = (destination / Path(*name.parts)).resolve()
        if target != root and root not in target.parents:
            raise RuntimeError(f'Archive path leaves destination: {member.name}')
        if member.issym() or member.islnk():
            link = PurePosixPath(member.linkname)
            if link.is_absolute() or '..' in link.parts:
                raise RuntimeError(f'Unsafe archive link target: {member.linkname}')
        yield member


def extract_tar(source: Path, destination: Path) -> bool:
    try:
        with tarfile.open(source, mode='r:*') as archive:
            destination.mkdir(parents=True, exist_ok=True)
            kwargs = {'filter': 'fully_trusted'} if 'filter' in inspect.signature(archive.extractall).parameters else {}
            archive.extractall(destination, members=safe_members(archive, destination), **kwargs)
        return True
    except (tarfile.ReadError, EOFError):
        return False


def archive_name(path: Path) -> bool:
    lower = path.name.lower()
    return lower.endswith(ARCHIVE_SUFFIXES) or lower in {'package', 'package.tgz', 'package.tar'}


def unpack_nested(root: Path, max_depth: int = 4) -> list[Path]:
    extracted = []
    seen = set()
    for _ in range(max_depth):
        changed = False
        for archive in sorted(path for path in root.rglob('*') if path.is_file() and archive_name(path)):
            marker = (archive.resolve(), archive.stat().st_size, archive.stat().st_mtime_ns)
            if marker in seen:
                continue
            seen.add(marker)
            target = archive.with_name(f'{archive.name}.extracted')
            if target.exists() and any(target.iterdir()):
                continue
            if extract_tar(archive, target):
                extracted.append(target)
                changed = True
        if not changed:
            break
    return extracted


def main() -> int:
    parser = argparse.ArgumentParser(description='Extract a local TMP Device Pack source archive')
    parser.add_argument('package', type=Path, help='Path to a tar-compatible source package')
    parser.add_argument('output', type=Path, help='Extraction destination directory')
    parser.add_argument('--clean', action='store_true', help='Remove the destination directory before extraction')
    args = parser.parse_args()

    source = args.package.expanduser().resolve()
    output = args.output.expanduser().resolve()
    if not source.is_file():
        parser.error(f'Package not found: {source}')
    if args.clean and output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True, exist_ok=True)

    if not extract_tar(source, output):
        parser.error('The source package is not a supported tar-compatible archive.')

    nested = unpack_nested(output)
    files = sum(1 for item in output.rglob('*') if item.is_file())
    print(f'Extraction completed: {output}')
    print(f'Files: {files}; additional nested archives: {len(nested)}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
