# 可选 Evidence bridge

本地 CLI 可在导入后通过 HTTP 登记 evidence / extraction。外部服务不可用时
登记失败不会回滚已经成功的账本导入，并明确报告降级状态。
桥接不直接打开外部数据库，也不改变财务事实。

公开演示构建直接使用账本 import/domain 函数，不调用此桥接、不要求外部服务。
本地幂等由 import_batches 的 hash 缓存承担；跨项目证据身份权威仍遵守 ADR-003。
公开版不包含生产迁移演练与个人运行记录。
