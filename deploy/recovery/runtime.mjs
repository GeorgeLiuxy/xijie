import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

export const SOURCE_SPECS = Object.freeze([
  { domain: 'identity', name: 'xijie-identity-dev-identity-db-1', project: 'xijie-identity-dev', service: 'identity-db', db: 'xijie_identity', user: 'xijie_identity', major: 16 },
  { domain: 'people', name: 'xijie-people-dev-people-db-1', project: 'xijie-people-dev', service: 'people-db', db: 'xijie_people', user: 'xijie_people', major: 16 },
  { domain: 'conversations', name: 'xijie-conversations-dev-conversations-db-1', project: 'xijie-conversations-dev', service: 'conversations-db', db: 'xijie_conversations', user: 'xijie_conversations', major: 16 },
  { domain: 'memories', name: 'xijie-memories-dev-memories-db-1', project: 'xijie-memories-dev', service: 'memories-db', db: 'xijie_memories', user: 'xijie_memories', major: 16 },
  { domain: 'social', name: 'xijie-social-dev-social-db-1', project: 'xijie-social-dev', service: 'social-db', db: 'xijie_social', user: 'xijie_social', major: 16 },
  { domain: 'media', name: 'xijie-media-dev-media-db-1', project: 'xijie-media-dev', service: 'media-db', db: 'xijie_media', user: 'xijie_media', major: 16 },
  { domain: 'gifts', name: 'xijie-gifts-dev-gifts-db-1', project: 'xijie-gifts-dev', service: 'gifts-db', db: 'xijie_gifts', user: 'xijie_gifts', major: 16 },
  { domain: 'logto', name: 'xijie-identity-dev-logto-db-1', project: 'xijie-identity-dev', service: 'logto-db', db: 'logto', user: 'logto', major: 17 },
].map(Object.freeze))
export const SOURCES = SOURCE_SPECS
const LABEL = 'app.xijie.recovery.run'
const ARCHIVE = '/tmp/xijie-recovery.dump'
const RUN = /^[a-z0-9][a-z0-9-]{7,63}$/
const ID = /^[a-f0-9]{64}$/
const INSPECT = '{"id":{{json .Id}},"name":{{json .Name}},"image":{{json .Config.Image}},"imageId":{{json .Image}},"labels":{{json .Config.Labels}},"running":{{json .State.Running}},"networkMode":{{json .HostConfig.NetworkMode}},"ports":{{json .HostConfig.PortBindings}},"mounts":{{json .Mounts}}}'
const fail = message => new Error(message)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

