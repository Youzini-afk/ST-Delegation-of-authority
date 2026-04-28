import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { performance } from 'node:perf_hooks'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const platform = process.platform
const arch = process.arch
const binaryName = platform === 'win32' ? 'authority-core.exe' : 'authority-core'
const binaryPath = path.join(repoRoot, 'managed', 'core', `${platform}-${arch}`, binaryName)
const serverPluginDist = path.join(repoRoot, 'packages', 'server-plugin', 'dist', 'types')
const requiredDistFiles = [
    'services/core-service.js',
    'services/policy-service.js',
    'services/permission-service.js',
    'services/extension-service.js',
    'services/storage-service.js',
    'services/private-fs-service.js',
    'services/trivium-service.js',
    'services/admin-package-service.js',
    'store/authority-paths.js',
]
const presets = {
    smoke: {
        iterations: 6,
        heavyIterations: 1,
        concurrency: 2,
        pageLimit: 50,
        triviumNodes: 5_000,
        triviumEdgesPerNode: 2,
        triviumBatchSize: 250,
        triviumDim: 8,
        triviumOrphans: 100,
        mixedSqlRows: 1_000,
        mixedJobRecords: 400,
        adminExtensions: 2,
        adminKvEntries: 20,
        adminBlobCount: 6,
        adminBlobBytes: 8_192,
        adminFileCount: 8,
        adminFileBytes: 4_096,
        adminSqlRows: 200,
        adminTriviumNodes: 250,
    },
    default: {
        iterations: 10,
        heavyIterations: 1,
        concurrency: 3,
        pageLimit: 100,
        triviumNodes: 25_000,
        triviumEdgesPerNode: 2,
        triviumBatchSize: 500,
        triviumDim: 8,
        triviumOrphans: 500,
        mixedSqlRows: 5_000,
        mixedJobRecords: 2_000,
        adminExtensions: 3,
        adminKvEntries: 50,
        adminBlobCount: 12,
        adminBlobBytes: 16_384,
        adminFileCount: 16,
        adminFileBytes: 8_192,
        adminSqlRows: 800,
        adminTriviumNodes: 1_000,
    },
    large: {
        iterations: 6,
        heavyIterations: 1,
        concurrency: 2,
        pageLimit: 100,
        triviumNodes: 100_000,
        triviumEdgesPerNode: 2,
        triviumBatchSize: 1_000,
        triviumDim: 8,
        triviumOrphans: 2_000,
        mixedSqlRows: 10_000,
        mixedJobRecords: 5_000,
        adminExtensions: 5,
        adminKvEntries: 80,
        adminBlobCount: 16,
        adminBlobBytes: 32_768,
        adminFileCount: 24,
        adminFileBytes: 16_384,
        adminSqlRows: 2_000,
        adminTriviumNodes: 2_500,
    },
}

const profile = presets[process.env.AUTHORITY_SCALE_PROFILE ?? 'default'] ?? presets.default
const config = {
    profile: process.env.AUTHORITY_SCALE_PROFILE ?? 'default',
    iterations: readInt('AUTHORITY_SCALE_ITERATIONS', profile.iterations),
    heavyIterations: readInt('AUTHORITY_SCALE_HEAVY_ITERATIONS', profile.heavyIterations),
    concurrency: readInt('AUTHORITY_SCALE_CONCURRENCY', profile.concurrency),
    pageLimit: readInt('AUTHORITY_SCALE_PAGE_LIMIT', profile.pageLimit),
    resolveManyItems: readInt('AUTHORITY_SCALE_RESOLVE_MANY_ITEMS', Math.min(profile.pageLimit, 50)),
    triviumNodes: readInt('AUTHORITY_SCALE_TRIVIUM_NODES', profile.triviumNodes),
    triviumEdgesPerNode: readInt('AUTHORITY_SCALE_TRIVIUM_EDGES_PER_NODE', profile.triviumEdgesPerNode),
    triviumBatchSize: readInt('AUTHORITY_SCALE_TRIVIUM_BATCH_SIZE', profile.triviumBatchSize),
    triviumDim: readInt('AUTHORITY_SCALE_TRIVIUM_DIM', profile.triviumDim),
    triviumOrphans: readInt('AUTHORITY_SCALE_TRIVIUM_ORPHANS', profile.triviumOrphans),
    mixedSqlRows: readInt('AUTHORITY_SCALE_MIXED_SQL_ROWS', profile.mixedSqlRows),
    mixedJobRecords: readInt('AUTHORITY_SCALE_MIXED_JOB_RECORDS', profile.mixedJobRecords),
    adminExtensions: readInt('AUTHORITY_SCALE_ADMIN_EXTENSIONS', profile.adminExtensions),
    adminKvEntries: readInt('AUTHORITY_SCALE_ADMIN_KV_ENTRIES', profile.adminKvEntries),
    adminBlobCount: readInt('AUTHORITY_SCALE_ADMIN_BLOB_COUNT', profile.adminBlobCount),
    adminBlobBytes: readInt('AUTHORITY_SCALE_ADMIN_BLOB_BYTES', profile.adminBlobBytes),
    adminFileCount: readInt('AUTHORITY_SCALE_ADMIN_FILE_COUNT', profile.adminFileCount),
    adminFileBytes: readInt('AUTHORITY_SCALE_ADMIN_FILE_BYTES', profile.adminFileBytes),
    adminSqlRows: readInt('AUTHORITY_SCALE_ADMIN_SQL_ROWS', profile.adminSqlRows),
    adminTriviumNodes: readInt('AUTHORITY_SCALE_ADMIN_TRIVIUM_NODES', profile.adminTriviumNodes),
    operationTimeoutMs: readInt('AUTHORITY_SCALE_OPERATION_TIMEOUT_MS', 300_000),
    maxAvgMs: readOptionalPositiveNumber('AUTHORITY_SCALE_MAX_AVG_MS'),
    maxP95Ms: readOptionalPositiveNumber('AUTHORITY_SCALE_MAX_P95_MS'),
    outputPath: process.env.AUTHORITY_SCALE_OUTPUT || '',
    keepTemp: readFlag('AUTHORITY_SCALE_KEEP_TEMP'),
}

