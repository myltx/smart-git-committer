import { describe, expect, it } from 'vitest';

import { filterFilesByGlobs } from '../src/utils/glob';

describe('filterFilesByGlobs', () => {
  it('should include all files when include is empty', () => {
    const result = filterFilesByGlobs(
      ['src/extension.ts', 'README.md', 'foo.lock'],
      [],
      ['**/*.lock']
    );

    expect(result.included).toEqual(['src/extension.ts', 'README.md']);
    expect(result.excluded).toEqual(['foo.lock']);
  });

  it('should apply include patterns first', () => {
    const result = filterFilesByGlobs(
      ['src/extension.ts', 'src/services/ai.ts', 'README.md', 'test/a.test.ts'],
      ['src/**'],
      []
    );

    expect(result.included).toEqual(['src/extension.ts', 'src/services/ai.ts']);
    expect(result.excluded).toEqual(['README.md', 'test/a.test.ts']);
  });

  it('should normalize windows path separator', () => {
    const result = filterFilesByGlobs(['src\\services\\ai.ts', 'dist\\index.js'], ['src/**'], ['dist/**']);
    expect(result.included).toEqual(['src/services/ai.ts']);
    expect(result.excluded).toEqual(['dist/index.js']);
  });
});
