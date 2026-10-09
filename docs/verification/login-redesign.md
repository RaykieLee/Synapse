# Synapse 登录重设计验证

验证日期：2026-10-06  
范围：登录页面 `1440×1000` 桌面与 `390×844` 移动视口、登录表单交互、登录成功后的导航流程、 reduced motion、前端构建与登录文件 lint。

## 结果

- 桌面与移动视口均无横向溢出：`documentElement.scrollWidth` 与 `body.scrollWidth` 分别等于 viewport 宽度。桌面整页高 1000 px；手机整页高 993 px，可正常纵向滚动。
- 用户名与密码均有真实 `<label>` 关联的 input id；两个输入的 `aria-describedby` 都指向已渲染的说明节点。
- 空表单提交显示“请输入用户名”和“请输入密码”，没有发起登录请求。
- 密码显隐按钮在 `password` 与 `text` 间切换，并更新 `aria-pressed`。
- “记住账号”复选框可以切换状态；登录失败后没有保存用户名，登录成功后保存了用户名 `demo-user`。
- 延迟的模拟 401 登录请求期间，按钮显示“正在登录…”，被禁用并带 `aria-busy=true`。模拟 401 后，页面显示中文错误“用户名或密码错误，请重试。”。
- 帮助中心、验证码登录和企业 SSO 按钮均能打开各自的说明对话框；验证码和 SSO 均明确显示当前尚未开放。
- 启用 `prefers-reduced-motion: reduce` 后，主视觉、浮动卡片和图表动画计算时长均为 `0s`。
- 模拟登录成功后，前端向 `/api/v1/auth/login` 发送 `{ user_name: "demo-user", password: "secret" }`，保存模拟 access token 和记住的用户名，并在模拟 `/api/v1/auth/me` 响应后到达 `/`。
- `pnpm build` 通过；登录页面及表单组件和 `sign-in-2.tsx` 的作用域 ESLint 检查通过。

## 截图

- 桌面：[/Users/kailyn/Documents/Codex/2026-09-30/ji/Synapse/docs/verification/login-redesign/desktop.png](/Users/kailyn/Documents/Codex/2026-09-30/ji/Synapse/docs/verification/login-redesign/desktop.png)
- 移动：[/Users/kailyn/Documents/Codex/2026-09-30/ji/Synapse/docs/verification/login-redesign/mobile.png](/Users/kailyn/Documents/Codex/2026-09-30/ji/Synapse/docs/verification/login-redesign/mobile.png)

## 验证方式与边界

交互验证使用 Playwright Chromium。失败反馈与成功登录均由浏览器请求拦截返回模拟 API 响应，成功流程中的 `/auth/me` 也使用模拟响应。该验证覆盖前端请求 payload、存储行为与路由跳转，不代表真实后端接受凭据或真实登录成功。API 默认代理目标是 `127.0.0.1:8010`，本次登录请求由 Playwright mock 拦截，未用其验证认证服务。

专用 Vite 预览服务运行在 `http://127.0.0.1:5186/sign-in`，应保持运行供人工查看。截图来自该开发预览，页面调试浮层已关闭。

## 动态插画增量复验

在 `prefers-reduced-motion: no-preference` 下，通过 Playwright 连续采样 computed style：人物插画 transform 从 `matrix(1.00778, 0, 0, 1.00778, 0, -5.8225)` 变为 `matrix(0.997799, 0, 0, 0.997799, 0, 2.34649)`；Agent 卡片的纵向位移从约 `-7px` 变为约 `+3px`。卫星旋转矩阵、粒子 transform、工作流节点颜色与光晕均有变化。两次采样中 8 个粒子分别有 6 个和 5 个 opacity 大于 `0.15`。桌面和手机视口仍无横向溢出。

减少动态效果增量复验遍历 `.synapse-login` 及其子元素，计算样式中非 `none` 的 animation 数量为 0，正时长 animation 数量为 0；390 px 视口也未发现横向溢出。

任务动画更新 `animation-fill-mode: both` 后，通过捕获首个任务动画的 `animationstart` 事件，在其后约 0.2 秒、2 秒、4 秒采样：三个图标先全部白色，之后只有第一个变绿，再之后前两个变绿而第三个仍为白色。实际截图确认任务依次点亮。三个采样时刻的动画均正常；8 个粒子中分别有 6、5、5 个 opacity 大于 `0.15`。降低动态效果后仍无横向溢出且动画关闭。

- [动画 0.2 秒](/Users/kailyn/Documents/Codex/2026-09-30/ji/Synapse/docs/verification/login-redesign/animation-sequence-200.png)
- [动画 2 秒](/Users/kailyn/Documents/Codex/2026-09-30/ji/Synapse/docs/verification/login-redesign/animation-sequence-2000.png)
- [动画 4 秒](/Users/kailyn/Documents/Codex/2026-09-30/ji/Synapse/docs/verification/login-redesign/animation-sequence-4000.png)
