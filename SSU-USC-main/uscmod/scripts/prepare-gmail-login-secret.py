#!/usr/bin/env python3
"""Prepare a private local env file; never configure Supabase or print its value."""
import argparse
import os
import secrets
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, help='New private file outside the repository.')
    args = parser.parse_args()
    repository = next((parent for parent in Path(__file__).resolve().parents if (parent / '.git').exists()), Path(__file__).resolve().parents[1])
    if Path(args.output).resolve().is_relative_to(repository):
        parser.error('Choose a private output file outside the repository.')
    # O_EXCL refuses overwrites and symlinks; a pre-existing stable key is never rotated.
    fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w', encoding='ascii') as output:
        output.write('GMAIL_LOGIN_RATE_LIMIT_SECRET=' + secrets.token_hex(32) + '\n')
    print('Created private local secret file. Value not displayed; nothing uploaded.')


if __name__ == '__main__':
    main()
