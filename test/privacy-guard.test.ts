import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = join(fileURLToPath(import.meta.url), '..', '..', 'src');

function allTsFiles(dir: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      result.push(...allTsFiles(full));
    } else if (entry.endsWith('.ts')) {
      result.push(full);
    }
  }
  return result;
}

function readAll(files: string[]): string {
  return files.map((f) => readFileSync(f, 'utf8')).join('\n');
}

describe('privacy guard — src/ must not contain forbidden patterns', () => {
  const files = allTsFiles(srcDir);
  const combined = readAll(files);

  it('no transcript ingestion paths', () => {
    expect(combined).not.toContain('~/.claude/projects');
    expect(combined.toLowerCase()).not.toMatch(/\btranscript\b/);
  });

  it('no network calls', () => {
    expect(combined).not.toContain('fetch(');
    expect(combined).not.toContain('https.request');
    expect(combined).not.toContain('http.request');
  });

  it('no AI SDK imports', () => {
    expect(combined).not.toContain('@anthropic-ai');
    expect(combined).not.toContain('openai');
  });
});