export async function privateFilePermissions(file) {
  const stat = await fs.lstat(file)
  if (stat.isSymbolicLink() || !stat.isFile() && !stat.isDirectory()) throw fail('Private path must be a regular file or directory')
  if (process.platform !== 'win32') { await fs.chmod(file, stat.isDirectory() ? 0o700 : 0o600); return }
  const escaped = path.resolve(file).replace(/'/g, "''"), directory = stat.isDirectory()
  const script = "$ErrorActionPreference='Stop';$p='" + escaped + "';$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;$item=[IO." + (directory ? 'DirectoryInfo' : 'FileInfo') + "]::new($p);$acl=[IO.FileSystemAclExtensions]::GetAccessControl($item,[Security.AccessControl.AccessControlSections]::Access);$acl.SetAccessRuleProtection($true,$false);foreach($rule in $acl.GetAccessRules($true,$false,[Security.Principal.SecurityIdentifier])){$acl.RemoveAccessRuleSpecific($rule)};foreach($s in @($sid,'S-1-5-18')){$id=[Security.Principal.SecurityIdentifier]::new($s);$rule=[Security.AccessControl.FileSystemAccessRule]::new($id,'FullControl','" + (directory ? 'ContainerInherit,ObjectInherit' : 'None') + "','None','Allow');$acl.AddAccessRule($rule)};[IO.FileSystemAclExtensions]::SetAccessControl($item,$acl)"
  const child = spawn('pwsh.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
  child.stderr.resume()
  const code = await new Promise((resolve, reject) => { child.once('error', () => reject(fail('Private path protection could not start'))); child.once('close', resolve) })
  if (code !== 0) throw fail('Private path protection failed')
}

/** Native processes only: archive bytes never pass through a PowerShell text pipeline. */
export class DockerRuntime {
  #sources = new Map()
  #targets = new Map()
  constructor(root) { this.root = path.resolve(root) }

  #spawn(args, options = {}) {
    return spawn('docker', args, { cwd: this.root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], ...options })
  }
  async #run(args, input, { limit = 64 * 1024 * 1024, allowFailure = false, operation = 'Docker command' } = {}) {
    const child = this.#spawn(args), chunks = []
    let bytes = 0, oversized = false
    child.stdout.on('data', value => {
      bytes += value.length
      if (bytes > limit) { oversized = true; child.kill(); return }
      chunks.push(value)
    })
    // stderr can contain SQL data or private configuration. Never include it in errors or logs.
    child.stderr.resume()
    child.stdin.on('error', () => {})
    child.stdin.end(input)
    const code = await new Promise((resolve, reject) => {
      child.once('error', () => reject(fail(operation + ' could not start')))
      child.once('close', resolve)
    })
    if (oversized) throw fail(operation + ' exceeded its output bound')
    if (code !== 0 && !allowFailure) throw fail(operation + ' failed (exit ' + code + ')')
    return { code, stdout: Buffer.concat(chunks).toString('utf8') }
  }
  async #inspect(id) {
    const { stdout } = await this.#run(['inspect', '--format', INSPECT, id], undefined, { limit: 1024 * 1024, operation: 'Container inspection' })
    let value
    try { value = JSON.parse(stdout) } catch { throw fail('Invalid container inspection result') }
    if (!ID.test(value.id ?? '') || !/^sha256:[a-f0-9]{64}$/.test(value.imageId ?? '')) throw fail('Invalid container identity')
    value.name = value.name?.replace(/^\//, '')
    return value
  }
  async #nativeImage(imageId, major) {
    if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) throw fail('Invalid PostgreSQL image identity')
    const metadata = (await this.#run(['image', 'inspect', '--format', '{"id":{{json .Id}},"entrypoint":{{json .Config.Entrypoint}},"cmd":{{json .Config.Cmd}}}', imageId], undefined, { operation: 'Local restore image inspection' })).stdout
    let image
    try { image = JSON.parse(metadata) } catch { throw fail('Invalid PostgreSQL image metadata') }
    const version = (await this.#run(['image', 'inspect', '--format', '{{range .Config.Env}}{{if eq (index (split . "=") 0) "PG_MAJOR"}}{{.}}{{end}}{{end}}', imageId], undefined, { operation: 'PostgreSQL image version inspection' })).stdout.trim()
    if (image.id !== imageId || version !== 'PG_MAJOR=' + major || !Array.isArray(image.entrypoint)
      || image.entrypoint.length !== 1 || !/(?:^|\/)docker-entrypoint\.sh$/.test(image.entrypoint[0])
      || JSON.stringify(image.cmd) !== '["postgres"]') throw fail('Image is not the expected native PostgreSQL image')
  }
  async #adopt(actual, runId, expectedDomain) {
    const spec = SOURCE_SPECS.find(item => item.domain === actual.labels?.['app.xijie.recovery.domain'])
    if (!spec || expectedDomain && spec.domain !== expectedDomain || !RUN.test(runId ?? '')
      || actual.labels?.[LABEL] !== runId || !new RegExp('^xijie-recovery-' + runId + '-' + spec.domain + '(?:-[a-f0-9]{8})?$').test(actual.name ?? '')
      || actual.networkMode !== 'none' || Object.keys(actual.ports ?? {}).length
      || (actual.mounts ?? []).some(mount => mount.Type !== 'tmpfs')) throw fail('Orphaned container does not match recovery ownership and isolation')
    await this.#nativeImage(actual.imageId, spec.major)
    const target = { ...spec, id: actual.id, image: actual.image, imageId: actual.imageId, name: actual.name, runId, kind: 'target', project: null, service: null }
    this.#targets.set(target.id, target)
    return target
  }
  #known(target) {
    const source = this.#sources.get(target?.id)
    if (source && source.domain === target.domain && source.name === target.name && source.db === target.db && source.user === target.user) return source
    const clone = this.#targets.get(target?.id)
    if (clone && clone.domain === target.domain && clone.name === target.name && clone.runId === target.runId && clone.db === target.db && clone.user === target.user) return clone
    throw fail('Target was not inspected or created by this runtime')
  }
  async inspectSource(input) {
    const spec = SOURCE_SPECS.find(item => item.domain === (typeof input === 'string' ? input : input?.domain))
    if (!spec) throw fail('Unsupported source domain')
    if (typeof input === 'object') for (const key of ['name', 'project', 'service', 'db', 'user', 'major']) {
      if (input[key] !== undefined && input[key] !== spec[key]) throw fail('Source specification differs from the allowlist')
    }
    const actual = await this.#inspect(spec.name)
    if (!actual.running || actual.name !== spec.name || actual.labels?.['com.docker.compose.project'] !== spec.project
      || actual.labels?.['com.docker.compose.service'] !== spec.service || actual.labels?.['com.docker.compose.oneoff'] === 'True') throw fail('Source container does not match its Compose ownership')
    if (!new RegExp('^postgres:' + spec.major + '(?:[.-]|$)').test(actual.image)) throw fail('Unexpected source PostgreSQL image')
    const target = { ...spec, id: actual.id, image: actual.image, imageId: actual.imageId, kind: 'source' }
    this.#sources.set(target.id, target)
    try {
      const info = await this.json(target, "SELECT json_build_object('db',current_database(),'user',current_user,'major',current_setting('server_version_num')::int/10000)")
      if (info.db !== spec.db || info.user !== spec.user || info.major !== spec.major) throw fail('Source database, role or PostgreSQL major mismatch')
      return target
    } catch (error) { this.#sources.delete(target.id); throw error }
  }
  async #assertClone(target, runId = target?.runId) {
    const known = this.#targets.get(target?.id)
    if (!known || !RUN.test(runId ?? '') || known.runId !== runId || target.name !== known.name || target.domain !== known.domain) throw fail('Container is not owned by this recovery run')
    const actual = await this.#inspect(known.id)
    if (actual.id !== known.id || actual.name !== known.name || actual.imageId !== known.imageId || actual.labels?.[LABEL] !== runId
      || actual.labels?.['app.xijie.recovery.domain'] !== known.domain || actual.networkMode !== 'none'
      || Object.keys(actual.ports ?? {}).length || (actual.mounts ?? []).some(mount => mount.Type !== 'tmpfs')) throw fail('Recovery container isolation or ownership changed')
    return actual
  }
  async sql(target, sql) {
    const known = this.#known(target)
    if (typeof sql !== 'string' || !sql.trim() || sql.includes('\0')) throw fail('Invalid SQL input')
    if (known.kind === 'target') await this.#assertClone(known)
    const options = '-c timezone=UTC -c datestyle=ISO,YMD' + (known.kind === 'source' ? ' -c default_transaction_read_only=on' : '')
    return (await this.#run(['exec', '-i', known.id, 'env', 'PGOPTIONS=' + options, 'psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', known.user, '-d', known.db], sql + '\n', { operation: 'Database operation' })).stdout.trim()
  }
  async assertIsolatedTarget(target) {
    const known=this.#known(target)
    if(known.kind!=='target')throw fail('Security replay cannot target a source container')
    await this.#assertClone(known)
  }
  async json(target, sql) {
    const value = await this.sql(target, sql)
    try { return JSON.parse(value) } catch { throw fail('Database did not return one JSON value') }
  }
  async query(target, sql) {
    const select = sql.trim().replace(/;+\s*$/, '')
    if (!/^(?:SELECT|WITH)\b/i.test(select)) throw fail('query requires a SELECT statement')
    const rows = await this.json(target, "SELECT COALESCE(json_agg(q),'[]'::json) FROM (" + select + ') q')
    if (!Array.isArray(rows)) throw fail('Database query did not return rows')
    return rows
  }
  spawnDump(source) {
    const known = this.#known(source)
    if (known.kind !== 'source') throw fail('Backup requires an inspected source')
    const args = ['exec', known.id, 'env', 'PGOPTIONS=-c timezone=UTC -c datestyle=ISO,YMD -c default_transaction_read_only=on', 'pg_dump', '-U', known.user, '-d', known.db, '--format=custom']
    if (known.domain !== 'logto') args.push('--no-owner', '--no-acl')
    return this.#spawn(args)
  }
  async roles(source) {
    const known = this.#known(source)
    if (known.kind !== 'source') throw fail('Role backup requires an inspected source')
    return (await this.#run(['exec', known.id, 'pg_dumpall', '-U', known.user, '--roles-only', '--no-role-passwords'], undefined, { limit: 4 * 1024 * 1024, operation: 'Role dependency backup' })).stdout
  }
  async #privateDirectory(runId) {
    const expectedRoot = await fs.realpath(this.root)
    let current = expectedRoot
    for (const segment of ['.tmp', 'recovery-dev', 'runtime', runId]) {
      current = path.join(current, segment)
      let stat
      try { stat = await fs.lstat(current) } catch (error) {
        if (error.code !== 'ENOENT') throw error
        await fs.mkdir(current, { mode: 0o700 }); stat = await fs.lstat(current)
      }
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw fail('Recovery scratch path contains a link or non-directory')
      const resolved = await fs.realpath(current)
      if (resolved !== current || path.relative(expectedRoot, resolved).startsWith('..')) throw fail('Recovery scratch path escaped the workspace')
    }
    const directory = current
    const actual = await fs.realpath(directory)
    await privateFilePermissions(actual)
    return actual
  }
  async createTarget(source, runId) {
    if (!RUN.test(runId ?? '')) throw fail('Invalid isolated restore run ID')
    // Restore accepts authenticated archive metadata even if the original container no longer exists.
    // It does not register that metadata as a live source, so dump/sql cannot use it to reach a source DB.
    const spec = SOURCE_SPECS.find(item => item.domain === source?.domain)
    if (!spec || !ID.test(source.id ?? '') || !/^sha256:[a-f0-9]{64}$/.test(source.imageId ?? '')
      || !new RegExp('^postgres:' + spec.major + '(?:[.-]|$)').test(source.image ?? '')
      || ['name', 'project', 'service', 'db', 'user', 'major'].some(key => source[key] !== spec[key])) throw fail('Restore metadata differs from the source allowlist')
    await this.#nativeImage(source.imageId, spec.major)
    const known = { ...source, ...spec, kind: 'source' }
    const nonce = randomBytes(4).toString('hex'), name = 'xijie-recovery-' + runId + '-' + known.domain + '-' + nonce
    const directory = await this.#privateDirectory(runId), envFile = path.join(directory, 'postgres-' + nonce + '.env')
    const password = randomBytes(32).toString('hex')
    await fs.writeFile(envFile, 'POSTGRES_USER=' + known.user + '\nPOSTGRES_DB=' + known.db + '\nPOSTGRES_PASSWORD=' + password + '\nPOSTGRES_INITDB_ARGS=--auth-local=trust --auth-host=scram-sha-256\n', { flag: 'wx', mode: 0o600 })
    let target
    try {
      const result = await this.#run(['run', '--detach', '--name', name, '--label', LABEL + '=' + runId, '--label', 'app.xijie.recovery.domain=' + known.domain,
        '--network', 'none', '--read-only', '--pids-limit', '128', '--tmpfs', '/var/lib/postgresql/data:rw,nosuid,nodev', '--tmpfs', '/var/run/postgresql:rw,nosuid,nodev', '--tmpfs', '/tmp:rw,nosuid,nodev', '--env-file', envFile, known.imageId], undefined, { operation: 'Isolated PostgreSQL creation' })
      const id = result.stdout.trim()
      if (!ID.test(id)) throw fail('Docker did not return a container ID')
      target = { ...known, id, name, image: known.imageId, kind: 'target', runId, project: null, service: null }
      this.#targets.set(id, target)
      await this.#assertClone(target)
      await fs.unlink(envFile)
      let ready = false
      for (let attempt = 0; attempt < 100; attempt++) {
        const pid = await this.#run(['exec', id, 'sh', '-c', 'test "$(cat /proc/1/comm)" = postgres'], undefined, { allowFailure: true, operation: 'PostgreSQL initialization' })
        if (pid.code === 0) {
          try {
            const info = await this.json(target, "SELECT json_build_object('db',current_database(),'user',current_user,'major',current_setting('server_version_num')::int/10000)")
            if (info.db !== known.db || info.user !== known.user || info.major !== known.major) throw fail('Isolated PostgreSQL identity mismatch')
            ready = true; break
          } catch { /* Initialization may still be finishing; no source connection is used. */ }
        }
        await sleep(200)
      }
      if (!ready) throw fail('Isolated PostgreSQL did not become ready')
      return target
    } catch (error) {
      let cleanupError
      try {
        if (!target) {
          const actual = await this.#inspect(name).catch(() => undefined)
          if (actual) target = await this.#adopt(actual, runId, known.domain)
        }
        if (target) await this.remove(target, runId)
      } catch (problem) { cleanupError = problem }
      if (cleanupError) throw new AggregateError([error, cleanupError], 'Restore creation failed and cleanup is incomplete; inspect recovery run ' + runId)
      throw error
    } finally {
      try { await fs.unlink(envFile) } catch (error) { if (error.code !== 'ENOENT') throw fail('Private bootstrap file cleanup failed for recovery run ' + runId) }
    }
  }
  writeArchive(target) {
    const known = this.#known(target)
    if (known.kind !== 'target') throw fail('Archive staging requires an isolated target')
    return this.#spawn(['exec', '-i', known.id, 'sh', '-c', 'umask 077; set -C; cat > ' + ARCHIVE])
  }
  async restore(target, rolesSql) {
    const known = this.#known(target)
    if (known.kind !== 'target') throw fail('Restore cannot target a source container')
    await this.#assertClone(known)
    if (rolesSql) {
      if (typeof rolesSql !== 'string' || /\bPASSWORD\s+'[^']+'/i.test(rolesSql)) throw fail('Role backup contains a password clause')
      const existing = new Set((await this.query(known, 'SELECT rolname FROM pg_roles')).map(row => row.rolname))
      const filtered = rolesSql.split(/\r?\n/).filter(line => {
        const match = /^CREATE ROLE (.+);$/.exec(line)
        if (!match) return true
        const raw = match[1], role = /^"(?:[^"]|"")*"$/.test(raw) ? raw.slice(1, -1).replace(/""/g, '"') : /^[a-z_][a-z0-9_$]*$/.test(raw) ? raw : null
        if (role === null) throw fail('Unexpected role identifier')
        return !existing.has(role)
      }).join('\n')
      await this.sql(known, filtered)
    }
    const args = ['exec', known.id, 'env', 'PGOPTIONS=-c timezone=UTC -c datestyle=ISO,YMD', 'pg_restore', '--exit-on-error', '--single-transaction', '-U', known.user, '-d', known.db]
    if (known.domain !== 'logto') args.push('--no-owner', '--no-acl')
    args.push(ARCHIVE)
    try { await this.#run(args, undefined, { operation: 'Isolated archive restore' }) }
    finally { await this.#run(['exec', known.id, 'rm', '-f', ARCHIVE], undefined, { operation: 'Restore staging cleanup' }).catch(() => {}) }
  }
  async remove(target, runId) {
    const known = this.#known(target)
    if (known.kind !== 'target') throw fail('Refusing to remove a source container')
    await this.#assertClone(known, runId)
    await this.#run(['rm', '--force', known.id], undefined, { operation: 'Owned restore container cleanup' })
    this.#targets.delete(known.id)
  }
  async cleanupRun(runId) {
    if (!RUN.test(runId ?? '')) throw fail('Invalid recovery cleanup run ID')
    const result = await this.#run(['ps', '--all', '--quiet', '--no-trunc', '--filter', 'label=' + LABEL + '=' + runId], undefined, { operation: 'Recovery orphan discovery' })
    const ids = result.stdout.trim() ? result.stdout.trim().split(/\s+/) : []
    if (ids.some(id => !ID.test(id))) throw fail('Invalid orphan container identifier')
    const targets = []
    // Validate the complete set before deleting anything, then recheck each target in remove().
    for (const id of ids) targets.push(await this.#adopt(await this.#inspect(id), runId))
    for (const target of targets) await this.remove(target, runId)
    return { removed: targets.length }
  }
}
