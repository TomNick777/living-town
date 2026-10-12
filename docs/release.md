# 发布与维护

本仓库从审查后的源码与合成 fixture 创建独立公开快照，不携带原本机仓库历史。
私有账单、数据库、分类规则、旧运行审计和迁移演练不在发布文件清单内。

发布前运行：

```bash
python -m pytest
python scripts/build_demo.py --check
python scripts/audit_release.py
cd web
npm test
npm run build
```

人工检查根入口与仓库子路径、月报、流水筛选/分页、年度切换、手机画面与错误提示。
公开截图只能使用合成数据。不要把用户账本快照导出到 `web/public/`。

GitHub 仓库使用 `main`。第一次部署需在 Settings → Pages 选择 GitHub Actions。
Pages workflow 上传 `web/dist`；默认相对 asset path 支持 `/living-town/`。
测试与部署分开，部署 job 等待同一次 workflow 的验证成功。

MIT 许可证与来源说明随源码发布。项目停止扩展功能；修复后更新
`PROJECT_STATE.md`，注明本轮实际验证结果，提交前后审查 Git diff/status。
