#!/usr/bin/env python3
"""
Combines all TypeScript files from a directory into a single file.
Skips common build/output directories.
"""

import argparse
import os
from pathlib import Path

SKIP_DIRS = {
    'node_modules',
    'dist',
    'build',
    '.next',
    'out',
    'coverage',
    '.turbo',
    '.cache',
    '__pycache__',
    '.git',
}

def find_ts_files(root_path: Path) -> list[Path]:
    """Recursively find all .ts and .tsx files, skipping build directories."""
    ts_files = []
    
    for dirpath, dirnames, filenames in os.walk(root_path):
        # Remove skip directories from dirnames to prevent descending into them
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        
        for filename in filenames:
            if filename.endswith(('.ts', '.tsx')):
                ts_files.append(Path(dirpath) / filename)
    
    return sorted(ts_files)

def combine_files(ts_files: list[Path], root_path: Path, output_path: Path):
    """Combine all TypeScript files into a single output file."""
    with open(output_path, 'w', encoding='utf-8') as out:
        for ts_file in ts_files:
            relative_path = ts_file.relative_to(root_path)
            separator = "=" * 80
            out.write(f"\n{separator}\n")
            out.write(f"// FILE: {relative_path}\n")
            out.write(f"{separator}\n\n")
            
            try:
                content = ts_file.read_text(encoding='utf-8')
                out.write(content)
                out.write("\n")
            except Exception as e:
                out.write(f"// ERROR reading file: {e}\n")

def main():
    parser = argparse.ArgumentParser(
        description='Combine all TypeScript files into a single file'
    )
    parser.add_argument(
        'path',
        nargs='?',
        default='.',
        help='Root directory to search (default: current directory)'
    )
    parser.add_argument(
        '-o', '--output',
        default='combined.ts',
        help='Output filename (default: combined.ts)'
    )
    
    args = parser.parse_args()
    root_path = Path(args.path).resolve()
    output_path = Path.cwd() / args.output
    
    if not root_path.exists():
        print(f"Error: Path '{root_path}' does not exist")
        return 1
    
    print(f"Searching for TypeScript files in: {root_path}")
    ts_files = find_ts_files(root_path)
    
    if not ts_files:
        print("No TypeScript files found")
        return 0
    
    print(f"Found {len(ts_files)} TypeScript files")
    combine_files(ts_files, root_path, output_path)
    print(f"Combined into: {output_path}")
    
    return 0

if __name__ == '__main__':
    exit(main())