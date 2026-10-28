/**
 * Lints the skills: `bun run lint:skills`.
 *
 * - Frontmatter: `name` equals the folder, is lowercase kebab-case, at most 64 characters;
 *   `description` is present, 100 to 1024 characters, and says when to use the skill.
 * - SKILL.md stays under 500 lines; detail lives in `references/`.
 * - Every relative link resolves, and every file in `references/` is linked from SKILL.md.
 * - Every skill is listed in `.claude-plugin/marketplace.json`, and the README table.
 * - The docs base URL is written in one place only (`skills/ferrysync/references/docs-map.md`).
 * - No emoji, no em dash.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const skillsDir = join(root, 'skills');
const errors: string[] = [];
const fail = (where: string, message: string) => errors.push(`${where}: ${message}`);

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

const frontmatter = (text: string): Record<string, string> | null => {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (match === null) return null;
  const fields: Record<string, string> = {};
  for (const line of (match[1] ?? '').split('\n')) {
    const pair = /^([a-z-]+):\s*(.*)$/.exec(line);
    if (pair !== null) fields[pair[1] ?? ''] = (pair[2] ?? '').replace(/^"([\s\S]*)"$/, '$1');
  }
  return fields;
};

const folders = readdirSync(skillsDir).filter((name) => statSync(join(skillsDir, name)).isDirectory());
const marketplace = JSON.parse(readFileSync(join(root, '.claude-plugin/marketplace.json'), 'utf8'));
const listed: string[] = marketplace.plugins.flatMap((plugin: { skills: string[] }) => plugin.skills);
const readme = readFileSync(join(root, 'README.md'), 'utf8');

for (const folder of folders) {
  const dir = join(skillsDir, folder);
  const skillFile = join(dir, 'SKILL.md');
  const where = relative(root, skillFile);
  if (!existsSync(skillFile)) {
    fail(where, 'missing');
    continue;
  }
  const text = readFileSync(skillFile, 'utf8');
  const fields = frontmatter(text);
  if (fields === null) {
    fail(where, 'no frontmatter');
    continue;
  }
  if (fields.name !== folder) fail(where, `name "${fields.name}" must equal the folder "${folder}"`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(fields.name ?? '') || (fields.name ?? '').length > 64)
    fail(where, 'name must be lowercase kebab-case, at most 64 characters');
  const description = fields.description ?? '';
  if (description.length < 100 || description.length > 1024)
    fail(where, `description is ${description.length} characters: keep it 100 to 1024`);
  if (!/\bUse when\b/.test(description)) fail(where, 'description must say "Use when ..."');
  if (text.split('\n').length > 500) fail(where, 'SKILL.md is over 500 lines: move detail to references/');
  if (!listed.includes(`./skills/${folder}`)) fail(where, 'not listed in .claude-plugin/marketplace.json');
  if (!readme.includes(`\`${folder}\``)) fail(where, 'not in the README table');

  const linked = new Set<string>();
  for (const file of walk(dir).filter((path) => path.endsWith('.md'))) {
    const body = readFileSync(file, 'utf8');
    for (const match of body.matchAll(/\]\(([^)#\s]+)(#[^)]*)?\)/g)) {
      const target = match[1] ?? '';
      if (/^[a-z]+:/.test(target)) continue;
      const resolved = join(dirname(file), target);
      if (!existsSync(resolved)) fail(relative(root, file), `broken link ${target}`);
      else linked.add(resolved);
    }
  }
  for (const file of walk(join(dir, 'references')).filter((path) => path.endsWith('.md'))) {
    if (!linked.has(file)) fail(relative(root, file), 'not linked from any file of its skill');
  }
}
for (const entry of listed) {
  if (!existsSync(join(root, entry, 'SKILL.md'))) fail('marketplace.json', `${entry} has no SKILL.md`);
}

const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{FE0F}]/u;
const docsMap = join(skillsDir, 'ferrysync/references/docs-map.md');
for (const file of [...walk(skillsDir), ...walk(join(root, 'evals'))].filter((p) => p.endsWith('.md'))) {
  const body = readFileSync(file, 'utf8');
  const where = relative(root, file);
  if (emoji.test(body)) fail(where, 'contains an emoji');
  if (body.includes('—')) fail(where, 'contains an em dash');
  if (file !== docsMap && /DOCS_BASE_URL/.test(body)) fail(where, 'the docs base URL belongs in docs-map.md only');
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  console.error(`\n${errors.length} problem(s) in the skills`);
  process.exit(1);
}
console.log(`Linted ${folders.length} skills`);
