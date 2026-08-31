import { describe, it, expect } from 'vitest';
import path from 'path';
import { csharpResolver } from '../../src/languageResolvers/csharp.js';
import { traceImports } from '../../src/git/importTracer.js';

const FIXTURES = path.join(import.meta.dirname, 'fixtures/csharp');
const MAIN = 'App/Program.cs';

describe('csharpResolver.extractImports', () => {
  it('extracts plain using statements', () => {
    const specs = csharpResolver.extractImports('using App.Services;\nusing System;\n', MAIN);
    expect(specs).toContain('App.Services');
    expect(specs).toContain('System');
  });

  it('does not extract using static directives', () => {
    const specs = csharpResolver.extractImports('using static System.Math;', MAIN);
    expect(specs.length).toBe(0);
  });

  it('does not extract using alias directives', () => {
    const specs = csharpResolver.extractImports('using Json = Newtonsoft.Json;', MAIN);
    expect(specs.length).toBe(0);
  });

  it('does not extract global using directives', () => {
    const specs = csharpResolver.extractImports('global using App.Services;', MAIN);
    expect(specs.length).toBe(0);
  });
});

describe('csharpResolver.resolveImport', () => {
  it('resolves an internal namespace to its directory', () => {
    expect(csharpResolver.resolveImport('App.Services', MAIN, FIXTURES)).toBe('App/Services');
  });

  it('returns null for System.* stdlib imports', () => {
    expect(csharpResolver.resolveImport('System.Collections.Generic', MAIN, FIXTURES)).toBeNull();
  });

  it('returns null for bare System', () => {
    expect(csharpResolver.resolveImport('System', MAIN, FIXTURES)).toBeNull();
  });

  it('returns null for Microsoft.* imports', () => {
    expect(csharpResolver.resolveImport('Microsoft.Extensions.DependencyInjection', MAIN, FIXTURES)).toBeNull();
  });

  it('returns null when no matching directory exists', () => {
    expect(csharpResolver.resolveImport('App.Missing', MAIN, FIXTURES)).toBeNull();
  });

  it('resolves a namespace whose project folder name itself contains dots', () => {
    expect(csharpResolver.resolveImport('Acme.Billing.Core.Services', MAIN, FIXTURES)).toBe('Acme.Billing.Core/Services');
  });

  it('does not resolve to a directory that exists but contains no .cs file', () => {
    expect(csharpResolver.resolveImport('App.NoSource', MAIN, FIXTURES)).toBeNull();
  });
});

describe('C# integration through traceImports', () => {
  it('resolves an internal namespace through the registry and expands its directory', async () => {
    const result = await traceImports([MAIN], FIXTURES, () => false);
    expect(result.dependencies).toContain('App/Services/OrderService.cs');
    expect(result.dependencies).toContain('App/Services/PaymentService.cs');
    expect(result.dependencies.some(d => d.startsWith('System'))).toBe(false);
  });
});