await main().catch(error => {
    console.error('Authority scale benchmark failed.')
    console.error(String(error instanceof Error ? error.stack || error.message : error))
    process.exitCode = 1
})

async function main() {
    if (!fs.existsSync(binaryPath)) {
        throw new Error(`Managed authority-core binary not found at ${binaryPath}. Run npm run build:core first.`)
    }
    for (const relativePath of requiredDistFiles) {
        const absolutePath = path.join(serverPluginDist, relativePath)
        if (!fs.existsSync(absolutePath)) {
            throw new Error(`Missing built server-plugin artifact at ${absolutePath}. Run npm run build first.`)
        }
    }

    const previousDataRoot = globalThis.DATA_ROOT
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-scale-bench-'))
    const globalRoot = path.join(tempRoot, 'global')
    const sourceRoot = path.join(tempRoot, 'source')
    const importRoot = path.join(tempRoot, 'import')
    globalThis.DATA_ROOT = globalRoot

    let core = null
    try {
        const {
            CoreService,
            PolicyService,
            PermissionService,
            ExtensionService,
            StorageService,
            PrivateFsService,
            TriviumService,
            AdminPackageService,
            getUserAuthorityPaths,
        } = await loadModules()

        const sourceUser = { handle: 'benchmark-admin', isAdmin: true, rootDir: sourceRoot }
        const importUser = { handle: 'benchmark-import', isAdmin: true, rootDir: importRoot }
        const sourcePaths = getUserAuthorityPaths(sourceUser)
        const quietLogger = {
            info() {},
            warn() {},
            error(...args) {
                console.error(...args)
            },
        }

        core = new CoreService({ runtimeDir: repoRoot, cwd: repoRoot, logger: quietLogger })
        const policies = new PolicyService(core)
        const permissions = new PermissionService(policies, core)
        const extensions = new ExtensionService(core)
        const storage = new StorageService(core)
        const files = new PrivateFsService(core)
        const trivium = new TriviumService(core)
        const adminPackages = new AdminPackageService(core, extensions, permissions, policies, storage, files, trivium)

        const status = await core.start()
        if (status.state !== 'running') {
            throw new Error(status.lastError || 'authority-core failed to start for scale benchmark')
        }

        const seed = {}
        seed.trivium = await seedLargeTrivium({ core, trivium, getUserAuthorityPaths, user: sourceUser })
        seed.mixed = await seedMixedDataset({ core, getUserAuthorityPaths, user: sourceUser })
        seed.admin = await seedAdminDataset({ core, policies, storage, files, trivium, getUserAuthorityPaths, user: sourceUser })

        const live = await trivium.resolveId(sourceUser, seed.trivium.extensionId, {
            database: seed.trivium.database,
            dim: config.triviumDim,
            externalId: seed.trivium.liveExternalId,
            namespace: seed.trivium.namespace,
        })
        if (!live.id) {
            throw new Error(`Failed to resolve benchmark node ${seed.trivium.liveExternalId}`)
        }

        const searchVector = buildVector(seed.trivium.liveIndex, config.triviumDim)
        const resolveManyStart = Math.max(1, Math.min(seed.trivium.liveIndex + 1, seed.trivium.remainingNodes))
        const resolveManyCount = Math.max(1, Math.min(config.resolveManyItems, Math.max(1, seed.trivium.remainingNodes - resolveManyStart + 1)))
        const resolveManyItems = buildResolveManyItems(resolveManyStart, resolveManyCount, seed.trivium.namespace)
        let exportedArtifactPath = ''

        const scenarios = []
        scenarios.push(await benchmarkScenario('trivium.search.vector', () => trivium.search(sourceUser, seed.trivium.extensionId, {
            database: seed.trivium.database,
            dim: config.triviumDim,
            vector: searchVector,
            topK: 10,
        }), { group: 'trivium' }))
        scenarios.push(await benchmarkScenario('trivium.neighbors.depth1', () => trivium.neighbors(sourceUser, seed.trivium.extensionId, {
            database: seed.trivium.database,
            dim: config.triviumDim,
            id: live.id,
            depth: 1,
        }), { group: 'trivium' }))
        scenarios.push(await benchmarkScenario('trivium.tql.page.find', () => trivium.tqlPage(sourceUser, seed.trivium.extensionId, {
            database: seed.trivium.database,
            dim: config.triviumDim,
            query: 'FIND {name: {$exists: true}} RETURN *',
            page: { limit: config.pageLimit },
        }), { group: 'trivium' }))
        scenarios.push(await benchmarkScenario('trivium.tql.page.match', () => trivium.tqlPage(sourceUser, seed.trivium.extensionId, {
            database: seed.trivium.database,
            dim: config.triviumDim,
            query: 'MATCH (n) RETURN n',
            page: { limit: config.pageLimit },
        }), { group: 'trivium' }))
        scenarios.push(await benchmarkScenario('trivium.resolveId', () => trivium.resolveId(sourceUser, seed.trivium.extensionId, {
            database: seed.trivium.database,
            dim: config.triviumDim,
            externalId: seed.trivium.liveExternalId,
            namespace: seed.trivium.namespace,
        }), { group: 'mappings' }))
        scenarios.push(await benchmarkScenario(`trivium.resolveMany.${resolveManyItems.length}`, () => trivium.resolveMany(sourceUser, seed.trivium.extensionId, {
            database: seed.trivium.database,
            items: resolveManyItems,
        }), { group: 'mappings' }))
        scenarios.push(await benchmarkScenario('trivium.listMappings.page', () => trivium.listMappingsPage(sourceUser, seed.trivium.extensionId, {
            database: seed.trivium.database,
            page: { limit: config.pageLimit },
        }), { group: 'mappings' }))
        scenarios.push(await benchmarkScenario('trivium.stat.basic', () => trivium.stat(sourceUser, seed.trivium.extensionId, {
            database: seed.trivium.database,
            dim: config.triviumDim,
        }), { group: 'mappings', iterations: config.heavyIterations, concurrency: 1, warmup: false }))
        scenarios.push(await benchmarkScenario('trivium.stat.includeMappingIntegrity', () => trivium.stat(sourceUser, seed.trivium.extensionId, {
            database: seed.trivium.database,
            dim: config.triviumDim,
            includeMappingIntegrity: true,
        }), { group: 'mappings', iterations: config.heavyIterations, concurrency: 1, warmup: false }))
        scenarios.push(await benchmarkScenario('trivium.checkMappingsIntegrity', () => trivium.checkMappingsIntegrity(sourceUser, seed.trivium.extensionId, {
            database: seed.trivium.database,
            dim: config.triviumDim,
            sampleLimit: config.pageLimit,
        }), { group: 'mappings', iterations: config.heavyIterations, concurrency: 1, warmup: false }))
        scenarios.push(await benchmarkScenario('trivium.deleteOrphanMappings.dryRun', () => trivium.deleteOrphanMappings(sourceUser, seed.trivium.extensionId, {
            database: seed.trivium.database,
            dim: config.triviumDim,
            limit: config.pageLimit,
            dryRun: true,
        }), { group: 'mappings', iterations: config.heavyIterations, concurrency: 1, warmup: false }))
        scenarios.push(await benchmarkScenario('trivium.flush', () => trivium.flush(sourceUser, seed.trivium.extensionId, {
            database: seed.trivium.database,
            dim: config.triviumDim,
        }), { group: 'trivium', iterations: config.heavyIterations, concurrency: 1, warmup: false }))
        scenarios.push(await benchmarkScenario('trivium.compact', () => trivium.compact(sourceUser, seed.trivium.extensionId, {
            database: seed.trivium.database,
            dim: config.triviumDim,
        }), { group: 'trivium', iterations: config.heavyIterations, concurrency: 1, warmup: false }))
        scenarios.push(await benchmarkScenario('mixed.sql.query.page', () => core.querySql(seed.mixed.sqlDbPath, {
            statement: 'SELECT id, label, score FROM mixed_items ORDER BY id',
            page: { limit: config.pageLimit },
        }), { group: 'mixed' }))
        scenarios.push(await benchmarkScenario('mixed.sql.batch.update-25', () => core.batchSql(seed.mixed.sqlDbPath, {
            statements: buildSqlUpdateStatements(1, 25),
        }), { group: 'mixed', concurrency: 1, warmup: false }))
        scenarios.push(await benchmarkScenario('mixed.sql.transaction.update-25', () => core.transactionSql(seed.mixed.sqlDbPath, {
            statements: buildSqlUpdateStatements(26, 25),
        }), { group: 'mixed', concurrency: 1, warmup: false }))
        scenarios.push(await benchmarkScenario('mixed.audit.recent.page', () => core.getRecentControlAudit(sourcePaths.controlDbFile, {
            userHandle: sourceUser.handle,
            extensionId: seed.mixed.extensionId,
            page: { limit: config.pageLimit },
        }), { group: 'mixed' }))
        scenarios.push(await benchmarkScenario('mixed.jobs.list.page', () => core.listControlJobsPage(sourcePaths.controlDbFile, {
            userHandle: sourceUser.handle,
            extensionId: seed.mixed.extensionId,
            page: { limit: config.pageLimit },
        }), { group: 'mixed' }))
        scenarios.push(await benchmarkScenario('mixed.events.poll.page', () => core.pollControlEvents(sourcePaths.controlDbFile, {
            userHandle: sourceUser.handle,
            channel: seed.mixed.channel,
            afterId: 0,
            page: { limit: config.pageLimit },
        }), { group: 'mixed' }))
        scenarios.push(await benchmarkScenario('mixed.parallel.reads', async () => {
            await Promise.all([
                core.querySql(seed.mixed.sqlDbPath, {
                    statement: 'SELECT id, label, score FROM mixed_items ORDER BY id',
                    page: { limit: config.pageLimit },
                }),
                core.getRecentControlAudit(sourcePaths.controlDbFile, {
                    userHandle: sourceUser.handle,
                    extensionId: seed.mixed.extensionId,
                    page: { limit: config.pageLimit },
                }),
                core.listControlJobsPage(sourcePaths.controlDbFile, {
                    userHandle: sourceUser.handle,
                    extensionId: seed.mixed.extensionId,
                    page: { limit: config.pageLimit },
                }),
                core.pollControlEvents(sourcePaths.controlDbFile, {
                    userHandle: sourceUser.handle,
                    channel: seed.mixed.channel,
                    afterId: 0,
                    page: { limit: config.pageLimit },
                }),
                trivium.search(sourceUser, seed.trivium.extensionId, {
                    database: seed.trivium.database,
                    dim: config.triviumDim,
                    vector: searchVector,
                    topK: 10,
                }),
            ])
        }, { group: 'mixed', concurrency: 1 }))
        scenarios.push(await benchmarkScenario('admin.package.export', async () => {
            const operation = adminPackages.startExport(sourceUser, {
                extensionIds: seed.admin.extensionIds,
                includePolicies: true,
                includeUsageSummary: true,
            })
            const completed = await waitForOperation(adminPackages, sourceUser, operation.id)
            const artifact = adminPackages.getArtifact(sourceUser, completed.id)
            exportedArtifactPath = artifact.filePath
            return {
                benchmarkBytes: artifact.artifact.sizeBytes,
                benchmarkMeta: {
                    artifactBytes: artifact.artifact.sizeBytes,
                    extensionCount: seed.admin.extensionIds.length,
                },
            }
        }, { group: 'admin', iterations: 1, concurrency: 1, warmup: false }))
        scenarios.push(await benchmarkScenario('admin.package.import.replace', async () => {
            if (!exportedArtifactPath) {
                throw new Error('Export artifact was not produced before import benchmark')
            }
            const sourceBytes = fs.statSync(exportedArtifactPath).size
            const operation = adminPackages.startImport(importUser, {
                transferId: 'local-benchmark-artifact',
                mode: 'replace',
                fileName: path.basename(exportedArtifactPath),
            }, exportedArtifactPath)
            const completed = await waitForOperation(adminPackages, importUser, operation.id)
            return {
                benchmarkBytes: sourceBytes,
                benchmarkMeta: {
                    importedExtensions: completed.importSummary?.extensionCount ?? 0,
                    importedGrants: completed.importSummary?.grantCount ?? 0,
                    sourceBytes,
                },
            }
        }, { group: 'admin', iterations: 1, concurrency: 1, warmup: false }))

        const healthStatus = await core.start()
        const report = {
            generatedAt: nowIso(),
            platform: `${platform}-${arch}`,
            nodeVersion: process.version,
            binaryPath,
            config,
            tempRoot: config.keepTemp ? tempRoot : undefined,
            health: healthStatus.health,
            seed,
            scenarios,
            gate: evaluateGate(scenarios, config),
        }

        if (config.outputPath) {
            fs.mkdirSync(path.dirname(config.outputPath), { recursive: true })
            fs.writeFileSync(config.outputPath, JSON.stringify(report, null, 2), 'utf8')
        }

        printReport(report)
        if (!report.gate.passed) {
            process.exitCode = 1
        }
    } finally {
        if (core) {
            await core.stop().catch(() => undefined)
        }
        if (previousDataRoot === undefined) {
            delete globalThis.DATA_ROOT
        } else {
            globalThis.DATA_ROOT = previousDataRoot
        }
        if (!config.keepTemp) {
            fs.rmSync(tempRoot, { recursive: true, force: true })
        }
    }
}

