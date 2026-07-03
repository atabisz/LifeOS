/**
 * Binary Tests Grader
 * Run actual test files and check pass/fail
 */

import { BaseGrader, registerGrader, type GraderContext } from '../Base.ts';
import type { GraderConfig, GraderResult, BinaryTestsParams } from '../../Types/index.ts';
import { $ } from 'bun';

export class BinaryTestsGrader extends BaseGrader {
  type = 'binary_tests' as const;
  category = 'code_based' as const;

  async grade(context: GraderContext): Promise<GraderResult> {
    const start = performance.now();
    const params = this.config.params as BinaryTestsParams;

    if (!params?.test_files?.length) {
      return this.createResult(0, false, performance.now() - start, {
        reasoning: 'No test files configured',
      });
    }

    const workingDir = context.working_dir ?? process.cwd();
    const timeout = params.timeout_ms ?? 60000;
    const timeoutSecs = Math.ceil(timeout / 1000);
    const results: { file: string; passed: boolean; output: string; error?: string }[] = [];

    // GNU coreutils `timeout` provides the wall-clock kill of a runaway test. On native
    // Windows, a bare `timeout` can resolve to System32's interactive pause tool (which
    // errors on piped stdin and false-FAILs the grade) — and even where an MSYS/Git-Bash
    // coreutils `timeout` is on PATH, we can't guarantee which one the shell picks. So we
    // gate on the platform first (never wrap on win32) AND on availability elsewhere; when
    // not wrapping, run unbounded with a visible warning. The tests still run and score —
    // only the runaway wall-clock cap is dropped, so a genuinely hung test will not be
    // force-killed on Windows.
    const hasGnuTimeout = process.platform !== 'win32' && Bun.which('timeout') !== null;
    if (!hasGnuTimeout) {
      console.warn(
        `⚠️  GNU 'timeout' unavailable — running test commands with NO ${timeoutSecs}s time limit. ` +
        `Tests still run and score, but a hung/runaway test will not be force-killed.`,
      );
    }

    for (const testFile of params.test_files) {
      try {
        // Detect test command based on file extension
        const command = params.test_command ?? this.detectTestCommand(testFile);

        const result = hasGnuTimeout
          ? await $`cd ${workingDir} && timeout ${timeoutSecs} ${command} ${testFile}`
              .quiet()
              .nothrow()
          : await $`cd ${workingDir} && ${command} ${testFile}`
              .quiet()
              .nothrow();

        const passed = result.exitCode === 0;
        results.push({
          file: testFile,
          passed,
          output: result.stdout.toString().slice(-500),  // Last 500 chars
          error: passed ? undefined : result.stderr.toString().slice(-500),
        });
      } catch (e) {
        results.push({
          file: testFile,
          passed: false,
          output: '',
          error: String(e),
        });
      }
    }

    const passCount = results.filter(r => r.passed).length;
    const score = passCount / params.test_files.length;
    const passed = passCount === params.test_files.length;

    return this.createResult(score, passed, performance.now() - start, {
      reasoning: `${passCount}/${params.test_files.length} tests passed`,
      details: {
        results,
        working_dir: workingDir,
      },
    });
  }

  private detectTestCommand(file: string): string {
    if (file.endsWith('.py')) return 'python -m pytest';
    if (file.endsWith('.ts')) return 'bun test';
    if (file.endsWith('.js')) return 'node --test';
    if (file.endsWith('.go')) return 'go test';
    if (file.endsWith('.rs')) return 'cargo test --';
    return 'bun test';  // Default
  }
}

registerGrader('binary_tests', BinaryTestsGrader);
