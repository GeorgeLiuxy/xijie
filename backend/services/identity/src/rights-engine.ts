import {
  RightsError,
  RightsStore,
  type Dispatch,
  type RightsRow,
  type Snapshot,
} from "./rights.js"
import { RightsDependencies } from "./rights-provider.js"
import { rightsDomains } from './rights-config.js'
export class RightsEngine {
  private stopping = false
  private active = new Set<AbortController>()
  constructor(
    readonly store: RightsStore,
    readonly dependencies: RightsDependencies,
  ) {}
  async snapshots(row: RightsRow, signal?: AbortSignal): Promise<Snapshot[]> {
    return [
      await this.store.ownSnapshot(row.account_id, row.scope),
      ...(await Promise.all(
        rightsDomains(this.store.config).map((domain) =>
          this.dependencies.snapshot(domain, row, signal),
        ),
      )),
    ]
  }
  async run(dispatch: Dispatch) {
    if (this.stopping) throw new Error("Worker stopping")
    const row = await this.store.claim(dispatch)
    if (!row) return
    if(this.stopping){await this.store.release(row);throw new Error('Worker stopped during claim')}
    const controller = new AbortController()
    this.active.add(controller)
    const timer = setTimeout(() => controller.abort(), 80000).unref()
    try {
      if (row.kind === "export")
        await this.store.exportComplete(
          row,
          await this.snapshots(row, controller.signal),
        )
      else {
        // This global gate runs before any domain is erased, including every
        // retry. An accepted deletion blocks new account financial activity.
        if(this.store.config.giftsUrl)await this.store.progress(row,'financialPreflight',await this.dependencies.financialPreflight(row,controller.signal))
        for (const domain of rightsDomains(this.store.config))
          if (!row.progress[domain])
            await this.store.progress(
              row,
              domain,
              await this.dependencies.erase(domain, row, controller.signal),
            )
        if (!row.progress.provider) {
          for (const identity of await this.store.identities(row.account_id))
            await this.dependencies.deleteProviderIdentity(
              identity,
              controller.signal,
            )
          await this.store.progress(row, "provider", {
            deletedAt: new Date().toISOString(),
          })
        }
        await this.store.deletionComplete(row)
      }
    } catch (error) {
      if (this.stopping) {
        await this.store.release(row)
        throw new Error("Data rights worker stopped")
      }
      await this.store.fail(
        row,
        error instanceof RightsError
          ? error.code
          : controller.signal.aborted
            ? "PROCESSING_TIMEOUT"
            : "DEPENDENCY_UNAVAILABLE",
      )
    } finally {
      clearTimeout(timer)
      this.active.delete(controller)
    }
  }
  stop() {
    this.stopping = true
    for (const controller of this.active) controller.abort()
  }
}