async function loadModules() {
    const coreModule = await import(pathToFileURL(path.join(serverPluginDist, 'services', 'core-service.js')).href)
    const policyModule = await import(pathToFileURL(path.join(serverPluginDist, 'services', 'policy-service.js')).href)
    const permissionModule = await import(pathToFileURL(path.join(serverPluginDist, 'services', 'permission-service.js')).href)
    const extensionModule = await import(pathToFileURL(path.join(serverPluginDist, 'services', 'extension-service.js')).href)
    const storageModule = await import(pathToFileURL(path.join(serverPluginDist, 'services', 'storage-service.js')).href)
    const fileModule = await import(pathToFileURL(path.join(serverPluginDist, 'services', 'private-fs-service.js')).href)
    const triviumModule = await import(pathToFileURL(path.join(serverPluginDist, 'services', 'trivium-service.js')).href)
    const adminModule = await import(pathToFileURL(path.join(serverPluginDist, 'services', 'admin-package-service.js')).href)
    const pathsModule = await import(pathToFileURL(path.join(serverPluginDist, 'store', 'authority-paths.js')).href)
    return {
        CoreService: coreModule.CoreService,
        PolicyService: policyModule.PolicyService,
        PermissionService: permissionModule.PermissionService,
        ExtensionService: extensionModule.ExtensionService,
        StorageService: storageModule.StorageService,
        PrivateFsService: fileModule.PrivateFsService,
        TriviumService: triviumModule.TriviumService,
        AdminPackageService: adminModule.AdminPackageService,
        getUserAuthorityPaths: pathsModule.getUserAuthorityPaths,
    }
}

