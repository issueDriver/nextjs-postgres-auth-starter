import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import ts from 'typescript';

const root = new URL('../../', import.meta.url);
const libRoot = new URL('lib/', root).href;
const coverSourceUrl = new URL('components/books/cover-source.ts', root).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('lib/')) {
      return { url: new URL(`${specifier}.ts`, root).href, shortCircuit: true };
    }
    if (specifier.startsWith('.') && context.parentURL?.startsWith(libRoot) && !/\.[a-z]+$/i.test(specifier)) {
      return { url: new URL(`${specifier}.ts`, context.parentURL).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if ((url.startsWith(libRoot) && url.endsWith('.ts')) || url === coverSourceUrl) {
      const { outputText } = ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      });
      return { format: 'module', source: outputText, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
