import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const platform = process.platform;
const arch = process.arch;
const binaryName = platform === 'win32' ? 'authority-core.exe' : 'authority-core';
const binaryPath = path.join(repoRoot, 'managed', 'core', `${platform}-${arch}`, binaryName);
const baseUrlHost = '127.0.0.1';
const userHandle = 'benchmark-user';
const extensionId = 'third-party/benchmark';
const channel = `extension:${extensionId}`;

const config = {
    iterations: readPositiveInt('AUTHORITY_BENCH_ITERATIONS', 40),
    concurrency: readPositiveInt('AUTHORITY_BENCH_CONCURRENCY', 4),
    sqlRows: readPositiveInt('AUTHORITY_BENCH_SQL_ROWS', 250),
    auditRecords: readPositiveInt('AUTHORITY_BENCH_AUDIT_RECORDS', 300),
    jobRecords: readPositiveInt('AUTHORITY_BENCH_JOB_RECORDS', 300),
    pageLimit: readPositiveInt('AUTHORITY_BENCH_PAGE_LIMIT', 50),
    healthTimeoutMs: readPositiveInt('AUTHORITY_BENCH_HEALTH_TIMEOUT_MS', 15_000),
    maxAvgMs: readOptionalPositiveNumber('AUTHORITY_BENCH_MAX_AVG_MS'),
    maxP95Ms: readOptionalPositiveNumber('AUTHORITY_BENCH_MAX_P95_MS'),
    outputPath: process.env.AUTHORITY_BENCH_OUTPUT || '',
};