async function seedLargeTrivium({ core, trivium, getUserAuthorityPaths, user }) {
    const extensionId = 'third-party/scale-trivium'
    const database = 'graph'
    const namespace = 'bench'
    const paths = getUserAuthorityPaths(user)
    const mappingDbPath = path.join(paths.triviumPrivateDir, sanitizeFileSegment(extensionId), '__mapping__', `${sanitizeFileSegment(database)}.sqlite`)

    await ensureExtensionRecord(core, paths.controlDbFile, user, {
        extensionId,
        displayName: 'Scale Trivium Benchmark',
        installType: 'local',
    })

    for (let start = 1; start <= config.triviumNodes; start += config.triviumBatchSize) {
        const end = Math.min(config.triviumNodes, start + config.triviumBatchSize - 1)
        const items = []
        for (let index = start; index <= end; index += 1) {
            items.push({
                externalId: `node-${index}`,
                namespace,
                vector: buildVector(index, config.triviumDim),
                payload: {
                    name: `Node ${index}`,
                    group: `g-${index % 16}`,
                    index,
                    parity: index % 2 === 0 ? 'even' : 'odd',
                },
            })
        }
        await trivium.bulkUpsert(user, extensionId, {
            database,
            dim: config.triviumDim,
            items,
        })
    }

    if (config.triviumEdgesPerNode > 0) {
        for (let start = 1; start <= config.triviumNodes; start += config.triviumBatchSize) {
            const end = Math.min(config.triviumNodes, start + config.triviumBatchSize - 1)
            const items = []
            for (let index = start; index <= end; index += 1) {
                for (let edge = 1; edge <= config.triviumEdgesPerNode; edge += 1) {
                    const targetIndex = ((index + edge - 1) % config.triviumNodes) + 1
                    items.push({
                        src: { externalId: `node-${index}`, namespace },
                        dst: { externalId: `node-${targetIndex}`, namespace },
                        label: edge === 1 ? 'next' : `jump-${edge}`,
                        weight: edge,
                    })
                }
            }
            await trivium.bulkLink(user, extensionId, {
                database,
                dim: config.triviumDim,
                items,
            })
        }
    }

    const orphanCount = Math.min(config.triviumOrphans, Math.max(0, config.triviumNodes - 2))
    if (orphanCount > 0) {
        for (let orphanIndex = 0; orphanIndex < orphanCount; orphanIndex += 1) {
            const timestamp = nowIso()
            await core.execSql(mappingDbPath, {
                statement: 'INSERT INTO authority_trivium_external_ids (internal_id, namespace, external_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)',
                params: [config.triviumNodes + orphanIndex + 10_000, namespace, `orphan-${orphanIndex + 1}`, timestamp, timestamp],
            })
        }
    }

    await trivium.flush(user, extensionId, { database, dim: config.triviumDim })

    const remainingNodes = config.triviumNodes
    const liveIndex = Math.max(1, Math.min(Math.floor(remainingNodes / 2), Math.max(1, remainingNodes - 1)))
    return {
        extensionId,
        database,
        namespace,
        nodeCount: config.triviumNodes,
        remainingNodes,
        orphanCount,
        mappingCount: config.triviumNodes + orphanCount,
        liveIndex,
        liveExternalId: `node-${liveIndex}`,
    }
}

