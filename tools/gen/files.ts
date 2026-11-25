import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

export function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, content, 'utf8');
  renameSync(temporary, path);
}

/** 先写齐暂存文件与清单，回执最后提交；中断后由服务重放同一份清单。 */
export function commitFiles(output: string, files: Array<{ target: string; content: string }>, complete?: string) {
  const directory = join(dirname(output), '.gen-transaction', basename(output));
  const all = [...files];
  if (complete) {
    const content = files.find((file) => file.target === output)!.content;
    all.push({ target: complete, content: JSON.stringify({
      output, sha256: createHash('sha256').update(content).digest('hex'),
    }) + '\n' });
  }
  const transaction = all.map((file, index) => {
    const staged = join(directory, `${index}.next`);
    atomicWrite(staged, file.content);
    return { staged, target: file.target, sha256: createHash('sha256').update(file.content).digest('hex') };
  });
  atomicWrite(join(directory, 'commit.json'), JSON.stringify(transaction, null, 2) + '\n');
  for (const file of transaction) {
    mkdirSync(dirname(file.target), { recursive: true });
    renameSync(file.staged, file.target);
  }
  rmSync(directory, { recursive: true, force: true });
}