if (!fs.existsSync(binaryPath)) {
    throw new Error(`Managed authority-core binary not found at ${binaryPath}. Run npm run build:core first.`);
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-core-bench-'));
const controlDbPath = path.join(tempRoot, 'state', 'control.sqlite');
const sqlDbPath = path.join(tempRoot, 'sql', 'bench.sqlite');
const port = 20_000 + Math.floor(Math.random() * 20_000);
const token = crypto.randomBytes(18).toString('hex');
const baseUrl = `http://${baseUrlHost}:${port}`;
const coreLogs = [];
let child;

try {
    child = spawn(binaryPath, [], {
        cwd: repoRoot,
        env: {
            ...process.env,
            AUTHORITY_CORE_HOST: baseUrlHost,
            AUTHORITY_CORE_PORT: String(port),
            AUTHORITY_CORE_TOKEN: token,
            AUTHORITY_CORE_VERSION: 'benchmark',
            AUTHORITY_CORE_API_VERSION: 'authority-core/v1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout?.on('data', chunk => pushCoreLog(coreLogs, String(chunk)));
    child.stderr?.on('data', chunk => pushCoreLog(coreLogs, String(chunk)));

    await waitForHealth(baseUrl, token, config.healthTimeoutMs);
    await seedSqlData();
    await seedAuditData();
    await seedJobAndEventData();

    const scenarios = [];
    scenarios.push(await benchmarkScenario('sql.query.page.first', () => request('/v1/sql/query', {
        dbPath: sqlDbPath,
        statement: 'SELECT id, label, value FROM benchmark_items ORDER BY id',
        page: { limit: config.pageLimit },
    })));
    scenarios.push(await benchmarkScenario('sql.query.page.second', () => request('/v1/sql/query', {
        dbPath: sqlDbPath,
        statement: 'SELECT id, label, value FROM benchmark_items ORDER BY id',
        page: { cursor: String(config.pageLimit), limit: config.pageLimit },
    })));
    scenarios.push(await benchmarkScenario('control.audit.recent.first', () => request('/v1/control/audit/recent', {
        dbPath: controlDbPath,
        userHandle,
        extensionId,
        page: { limit: config.pageLimit },
    })));
    scenarios.push(await benchmarkScenario('control.audit.recent.second', () => request('/v1/control/audit/recent', {
        dbPath: controlDbPath,
        userHandle,
        extensionId,
        page: { cursor: String(config.pageLimit), limit: config.pageLimit },
    })));
    scenarios.push(await benchmarkScenario('control.jobs.list.first', () => request('/v1/control/jobs/list', {
        dbPath: controlDbPath,
        userHandle,
        extensionId,
        page: { limit: config.pageLimit },
    })));
    scenarios.push(await benchmarkScenario('control.jobs.list.second', () => request('/v1/control/jobs/list', {
        dbPath: controlDbPath,
        userHandle,
        extensionId,
        page: { cursor: String(config.pageLimit), limit: config.pageLimit },
    })));
    scenarios.push(await benchmarkScenario('control.events.poll.first', () => request('/v1/control/events/poll', {
        dbPath: controlDbPath,
        userHandle,
        channel,
        afterId: 0,
        page: { limit: config.pageLimit },
    })));
    scenarios.push(await benchmarkScenario('control.events.poll.after-page', () => request('/v1/control/events/poll', {
        dbPath: controlDbPath,
        userHandle,
        channel,
        afterId: config.pageLimit,
        page: { limit: config.pageLimit },
    })));

    const health = await fetchHealth(baseUrl, token);
    const report = {
        generatedAt: new Date().toISOString(),
        platform: `${platform}-${arch}`,
        nodeVersion: process.version,
        binaryPath,
        config,
        health,
        scenarios,
        gate: evaluateGate(scenarios, config),
    };

    if (config.outputPath) {
        fs.mkdirSync(path.dirname(config.outputPath), { recursive: true });
        fs.writeFileSync(config.outputPath, JSON.stringify(report, null, 2), 'utf8');
    }

    printReport(report);
    if (!report.gate.passed) {
        process.exitCode = 1;
    }
} catch (error) {
    console.error('Authority core benchmark failed.');
    console.error(String(error instanceof Error ? error.stack || error.message : error));
    if (coreLogs.length > 0) {
        console.error('--- authority-core logs ---');
        console.error(coreLogs.join(''));
    }
    process.exitCode = 1;
} finally {
    if (child && !child.killed) {
        child.kill();
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
}

async function seedSqlData() {
    await request('/v1/sql/exec', {
        dbPath: sqlDbPath,
        statement: 'CREATE TABLE IF NOT EXISTS benchmark_items (id INTEGER PRIMARY KEY, label TEXT NOT NULL, value INTEGER NOT NULL)',
    });
    await request('/v1/sql/exec', {
        dbPath: sqlDbPath,
        statement: 'DELETE FROM benchmark_items',
    });
    for (let index = 0; index < config.sqlRows; index += 1) {
        await request('/v1/sql/exec', {
            dbPath: sqlDbPath,
            statement: 'INSERT INTO benchmark_items (id, label, value) VALUES (?, ?, ?)',
            params: [index + 1, `row-${index + 1}`, index * 3],
        });
    }
}

async function seedAuditData() {
    for (let index = 0; index < config.auditRecords; index += 1) {
        const kind = index % 6 === 0 ? 'warning' : index % 5 === 0 ? 'error' : 'usage';
        await request('/v1/control/audit/log', {
            dbPath: controlDbPath,
            userHandle,
            record: {
                timestamp: new Date(Date.now() + index).toISOString(),
                kind,
                extensionId,
                message: kind === 'warning' ? 'Slow job' : kind === 'error' ? 'Job failed' : 'SQL query',
                details: { index },
            },
        });
    }
}

async function seedJobAndEventData() {
    for (let index = 0; index < config.jobRecords; index += 1) {
        const timestamp = new Date(Date.now() + index).toISOString();
        await request('/v1/control/jobs/upsert', {
            dbPath: controlDbPath,
            userHandle,
            job: {
                id: `bench-job-${index + 1}`,
                extensionId,
                type: 'delay',
                status: index % 7 === 0 ? 'failed' : 'completed',
                createdAt: timestamp,
                updatedAt: timestamp,
                progress: 100,
                summary: `Seeded benchmark job ${index + 1}`,
                error: index % 7 === 0 ? 'job_timeout' : null,
                channel,
                attempt: 1,
                maxAttempts: 1,
            },
        });
    }
}

async function benchmarkScenario(name, task) {
    await task();
    const samples = [];
    let nextIndex = 0;

    await Promise.all(Array.from({ length: Math.max(1, config.concurrency) }, async () => {
        while (true) {
            const current = nextIndex;
            nextIndex += 1;
            if (current >= config.iterations) {
                return;
            }
            const started = performance.now();
            await task();
            samples.push(performance.now() - started);
        }
    }));

    return {
        name,
        iterations: config.iterations,
        concurrency: config.concurrency,
        avgMs: round(average(samples)),
        p50Ms: round(percentile(samples, 0.5)),
        p95Ms: round(percentile(samples, 0.95)),
        minMs: round(Math.min(...samples)),
        maxMs: round(Math.max(...samples)),
    };
}

async function request(requestPath, body) {
    const response = await fetch(`${baseUrl}${requestPath}`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-authority-core-token': token,
        },
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`${requestPath} failed with ${response.status}: ${text}`);
    }
    return await response.json();
}

async function fetchHealth(url, requestToken) {
    const response = await fetch(`${url}/health`, {
        headers: {
            'x-authority-core-token': requestToken,
        },
    });
    if (!response.ok) {
        throw new Error(`health check failed with status ${response.status}`);
    }
    return await response.json();
}

async function waitForHealth(url, requestToken, timeoutMs) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        try {
            await fetchHealth(url, requestToken);
            return;
        } catch {
            await sleep(150);
        }
    }
    throw new Error(`authority-core did not become healthy within ${timeoutMs}ms`);
}

function printReport(report) {
    console.log('Authority core benchmark baseline');
    console.log(`- platform: ${report.platform}`);
    console.log(`- iterations: ${report.config.iterations}`);
    console.log(`- concurrency: ${report.config.concurrency}`);
    console.log(`- pageLimit: ${report.config.pageLimit}`);
    if (report.config.maxAvgMs != null || report.config.maxP95Ms != null) {
        console.log(`- gate: avg<=${report.config.maxAvgMs ?? 'disabled'}ms p95<=${report.config.maxP95Ms ?? 'disabled'}ms`);
    }
    for (const scenario of report.scenarios) {
        console.log(`- ${scenario.name}: avg=${scenario.avgMs}ms p50=${scenario.p50Ms}ms p95=${scenario.p95Ms}ms min=${scenario.minMs}ms max=${scenario.maxMs}ms`);
    }
    if (report.gate.checked) {
        console.log(`- gate result: ${report.gate.passed ? 'passed' : 'failed'}`);
        for (const violation of report.gate.violations) {
            console.log(`  - ${violation}`);
        }
    }
    if (report.config.outputPath) {
        console.log(`- report: ${report.config.outputPath}`);
    }
}

function readPositiveInt(name, fallback) {
    const value = process.env[name];
    if (!value) {
        return fallback;
    }
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readOptionalPositiveNumber(name) {
    const value = process.env[name];
    if (!value) {
        return null;
    }
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function evaluateGate(scenarios, config) {
    const checked = config.maxAvgMs != null || config.maxP95Ms != null;
    const violations = [];

    if (config.maxAvgMs != null) {
        for (const scenario of scenarios) {
            if (scenario.avgMs > config.maxAvgMs) {
                violations.push(`${scenario.name} avg ${scenario.avgMs}ms > ${config.maxAvgMs}ms`);
            }
        }
    }

    if (config.maxP95Ms != null) {
        for (const scenario of scenarios) {
            if (scenario.p95Ms > config.maxP95Ms) {
                violations.push(`${scenario.name} p95 ${scenario.p95Ms}ms > ${config.maxP95Ms}ms`);
            }
        }
    }

    return {
        checked,
        passed: violations.length === 0,
        violations,
    };
}

function percentile(values, ratio) {
    const sorted = [...values].sort((left, right) => left - right);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
    return sorted[index] ?? 0;
}

function average(values) {
    return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function round(value) {
    return Math.round(value * 100) / 100;
}

function pushCoreLog(logs, chunk) {
    logs.push(chunk);
    if (logs.length > 200) {
        logs.shift();
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