async function seedMixedDataset({ core, getUserAuthorityPaths, user }) {
    const extensionId = 'third-party/scale-mixed'
    const channel = `extension:${extensionId}`
    const paths = getUserAuthorityPaths(user)
    const sqlDbPath = path.join(paths.sqlPrivateDir, sanitizeFileSegment(extensionId), 'mixed.sqlite')
    const auditRecords = Math.max(config.pageLimit * 4, Math.ceil(config.mixedJobRecords / 2))

    await ensureExtensionRecord(core, paths.controlDbFile, user, {
        extensionId,
        displayName: 'Scale Mixed Benchmark',
        installType: 'local',
    })

    await core.execSql(sqlDbPath, {
        statement: 'CREATE TABLE IF NOT EXISTS mixed_items (id INTEGER PRIMARY KEY, label TEXT NOT NULL, score INTEGER NOT NULL, category TEXT NOT NULL)',
    })
    await core.execSql(sqlDbPath, {
        statement: 'DELETE FROM mixed_items',
    })

    for (let start = 1; start <= config.mixedSqlRows; start += 250) {
        const end = Math.min(config.mixedSqlRows, start + 249)
        const statements = []
        for (let index = start; index <= end; index += 1) {
            statements.push({
                statement: 'INSERT INTO mixed_items (id, label, score, category) VALUES (?1, ?2, ?3, ?4)',
                params: [index, `row-${index}`, index * 3, `c-${index % 8}`],
            })
        }
        await core.batchSql(sqlDbPath, { statements })
    }

    for (let index = 0; index < auditRecords; index += 1) {
        const kind = index % 4 === 0 ? 'warning' : index % 3 === 0 ? 'error' : index % 2 === 0 ? 'permission' : 'usage'
        await core.logControlAudit(paths.controlDbFile, {
            userHandle: user.handle,
            record: {
                timestamp: new Date(Date.now() + index).toISOString(),
                kind,
                extensionId,
                message: `${kind} benchmark record ${index + 1}`,
                details: { index, source: 'benchmark-scale' },
            },
        })
    }

    for (let index = 0; index < config.mixedJobRecords; index += 1) {
        const timestamp = new Date(Date.now() + index).toISOString()
        const failed = index % 7 === 0
        await core.upsertControlJob(paths.controlDbFile, {
            userHandle: user.handle,
            job: {
                id: `mixed-job-${index + 1}`,
                extensionId,
                type: 'delay',
                status: failed ? 'failed' : 'completed',
                createdAt: timestamp,
                updatedAt: timestamp,
                progress: 100,
                summary: `Seeded mixed benchmark job ${index + 1}`,
                ...(failed ? { error: 'job_timeout' } : {}),
                channel,
                attempt: 1,
                maxAttempts: 1,
                payload: { index },
            },
        })
    }

    return {
        extensionId,
        channel,
        sqlDbPath,
        sqlRows: config.mixedSqlRows,
        auditRecords,
        jobRecords: config.mixedJobRecords,
    }
}

