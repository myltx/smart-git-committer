import simpleGit, { type SimpleGit } from 'simple-git';

export interface RecentCommit {
  hash: string;
  message: string;
  date: string;
  authorName: string;
}

export class GitService {
  private readonly git: SimpleGit;

  constructor(baseDir: string) {
    this.git = simpleGit({ baseDir, binary: 'git' });
  }

  async isRepo(): Promise<boolean> {
    return this.git.checkIsRepo();
  }

  async getStagedDiff(): Promise<string> {
    return this.git.diff(['--staged', '--']);
  }

  async getWorkingTreeDiff(): Promise<string> {
    return this.git.diff(['--']);
  }

  async getWorkingTreeChangedFiles(includeUntracked: boolean): Promise<string[]> {
    const status = await this.git.status();
    const renamedTargets = status.renamed
      .map((item) => item.to || item.from)
      .filter((item) => item && item.trim().length > 0);

    const candidates = [...status.modified, ...status.deleted, ...status.created, ...renamedTargets];
    if (includeUntracked) {
      candidates.push(...status.not_added);
    }

    return [...new Set(candidates.map((item) => item.trim()).filter((item) => item.length > 0))];
  }

  async stageFiles(files: string[]): Promise<void> {
    if (files.length === 0) {
      return;
    }
    await this.git.add(files);
  }

  async getRecentCommits(count: number): Promise<RecentCommit[]> {
    try {
      const log = await this.git.log({ maxCount: count });
      return log.all.map((item) => ({
        hash: item.hash,
        message: item.message,
        date: item.date,
        authorName: item.author_name
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message.includes('does not have any commits yet')) {
        return [];
      }
      throw error;
    }
  }

  async commit(message: string): Promise<string> {
    const result = await this.git.commit(message);
    return result.commit ?? '';
  }
}
