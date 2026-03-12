function normalizePath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\/+/, '');
  return normalized.replace(/^\/+/, '');
}

function escapeRegexChar(char: string): string {
  return /[\\^$+?.()|[\]{}]/.test(char) ? `\\${char}` : char;
}

function globToRegex(glob: string): RegExp {
  const pattern = normalizePath(glob.trim());
  let regex = '^';

  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];

    if (char === '*') {
      const next = pattern[i + 1];
      if (next === '*') {
        i += 1;
        if (pattern[i + 1] === '/') {
          i += 1;
          regex += '(?:.*\\/)?';
        } else {
          regex += '.*';
        }
      } else {
        regex += '[^/]*';
      }
      continue;
    }

    if (char === '?') {
      regex += '[^/]';
      continue;
    }

    regex += escapeRegexChar(char);
  }

  regex += '$';
  return new RegExp(regex);
}

function matchesAny(path: string, patterns: string[]): boolean {
  const normalizedPath = normalizePath(path);
  for (const pattern of patterns) {
    if (!pattern.trim()) {
      continue;
    }
    const regex = globToRegex(pattern);
    if (regex.test(normalizedPath)) {
      return true;
    }
  }
  return false;
}

export function filterFilesByGlobs(
  files: string[],
  includeGlobs: string[],
  excludeGlobs: string[]
): { included: string[]; excluded: string[] } {
  const included: string[] = [];
  const excluded: string[] = [];
  const includes = includeGlobs.map((item) => item.trim()).filter((item) => item.length > 0);
  const excludes = excludeGlobs.map((item) => item.trim()).filter((item) => item.length > 0);

  for (const rawPath of files) {
    const filePath = normalizePath(rawPath);
    if (!filePath) {
      continue;
    }

    const hitInclude = includes.length === 0 || matchesAny(filePath, includes);
    const hitExclude = excludes.length > 0 && matchesAny(filePath, excludes);
    if (hitInclude && !hitExclude) {
      included.push(filePath);
    } else {
      excluded.push(filePath);
    }
  }

  return { included, excluded };
}