async function seedAdminDataset({ core, policies, storage, files, trivium, getUserAuthorityPaths, user }) {
    const paths = getUserAuthorityPaths(user)
    const extensionIds = []
    const policyExtensions = {}
    const limitExtensions = {}
    let totalKvEntries = 0
    let totalBlobCount = 0
    let totalFileCount = 0
    let totalSqlRows = 0
    let totalTriviumNodes = 0

    for (let index = 0; index < config.adminExtensions; index += 1) {
        const extensionId = `third-party/admin-bench-${index + 1}`
        const installType = index % 2 === 0 ? 'local' : 'global'
        const kvCount = distributeCount(config.adminKvEntries, config.adminExtensions, index)
        const blobCount = distributeCount(config.adminBlobCount, config.adminExtensions, index)
        const fileCount = distributeCount(config.adminFileCount, config.adminExtensions, index)
        const sqlRows = distributeCount(config.adminSqlRows, config.adminExtensions, index)
        const triviumNodes = distributeCount(config.adminTriviumNodes, config.adminExtensions, index)
        const timestamp = nowIso()

        extensionIds.push(extensionId)
        totalKvEntries += kvCount
        totalBlobCount += blobCount
        totalFileCount += fileCount
        totalSqlRows += sqlRows
        totalTriviumNodes += triviumNodes

        await ensureExtensionRecord(core, paths.controlDbFile, user, {
            extensionId,
            displayName: `Admin Benchmark ${index + 1}`,
            installType,
        })

        for (let kvIndex = 0; kvIndex < kvCount; kvIndex += 1) {
            await storage.setKv(user, extensionId, `key-${kvIndex + 1}`, {
                index: kvIndex + 1,
                extension: extensionId,
                payload: buildSizedText(`kv-${kvIndex + 1}`, 128),
            })
        }

        for (let blobIndex = 0; blobIndex < blobCount; blobIndex += 1) {
            await storage.putBlob(
                user,
                extensionId,
                `blob-${blobIndex + 1}.txt`,
                buildSizedText(`blob-${blobIndex + 1}`, config.adminBlobBytes),
                'utf8',
                'text/plain',
            )
        }

        if (fileCount > 0) {
            await files.mkdir(user, extensionId, { path: '/docs', recursive: true })
        }
        for (let fileIndex = 0; fileIndex < fileCount; fileIndex += 1) {
            await files.writeFile(user, extensionId, {
                path: `/docs/file-${fileIndex + 1}.txt`,
                content: buildSizedText(`file-${fileIndex + 1}`, config.adminFileBytes),
                encoding: 'utf8',
                createParents: true,
            })
        }

        const sqlDbPath = path.join(paths.sqlPrivateDir, sanitizeFileSegment(extensionId), `admin-${index + 1}.sqlite`)
        await core.execSql(sqlDbPath, {
            statement: 'CREATE TABLE IF NOT EXISTS admin_items (id INTEGER PRIMARY KEY, title TEXT NOT NULL, weight INTEGER NOT NULL)',
        })
        await core.execSql(sqlDbPath, { statement: 'DELETE FROM admin_items' })
        for (let start = 1; start <= sqlRows; start += 200) {
            const end = Math.min(sqlRows, start + 199)
            const statements = []
            for (let rowIndex = start; rowIndex <= end; rowIndex += 1) {
                statements.push({
                    statement: 'INSERT INTO admin_items (id, title, weight) VALUES (?1, ?2, ?3)',
                    params: [rowIndex, `item-${rowIndex}`, rowIndex * 5],
                })
            }
            if (statements.length > 0) {
                await core.batchSql(sqlDbPath, { statements })
            }
        }

        const database = `graph-${index + 1}`
        for (let start = 1; start <= triviumNodes; start += Math.max(1, Math.min(config.triviumBatchSize, 250))) {
            const end = Math.min(triviumNodes, start + Math.max(1, Math.min(config.triviumBatchSize, 250)) - 1)
            const items = []
            for (let nodeIndex = start; nodeIndex <= end; nodeIndex += 1) {
                items.push({
                    externalId: `admin-node-${index + 1}-${nodeIndex}`,
                    namespace: 'admin',
                    vector: buildVector(nodeIndex, config.triviumDim),
                    payload: {
                        name: `Admin Node ${nodeIndex}`,
                        extension: extensionId,
                    },
                })
            }
            if (items.length > 0) {
                await trivium.bulkUpsert(user, extensionId, {
                    database,
                    dim: config.triviumDim,
                    items,
                })
            }
        }
        if (triviumNodes > 0) {
            await trivium.flush(user, extensionId, { database, dim: config.triviumDim })
        }

        await core.upsertControlGrant(paths.controlDbFile, {
            userHandle: user.handle,
            extensionId,
            grant: {
                key: 'storage.kv:*',
                resource: 'storage.kv',
                target: '*',
                status: 'granted',
                scope: 'persistent',
                riskLevel: 'low',
                updatedAt: timestamp,
                source: 'admin',
                choice: 'allow-always',
            },
        })
        await core.upsertControlGrant(paths.controlDbFile, {
            userHandle: user.handle,
            extensionId,
            grant: {
                key: `sql.private:admin-${index + 1}`,
                resource: 'sql.private',
                target: `admin-${index + 1}`,
                status: 'granted',
                scope: 'persistent',
                riskLevel: 'medium',
                updatedAt: timestamp,
                source: 'admin',
                choice: 'allow-always',
            },
        })
        policyExtensions[extensionId] = {
            'jobs.background:delay': {
                key: 'jobs.background:delay',
                resource: 'jobs.background',
                target: 'delay',
                status: 'granted',
                riskLevel: 'medium',
                updatedAt: timestamp,
                source: 'admin',
            },
        }
        limitExtensions[extensionId] = {
            inlineThresholdBytes: {
                storageBlobWrite: 128 * 1024,
                privateFileWrite: 128 * 1024,
            },
            transferMaxBytes: {
                storageBlobWrite: 2 * 1024 * 1024,
                privateFileWrite: 2 * 1024 * 1024,
            },
        }
    }

    await policies.saveGlobalPolicies(user, {
        extensions: policyExtensions,
        limits: {
            extensions: limitExtensions,
        },
    })

    return {
        extensionIds,
        extensionCount: extensionIds.length,
        kvEntries: totalKvEntries,
        blobCount: totalBlobCount,
        fileCount: totalFileCount,
        sqlRows: totalSqlRows,
        triviumNodes: totalTriviumNodes,
    }
}

