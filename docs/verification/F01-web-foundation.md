# F01 — Web 基础验收

**日期：** 2026-10-01（复查）  
**范围：** 仅验收 `Synapse/apps/web` 基础架构。检查前端脚手架，不涉及 Synapse 身份认证、后端集成或业务行为。

## 结果

| 检查项 | 结果 | 证据 |
|---|---|---|
| 生产构建 | **通过** | 重新运行 `pnpm build`：`tsc -b && vite build` 成功完成；Vite 8.0.8 转换 3,974 个模块，耗时 450 ms。 |
| 本地开发服务器 | **通过** | `pnpm dev --host 127.0.0.1 --port 4173 --strictPort` 成功启动；上次运行中的 `curl -I http://127.0.0.1:4173/` 返回 HTTP 200 和 SPA HTML。 |
| 技术栈识别 | **通过** | React 19、TypeScript 6、Vite 8、TanStack Router/Query/Table、Tailwind CSS 4、Radix UI 和 shadcn 风格组件；依赖与脚本见 `package.json`。 |
| 来源标注与许可证 | **通过** | README 说明项目基于 [shadcn-admin](https://github.com/satnaing/shadcn-admin)；原始 MIT `LICENSE` 文件保留了 Sat Naing 版权声明和许可条款。 |
| 源代码 `.git` 副本 | **通过** | `apps/web` 下不存在 `.git` 路径。本工作区中的 Synapse 上级目录不是 Git checkout，因此无法检查上级 Git 状态。 |
| 疑似密钥文件 | **通过，有限扫描** | 环境文件中只有 `.env.example`，内容为 `VITE_API_BASE_URL=/api/v1`。安装依赖和构建输出目录之外，未发现 `.pem`、`.key`、`credentials*` 或 `secrets*` 文件。 |
| 外壳中的模板品牌标识 | **复查通过** | `profile-dropdown.tsx` 和 `sidebar-data.ts` 现在使用明确标注的 Synapse 演示身份。测试 fixture 中旧模板邮箱和 `index.html` 社交图片引用均已移除。`shadcn-admin` 仅作为 README 中的来源标注保留。 |
| 浏览器渲染 | **通过（视觉外壳检查）** | 安装 Playwright Chromium 测试运行时（未更改应用依赖），通过无头浏览器访问 Vite `http://127.0.0.1:4173/`，检查桌面端（1440×1000）和移动端（390×844）。两者均渲染 Synapse dashboard；无页面错误，也无横向溢出。截图：任务工作区中的 `work/F01-web-foundation.png` 和 `work/F01-web-foundation-mobile.png`。 |

## 发现

1. **身份认证仍仅为演示。** README 表示 Synapse 身份认证和业务 API 将在后续集成，模板认证演示不是 Synapse 身份提供方。模拟登录不能证明真实登录或授权有效。
2. **Dashboard 数值和销售行是演示内容。** 页面显示模板 dashboard 数据（例如 `$45,231.89` 收入以及示例客户姓名/邮箱）。这只能确认脚手架可显示，不能证明已接入 Synapse 业务数据。

## 通过范围

Web 基础架构能够构建，并在本地提供 SPA 入口。来源标注和 MIT 许可证均保留；未发现复制的 Git 元数据或明显的私钥/凭据文件；此前报告的演示个人资料/模板社交图片残留问题已解决。已检查桌面端和移动端截图；在检查的宽度下，基础 dashboard 外壳均正常显示，没有浏览器控制台/页面错误或横向溢出。这支持**仅基础架构通过**的结论，不代表真实身份、安全、API 接线或业务工作流已通过；可见指标和销售数据均为演示值。
