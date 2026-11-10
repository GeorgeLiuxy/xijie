# 西界正式后端

该目录用于正式 API、后台任务与数据库迁移，目前处于设计阶段。各客户端共用 `/v1` 契约。账号、消息和订单等业务状态由服务端维护，平台登录、支付、推送的接入差异由各自适配层处理。

- [交互与接口总览](../docs/backend-interaction-inventory.md)
- [后端架构](../docs/backend-architecture.md)
- [API 契约](../docs/backend-api-contract.md)
- [数据模型与一致性规则](../docs/backend-review-data.md)
- [实施顺序](../docs/backend-delivery-priorities.md)

本地原型的礼物、邀请和接力接口位于 [frontend/preview-server/](../frontend/preview-server/)，与前端预览一起启动。
