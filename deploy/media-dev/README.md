# Local private photo service

The authoritative Compose file is `compose.yaml`; local private settings are `.tmp/media-dev/compose.env` and `.tmp/media-dev/server.env`. Media's API is `127.0.0.1:3106`, PostgreSQL is bound only at `127.0.0.1:5438`, and the private S3 endpoint is `127.0.0.1:8333`. No filer, master or administration endpoint is published. The existing external `xijie-identity-dev_default` network avoids allocating another default Docker subnet.

SeaweedFS is pinned to official `ghcr.io/chrislusf/seaweedfs:4.53` (release image manifest digest `sha256:ccad23e18639c8b98cee17e7100b95830a06077b56d8e5b006d6dcf8ec5e94a0`). The official release workflow publishes this GHCR image and mirrors it to Docker Hub. Local validation used GHCR because the Docker Hub registry returned EOF; no daemon-wide mirror or network setting was modified. The `mini` process persists its private bytes/configuration in the dedicated object volume and initializes credentials from private environment values. Never print `docker compose config` or the complete container environment when debugging credentials.

```powershell
Set-Location -LiteralPath 'D:/AI/xijie figma'
docker compose --project-name xijie-media-dev --env-file .tmp/media-dev/compose.env -f deploy/media-dev/compose.yaml up -d --wait
```

Do not reset volumes or run this development stack as an unauthenticated/public object store. Check an anonymous S3 request is denied and the configured bucket exists before starting Media. CORS or a presigned URL is not application ownership authorization; this slice uploads and reads through the authenticated Media API and does not return S3 keys or credentials to the client.

Deploy source services first: Identity with `009` photo permission support, Social with its new ordered attachment/source-validation migration, and the new Media database with `001_media.sql`. The original notice 4, text-storage 2 and AI 3 permissions remain separate. A user explicitly allows `private_photo_storage` in the original privacy panel. Run Media API and its processing Worker independently using the same private Media configuration, then start the original Web frontend in service mode with the Media proxy configured. See [Media service operations](../../backend/services/media/README.md).

This environment is for local source/API/browser integration. The independent S3 probe has already passed put/head/get/delete, anonymous denial, conditional-write, signature/CORS and persistent-volume restart checks; Media has 15 real isolated database/S3/Sharp/HTTP tests. Successful process startup does not imply an image was published, nor do database-only backups prove object recovery. Actual original-page and recovery acceptance is tracked in [delivery status](../../docs/backend-delivery-priorities.md).

Primary sources: [SeaweedFS release workflow](https://github.com/seaweedfs/seaweedfs/blob/4.53/.github/workflows/container_release_unified.yml), [Mini credentials and storage flags](https://github.com/seaweedfs/seaweedfs/blob/4.53/weed/command/mini.go), [AWS S3 SDK](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/javascript_s3_code_examples.html), [Sharp constructor](https://sharp.pixelplumbing.com/api-constructor/).
