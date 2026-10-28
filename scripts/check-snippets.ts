/**
 * Type-checks every `ts` and `tsx` block of the skills against the Ferry packages, as an app would
 * compile it: `bun run check:snippets`.
 *
 * Where Ferry lives: `FERRY_REPO` (default `../ferrysync`, a sibling checkout). The check never
 * writes there. Each block becomes a module in memory, placed under Ferry's `docs/` folder so it
 * resolves `ferrysync`, `zod`, `react`, `hono`... exactly as Ferry's own docs check does, with
 * Ferry's `docs/tsconfig.json`. The support files in `scripts/support` (a schema, a client, a
 * server) are what a block reaches with `./schema`, `./sync` and `./sync-server`.
 *
 * A block opts out with `no-check` in its info string (for example ```ts no-check) and must say
 * why in the text around it.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const ferry = resolve(root, process.env.FERRY_REPO ?? '../ferrysync');
const typescriptPath = join(ferry, 'node_modules/typescript/lib/typescript.js');
if (!existsSync(typescriptPath) || !existsSync(join(ferry, 'docs/tsconfig.json'))) {
  console.error(
    `Ferry not found at ${ferry} (needs node_modules installed). Set FERRY_REPO to a checkout of AgustinOberg/ferrysync.`,
  );
  process.exit(2);
}
// Typed loosely on purpose: the compiler is Ferry's, and this script has no dependencies.
const ts = createRequire(import.meta.url)(typescriptPath);

const virtualDir = join(ferry, 'docs/.skills-check');
const support = join(root, 'scripts/support');

type Block = { file: string; line: number; lang: string; text: string; skip: boolean };

const markdownIn = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return markdownIn(path);
    return entry.name.endsWith('.md') ? [path] : [];
  });

const blocksOf = (path: string): Block[] => {
  const lines = readFileSync(path, 'utf8').split('\n');
  const blocks: Block[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const open = /^```(ts|tsx)\b(.*)$/.exec(lines[i] ?? '');
    if (open === null) continue;
    const body: string[] = [];
    let j = i + 1;
    while (j < lines.length && !(lines[j] ?? '').startsWith('```')) {
      body.push(lines[j] ?? '');
      j += 1;
    }
    blocks.push({
      file: path,
      line: i + 2,
      lang: open[1] ?? 'ts',
      text: body.join('\n'),
      skip: /\bno-check\b/.test(open[2] ?? ''),
    });
    i = j;
  }
  return blocks;
};

const started = performance.now();
const errors: string[] = [];
const modules = new Map<string, { block: Block; text: string }>();

const files = [...markdownIn(join(root, 'skills')), ...markdownIn(join(root, 'evals'))].sort();
let skipped = 0;
for (const file of files) {
  for (const [index, block] of blocksOf(file).entries()) {
    if (block.skip) {
      skipped += 1;
      continue;
    }
    const name = relative(root, file).replace(/\W/g, '_');
    modules.set(join(virtualDir, `${name}_${index + 1}.${block.lang}`), { block, text: block.text });
  }
}

// Support files are virtual too, so `./schema` from a block resolves next to it.
const supportFiles = new Map<string, string>();
for (const name of readdirSync(support)) {
  if (name.endsWith('.ts')) supportFiles.set(join(virtualDir, name), readFileSync(join(support, name), 'utf8'));
}
const virtualText = (file: string): string | undefined =>
  modules.get(file)?.text ?? supportFiles.get(file);

const config = ts.getParsedCommandLineOfConfigFile(
  join(ferry, 'docs/tsconfig.json'),
  {},
  {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic: { messageText: unknown }) => {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
    },
  },
);
if (config === undefined) throw new Error('Ferry docs/tsconfig.json could not be read');

const host = ts.createCompilerHost(config.options);
const { getSourceFile, fileExists, readFile } = host;
host.getSourceFile = (file: string, language: unknown, ...rest: unknown[]) => {
  const text = virtualText(file);
  return text === undefined
    ? getSourceFile.call(host, file, language, ...rest)
    : ts.createSourceFile(file, text, language);
};
host.fileExists = (file: string) => virtualText(file) !== undefined || fileExists.call(host, file);
host.readFile = (file: string) => virtualText(file) ?? readFile.call(host, file);
// The virtual folder does not exist on disk: say it does, or module resolution never looks in it.
const { directoryExists } = host;
host.directoryExists = (dir: string) =>
  dir === virtualDir || (directoryExists?.call(host, dir) ?? false);

// Ferry's own placeholders (getSession, ...) and the optional modules it stubs, plus ours.
const ambient = [
  join(ferry, 'docs/snippets/placeholders.d.ts'),
  join(ferry, 'docs/snippets/modules.d.ts'),
  join(support, 'ambient.d.ts'),
];
const program = ts.createProgram({
  rootNames: [...modules.keys(), ...ambient],
  options: config.options,
  host,
});

for (const [file, { block }] of modules) {
  const source = program.getSourceFile(file);
  if (source === undefined) {
    errors.push(`${relative(root, block.file)}:${block.line}: block could not be compiled`);
    continue;
  }
  for (const diagnostic of [
    ...program.getSyntacticDiagnostics(source),
    ...program.getSemanticDiagnostics(source),
  ]) {
    const at = source.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
    errors.push(
      `${relative(root, block.file)}:${block.line + at.line}:${at.character + 1} TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`,
    );
  }
}

const seconds = ((performance.now() - started) / 1000).toFixed(1);
if (errors.length > 0) {
  console.error(errors.join('\n'));
  console.error(`\n${errors.length} error(s) in the skills' code blocks (${seconds} s)`);
  process.exit(1);
}
console.log(
  `Type-checked ${modules.size} code blocks (${skipped} marked no-check) against ${ferry} in ${seconds} s`,
);
