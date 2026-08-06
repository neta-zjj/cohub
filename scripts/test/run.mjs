import { spawn } from "node:child_process";
import { basename } from "node:path";
import { performance } from "node:perf_hooks";

const input = process.argv.slice(2);
const files = [];
const nodeOptions = [];
const imports = [new URL("./no-network.mjs", import.meta.url).href];
let nativeTypes = false;
let reporter = "dot";
let hasReporter = false;

for (let index = 0; index < input.length; index += 1) {
  const argument = input[index];
  if (argument === "--") {
    continue;
  }
  if (argument === "--native-types") {
    nativeTypes = true;
  } else if (argument === "--import") {
    const module = input[index + 1];
    if (!module) throw new Error("--import requires a module");
    imports.push(module);
    index += 1;
  } else if (argument === "--test-reporter") {
    const value = input[index + 1];
    if (!value) throw new Error("--test-reporter requires a value");
    reporter = value;
    hasReporter = true;
    nodeOptions.push(`--test-reporter=${value}`);
    index += 1;
  } else if (argument.startsWith("--test-reporter=")) {
    reporter = argument.slice("--test-reporter=".length);
    hasReporter = true;
    nodeOptions.push(argument);
  } else if (argument.startsWith("--")) {
    nodeOptions.push(argument);
  } else {
    files.push(argument);
  }
}

if (!hasReporter) nodeOptions.push("--test-reporter=dot");
if (reporter === "dot") {
  nodeOptions.push(
    `--test-reporter=${new URL("./summary-reporter.mjs", import.meta.url).href}`,
    "--test-reporter-destination=stdout",
    "--test-reporter-destination=stderr",
  );
}

const nodeArguments = [];
if (nativeTypes) {
  nodeArguments.push("--experimental-strip-types");
} else {
  nodeArguments.push("--import", import.meta.resolve("tsx"));
}
for (const module of imports) nodeArguments.push("--import", module);
nodeArguments.push("--test", ...nodeOptions, ...files);

const startedAt = performance.now();
const child = spawn(process.execPath, nodeArguments, {
  cwd: process.cwd(),
  env: process.env,
  stdio: ["inherit", "pipe", "pipe"],
});
const stdout = [];
const stderr = [];
child.stdout.on("data", (chunk) => stdout.push(chunk));
child.stderr.on("data", (chunk) => stderr.push(chunk));

// `close` (not `exit`) is what guarantees the piped stdio has been fully
// drained, so a large run cannot lose its trailing summary line.
const exitCode = await new Promise((resolve) => {
  child.once("close", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  child.once("error", (error) => {
    stderr.push(Buffer.from(`${error.stack ?? error.message}\n`));
    resolve(1);
  });
});

const output = Buffer.concat(stdout).toString("utf8");
const errors = Buffer.concat(stderr).toString("utf8");
const summaryMatches = [
  ...errors.matchAll(/^COHUB_TEST_SUMMARY (.+)$/gm),
];
const summaryJson = summaryMatches.at(-1)?.[1];
const counts = summaryJson ? JSON.parse(summaryJson) : null;
const visibleErrors = errors.replace(/^COHUB_TEST_SUMMARY .+\n?/gm, "");
const packageName = process.env.npm_package_name ?? basename(process.cwd());
const duration = ((performance.now() - startedAt) / 1000).toFixed(1);
let finalExitCode = exitCode;

if (exitCode !== 0) {
  process.stderr.write(`${packageName} failed ${duration}s\n`);
  process.stderr.write(output);
  process.stderr.write(visibleErrors);
} else if (reporter !== "dot") {
  process.stdout.write(output);
  process.stderr.write(visibleErrors);
} else {
  const unexpectedOutput = output
    .split("\n")
    .filter((line) => line && !/^\.+$/.test(line))
    .join("\n");
  if (unexpectedOutput) process.stdout.write(`${unexpectedOutput}\n`);
  if (visibleErrors) process.stderr.write(visibleErrors);
  if (!counts || !Number.isInteger(counts.tests)) {
    process.stderr.write(`${packageName} failed: test summary was not reported\n`);
    finalExitCode = 1;
  } else {
    process.stdout.write(
      `${packageName} ok ${counts.tests} tests ${duration}s\n`,
    );
  }
}

process.exitCode = finalExitCode;