async function ensureExtensionRecord(core, controlDbFile, user, { extensionId, displayName, installType }) {
    return await core.initializeControlSession(
        controlDbFile,
        `benchmark-session-${crypto.randomUUID()}`,
        nowIso(),
        { handle: user.handle, isAdmin: user.isAdmin },
        {
            extensionId,
            displayName,
            version: 'benchmark',
            installType,
            declaredPermissions: buildDeclaredPermissions(),
            uiLabel: displayName,
        },
    )
}

function buildDeclaredPermissions() {
    return {
        storage: { kv: true, blob: true },
        fs: { private: true },
        sql: { private: true },
        trivium: { private: true },
        jobs: { background: true },
        events: { channels: true },
        http: { allow: ['example.com'] },
    }
}

function buildResolveManyItems(startIndex, count, namespace) {
    const items = []
    for (let offset = 0; offset < count; offset += 1) {
        items.push({
            externalId: `node-${startIndex + offset}`,
            namespace,
        })
    }
    return items
}

function buildSqlUpdateStatements(startId, count) {
    const statements = []
    for (let offset = 0; offset < count; offset += 1) {
        statements.push({
            statement: 'UPDATE mixed_items SET score = score + 1 WHERE id = ?1',
            params: [startId + offset],
        })
    }
    return statements
}

async function waitForOperation(adminPackages, user, operationId) {
    const startedAt = Date.now()
    while (Date.now() - startedAt < config.operationTimeoutMs) {
        const operation = adminPackages.getOperation(user, operationId)
        if (!operation) {
            throw new Error(`Import/export operation ${operationId} was not found`)
        }
        if (operation.status === 'completed') {
            return operation
        }
        if (operation.status === 'failed') {
            throw new Error(operation.error || `Import/export operation ${operationId} failed`)
        }
        await sleep(100)
    }
    throw new Error(`Import/export operation ${operationId} exceeded ${config.operationTimeoutMs}ms`)
}

async function benchmarkScenario(name, task, options = {}) {
    const iterations = options.iterations ?? config.iterations
    const concurrency = Math.max(1, options.concurrency ?? config.concurrency)
    const warmup = options.warmup !== false
    const samples = []
    let nextIndex = 0
    let benchmarkBytes = null
    let benchmarkMeta = null

    if (warmup) {
        await task()
    }

    await Promise.all(Array.from({ length: concurrency }, async () => {
        while (true) {
            const current = nextIndex
            nextIndex += 1
            if (current >= iterations) {
                return
            }
            const started = performance.now()
            const result = await task()
            samples.push(performance.now() - started)
            const measurement = extractBenchmarkMeasurement(result)
            if (measurement.benchmarkBytes != null) {
                benchmarkBytes = measurement.benchmarkBytes
            }
            if (measurement.benchmarkMeta != null) {
                benchmarkMeta = measurement.benchmarkMeta
            }
        }
    }))

    const avgMs = average(samples)
    return {
        name,
        ...(options.group ? { group: options.group } : {}),
        iterations,
        concurrency,
        avgMs: round(avgMs),
        p50Ms: round(percentile(samples, 0.5)),
        p95Ms: round(percentile(samples, 0.95)),
        minMs: round(Math.min(...samples)),
        maxMs: round(Math.max(...samples)),
        ...(benchmarkBytes != null
            ? {
                benchmarkBytes,
                throughputMiBPerSec: round((benchmarkBytes / 1024 / 1024) / Math.max(avgMs / 1000, 0.000001)),
            }
            : {}),
        ...(benchmarkMeta != null ? { benchmarkMeta } : {}),
    }
}

