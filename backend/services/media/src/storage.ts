import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  HeadBucketCommand,
} from "@aws-sdk/client-s3"
import { type MediaConfig } from "./config.js"
import { unavailable, MAX_INPUT } from "./contracts.js"
export interface ObjectStorage {
  put(key: string, bytes: Buffer, mime: string): Promise<void>
  get(key: string, max?: number): Promise<Buffer>
  delete(key: string): Promise<void>
  list(prefix: string): Promise<string[]>
  head(key: string): Promise<boolean>
}
export class S3Storage implements ObjectStorage {
  readonly client: S3Client
  constructor(
    readonly config: Pick<MediaConfig, "s3Endpoint" | "s3Bucket" | "s3Region" | "s3AccessKey" | "s3SecretKey">,
  ) {
    this.client = new S3Client({
      endpoint: config.s3Endpoint,
      region: config.s3Region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.s3AccessKey,
        secretAccessKey: config.s3SecretKey,
      },
      maxAttempts: 1,
    })
  }
  async ready() {
    try {
      await this.client.send(
        new HeadBucketCommand({ Bucket: this.config.s3Bucket }),
        { abortSignal: AbortSignal.timeout(15000) },
      )
    } catch {
      throw unavailable()
    }
  }
  async put(key: string, bytes: Buffer, mime: string) {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.config.s3Bucket,
          Key: key,
          Body: bytes,
          ContentType: mime,
          IfNoneMatch: "*",
        }),
        { abortSignal: AbortSignal.timeout(15000) },
      )
    } catch {
      throw unavailable()
    }
  }
  async get(key: string, max = MAX_INPUT) {
    try {
      const v = await this.client.send(
        new GetObjectCommand({ Bucket: this.config.s3Bucket, Key: key }),
        { abortSignal: AbortSignal.timeout(15000) },
      )
      if (!v.Body || !v.ContentLength || v.ContentLength > max)
        throw unavailable()
      const chunks: Buffer[] = []
      let size = 0
      for await (const part of v.Body as AsyncIterable<Uint8Array>) {
        size += part.length
        if (size > max) throw unavailable()
        chunks.push(Buffer.from(part))
      }
      return Buffer.concat(chunks)
    } catch {
      throw unavailable()
    }
  }
  async delete(key: string) {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.config.s3Bucket, Key: key }),
        { abortSignal: AbortSignal.timeout(15000) },
      )
    } catch {
      throw unavailable()
    }
  }
  async head(key: string) {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.config.s3Bucket, Key: key }),
        { abortSignal: AbortSignal.timeout(10000) },
      )
      return true
    } catch (e: any) {
      if (e?.$metadata?.httpStatusCode === 404) return false
      throw unavailable()
    }
  }
  async list(prefix: string) {
    const keys: string[] = []
    let token: string | undefined
    do {
      try {
        const r = await this.client.send(
          new ListObjectsV2Command({
            Bucket: this.config.s3Bucket,
            Prefix: prefix,
            ContinuationToken: token,
            MaxKeys: 1000,
          }),
          { abortSignal: AbortSignal.timeout(15000) },
        )
        keys.push(...(r.Contents ?? []).map((v) => v.Key!).filter(Boolean))
        token = r.IsTruncated ? r.NextContinuationToken : undefined
        if ((r.IsTruncated && !token) || keys.length > 10000)
          throw unavailable()
      } catch {
        throw unavailable()
      }
    } while (token)
    return keys
  }
  close() {
    this.client.destroy()
  }
}
