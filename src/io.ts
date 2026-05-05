import { writeFile, rename } from 'node:fs/promises';

export async function atomicWrite(filePath: string, content: string): Promise<void> {
  const tmp = `${filePath}.tmp`;
  await writeFile(tmp, content, 'utf8');
  await rename(tmp, filePath);
}