function printReport(report) {
    console.log('Authority scale benchmark')
    console.log(`- profile: ${report.config.profile}`)
    console.log(`- platform: ${report.platform}`)
    console.log(`- iterations: ${report.config.iterations}`)
    console.log(`- heavyIterations: ${report.config.heavyIterations}`)
    console.log(`- concurrency: ${report.config.concurrency}`)
    console.log(`- pageLimit: ${report.config.pageLimit}`)
    console.log(`- seed.trivium: nodes=${report.seed.trivium.nodeCount} remaining=${report.seed.trivium.remainingNodes} orphanMappings=${report.seed.trivium.orphanCount}`)
    console.log(`- seed.mixed: sqlRows=${report.seed.mixed.sqlRows} audit=${report.seed.mixed.auditRecords} jobs=${report.seed.mixed.jobRecords}`)
    console.log(`- seed.admin: extensions=${report.seed.admin.extensionCount} kv=${report.seed.admin.kvEntries} blobs=${report.seed.admin.blobCount} files=${report.seed.admin.fileCount} sqlRows=${report.seed.admin.sqlRows} triviumNodes=${report.seed.admin.triviumNodes}`)
    if (report.config.maxAvgMs != null || report.config.maxP95Ms != null) {
        console.log(`- optional gate: avg<=${report.config.maxAvgMs ?? 'disabled'}ms p95<=${report.config.maxP95Ms ?? 'disabled'}ms`)
    }
    for (const scenario of report.scenarios) {
        let line = `- [${scenario.group ?? 'general'}] ${scenario.name}: avg=${scenario.avgMs}ms p50=${scenario.p50Ms}ms p95=${scenario.p95Ms}ms min=${scenario.minMs}ms max=${scenario.maxMs}ms`
        if (scenario.throughputMiBPerSec != null) {
            line += ` throughput=${scenario.throughputMiBPerSec}MiB/s`
        }
        console.log(line)
        if (scenario.benchmarkMeta) {
            console.log(`  - meta: ${JSON.stringify(scenario.benchmarkMeta)}`)
        }
    }
    if (report.gate.checked) {
        console.log(`- gate result: ${report.gate.passed ? 'passed' : 'failed'}`)
        for (const violation of report.gate.violations) {
            console.log(`  - ${violation}`)
        }
    }
    if (report.config.outputPath) {
        console.log(`- report: ${report.config.outputPath}`)
    }
    if (report.tempRoot) {
        console.log(`- tempRoot: ${report.tempRoot}`)
    }
}

function extractBenchmarkMeasurement(result) {
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
        return { benchmarkBytes: null, benchmarkMeta: null }
    }
    const benchmarkBytes = Number.isFinite(result.benchmarkBytes) ? Number(result.benchmarkBytes) : null
    const benchmarkMeta = result.benchmarkMeta && typeof result.benchmarkMeta === 'object' && !Array.isArray(result.benchmarkMeta)
        ? result.benchmarkMeta
        : null
    return { benchmarkBytes, benchmarkMeta }
}

function distributeCount(total, parts, index) {
    const base = Math.floor(total / Math.max(parts, 1))
    const remainder = total % Math.max(parts, 1)
    return base + (index < remainder ? 1 : 0)
}

function buildSizedText(label, sizeBytes) {
    const prefix = `${label}:`
    if (sizeBytes <= prefix.length) {
        return prefix.slice(0, sizeBytes)
    }
    return `${prefix}${'x'.repeat(sizeBytes - prefix.length)}`
}

function sanitizeFileSegment(input) {
    return String(input).replace(/[^a-zA-Z0-9._-]/g, '_')
}

function buildVector(index, dim) {
    const vector = []
    for (let offset = 0; offset < dim; offset += 1) {
        vector.push(((index + offset * 17) % 97) / 97)
    }
    return vector
}

function chunkArray(items, chunkSize) {
    const chunks = []
    for (let index = 0; index < items.length; index += chunkSize) {
        chunks.push(items.slice(index, index + chunkSize))
    }
    return chunks
}

function readInt(name, fallback) {
    const value = process.env[name]
    if (!value) {
        return fallback
    }
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function readOptionalPositiveNumber(name) {
    const value = process.env[name]
    if (!value) {
        return null
    }
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function readFlag(name) {
    const value = process.env[name]
    if (!value) {
        return false
    }
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

function evaluateGate(scenarios, gateConfig) {
    const checked = gateConfig.maxAvgMs != null || gateConfig.maxP95Ms != null
    const violations = []

    if (gateConfig.maxAvgMs != null) {
        for (const scenario of scenarios) {
            if (scenario.avgMs > gateConfig.maxAvgMs) {
                violations.push(`${scenario.name} avg ${scenario.avgMs}ms > ${gateConfig.maxAvgMs}ms`)
            }
        }
    }

    if (gateConfig.maxP95Ms != null) {
        for (const scenario of scenarios) {
            if (scenario.p95Ms > gateConfig.maxP95Ms) {
                violations.push(`${scenario.name} p95 ${scenario.p95Ms}ms > ${gateConfig.maxP95Ms}ms`)
            }
        }
    }

    return {
        checked,
        passed: violations.length === 0,
        violations,
    }
}

function percentile(values, ratio) {
    const sorted = [...values].sort((left, right) => left - right)
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))
    return sorted[index] ?? 0
}

function average(values) {
    return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1)
}

function round(value) {
    return Math.round(value * 100) / 100
}

function nowIso() {
    return new Date().toISOString()
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}
