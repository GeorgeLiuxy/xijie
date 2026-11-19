import type { RightsConfig, RightsDomain } from "./rights-config.js"

import { RightsError, digest, type RightsRow, type Snapshot } from "./rights.js"

export class RightsDependencies {
  constructor(
    readonly config: RightsConfig,
    readonly fetcher: typeof fetch = globalThis.fetch,
  ) {}

  private async request(url: URL, init: RequestInit, signal?: AbortSignal) {
    let response: Response
    try {
      response = await this.fetcher(url, {
        ...init,
        redirect: "error",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(10000)])
          : AbortSignal.timeout(10000),
      })
    } catch {
      throw new RightsError(503, "DEPENDENCY_UNAVAILABLE")
    }
    return response
  }

  async financialPreflight(row:RightsRow,signal?:AbortSignal){
    if(!this.config.giftsUrl)throw new RightsError(503,'DEPENDENCY_UNAVAILABLE')
    const response=await this.request(new URL('/internal/v1/accounts/'+row.account_id+'/erase-preflight',this.config.giftsUrl),{method:'POST',headers:{Authorization:'Bearer '+this.config.serviceToken,'Idempotency-Key':row.id,'Content-Type':'application/json'},body:JSON.stringify({requestId:row.id})},signal)
    let body:any;try{body=await response.json()}catch{throw new RightsError(503,'DEPENDENCY_UNAVAILABLE')}
    if(!response.ok){const code=body?.error?.code;if(['FINANCIAL_RECONCILIATION_REQUIRED','FINANCIAL_RETENTION_POLICY_REQUIRED'].includes(code))throw new RightsError(409,code);throw new RightsError(503,'DEPENDENCY_UNAVAILABLE')}
    const value=body?.data
    if(!value||value.accountId!==row.account_id||value.requestId!==row.id||value.allowed!==true||!Number.isFinite(Date.parse(value.checkedAt))||!validFinancialRetention(value.financialRetention))throw new RightsError(503,'DEPENDENCY_UNAVAILABLE')
    return{checkedAt:value.checkedAt,financialRetention:value.financialRetention}
  }

  async snapshot(
    domain: RightsDomain,
    row: RightsRow,
    signal?: AbortSignal,
  ): Promise<Snapshot> {
    const base =
        this.config[
          ((domain + "Url") as "peopleUrl" | "conversationsUrl" | "memoriesUrl" | "socialUrl" | "mediaUrl" | "giftsUrl")
        ]
    if (!base) throw new RightsError(503, 'DEPENDENCY_UNAVAILABLE')
    const url = new URL(
        "/internal/v1/accounts/" + row.account_id + "/data-export",
        base,
      )
    url.searchParams.set("requestId", row.id)
    url.searchParams.set("scope", row.scope)
    const response = await this.request(
      url,
      { headers: { Authorization: "Bearer " + this.config.serviceToken } },
      signal,
    )
    if (!response.ok)
      throw new RightsError(
        response.status === 413 ? 413 : 503,
        response.status === 413 ? "EXPORT_TOO_LARGE" : "DEPENDENCY_UNAVAILABLE",
      )
    const reader = response.body?.getReader(),
      chunks: Uint8Array[] = []
    let size = 0
    if (!reader) throw new RightsError(503, "DEPENDENCY_UNAVAILABLE")
    while (true) {
      const item = await reader.read()
      if (item.done) break
      size += item.value.byteLength
      if (size > 21 * 1024 * 1024) {
        await reader.cancel()
        throw new RightsError(413, "EXPORT_TOO_LARGE")
      }
      chunks.push(item.value)
    }
    const buffer = Buffer.concat(chunks)
    let value: Snapshot
    try {
      value = JSON.parse(Buffer.from(buffer).toString()).data
    } catch {
      throw new RightsError(503, "DEPENDENCY_UNAVAILABLE")
    }
    if (
      !value ||
      value.schemaVersion !== 1 ||
      value.accountId !== row.account_id ||
      value.domain !== domain ||
      !/^[a-f0-9]{64}$/.test(value.revision) ||
      !Number.isFinite(Date.parse(value.capturedAt)) ||
      value.data === undefined ||
      digest(JSON.stringify(value.data)) !== value.revision
    )
      throw new RightsError(503, "DEPENDENCY_UNAVAILABLE")
    return value
  }

  async erase(
    domain: RightsDomain,
    row: RightsRow,
    signal?: AbortSignal,
  ) {
    const base =
      this.config[
        ((domain + "Url") as "peopleUrl" | "conversationsUrl" | "memoriesUrl" | "socialUrl" | "mediaUrl" | "giftsUrl")
      ]
    if (!base) throw new RightsError(503, 'DEPENDENCY_UNAVAILABLE')
    const response = await this.request(
      new URL("/internal/v1/accounts/" + row.account_id + "/erase", base),
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + this.config.serviceToken,
          "Idempotency-Key": row.id,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ requestId: row.id }),
      },
      signal,
    )
    if (!response.ok) throw new RightsError(503, "DEPENDENCY_UNAVAILABLE")
    const value = (await response.json()).data
    if (
      !value ||
      value.accountId !== row.account_id ||
      value.requestId !== row.id ||
      !Number.isFinite(Date.parse(value.erasedAt)) ||
      typeof value.alreadyErased !== "boolean"
    )
      throw new RightsError(503, "DEPENDENCY_UNAVAILABLE")
    if(domain==='gifts'&&!validFinancialRetention(value.financialRetention))throw new RightsError(503,'DEPENDENCY_UNAVAILABLE')
    return { erasedAt: value.erasedAt,...(domain==='gifts'?{financialRetention:value.financialRetention}:{}) }
  }

  async deleteProviderIdentity(
    identity: { issuer: string; subject: string },
    signal?: AbortSignal,
  ) {
    const c = this.config
    if (
      !c.deleteProviderUsers ||
      !c.managementClientId ||
      !c.managementClientSecret
    )
      throw new RightsError(503, "IDENTITY_PROVIDER_DELETE_NOT_CONFIGURED")
    if (identity.issuer.replace(/\/$/, "") !== c.issuer.href.replace(/\/$/, ""))
      throw new RightsError(503, "UNSUPPORTED_IDENTITY_PROVIDER")
    const response = await this.request(
      new URL(c.issuer.origin + "/oidc/token"),
      {
        method: "POST",
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(
              c.managementClientId + ":" + c.managementClientSecret,
            ).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          resource: c.managementResource,
          scope: "all",
        }),
      },
      signal,
    )
    if (!response.ok)
      throw new RightsError(503, "IDENTITY_PROVIDER_DELETE_FAILED")
    const token = (await response.json()) as {
      access_token?: string
      token_type?: string
    }
    if (
      typeof token.access_token !== "string" ||
      !token.access_token ||
      token.token_type?.toLowerCase() !== "bearer"
    )
      throw new RightsError(503, "IDENTITY_PROVIDER_DELETE_FAILED")
    const deleted = await this.request(
      new URL(
        "/api/users/" + encodeURIComponent(identity.subject),
        c.issuer.origin,
      ),
      {
        method: "DELETE",
        headers: { Authorization: "Bearer " + token.access_token },
      },
      signal,
    )
    if (deleted.status !== 204 && deleted.status !== 404)
      throw new RightsError(503, "IDENTITY_PROVIDER_DELETE_FAILED")
  }
}

function validFinancialRetention(value:any){return value?.status==='none'||value?.status==='retained'&&/^[a-f0-9-]{36}$/i.test(value.archiveId)&&/^[-a-zA-Z0-9._]{1,80}$/.test(value.policyVersion)&&Number.isFinite(Date.parse(value.retainUntil))}
