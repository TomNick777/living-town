# Living Town 前端

默认入口是全合成作品集展示：总览、月报、流水。React / TypeScript / Vite /
Three.js。统一的 demo transport 读取 Python 生成的 `public/demo/ledger.json`，
原有 adapters 校验同一 JSON 契约。浏览器筛选与分页只选择记录，不计算财务金额。

```bash
npm ci
npm run dev
npm test
npm run build
npm run preview
```

`?local` 显式连接 localhost world service；本机开发由 Vite `/api` proxy 转发。
`?workbench` 保留 SVG 工作台。公开站点不启动后端，服务错误不会切换数据源。
旧 `?demo` / `?townDemo` 链接均进入统一展示，不再维护第二套单页。

构建默认使用相对资源路径，适合 GitHub Pages 子目录。
可通过 `LIVING_TOWN_BASE` 指定部署根路径。preview 明确关闭 API proxy。

`src/showcase` 管页面与 transport，`town/adapter` 校验数据，`town/visual` 生成
视觉等级，`town/replay` 管展示时钟和人物，`showcase/town3d` 管程序几何与渲染。
SVG / world modules 作为本机维护能力保留，按需加载。
