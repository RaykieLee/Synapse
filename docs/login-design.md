# 登录页设计实现

参考用户提供的登录页面截图，采用黑白插画、薄荷绿点缀、双栏布局与中文表单。页面入口为 `/sign-in`，旧 `/sign-in-2` 跳转至该入口。

## 文件

- `apps/web/src/features/auth/sign-in/index.tsx`：品牌、介绍、人物插画、浮动卡片、帮助及政策说明。
- `apps/web/src/features/auth/sign-in/sign-in.css`：响应式布局、焦点状态、入场及浮动动画；支持 `prefers-reduced-motion`。
- `apps/web/src/features/auth/sign-in/components/user-auth-form.tsx`：账号密码表单、验证、密码显隐、记住用户名及登录反馈。
- `apps/web/src/features/auth/sign-in/assets/digital-teammates.png`：生成的人物插画。

## 接口与交互范围

沿用 `POST /api/v1/auth/login`，请求字段为 `user_name`、`password`。成功后更新现有认证状态并导航至站内目标页面。记住账号仅保存用户名，不保存密码。

验证码、企业 SSO、密码找回尚无对应后端能力，入口通过对话框说明当前状态。用户协议和隐私政策尚未配置正式内容，页面展示明确说明，不宣称用户已接受未提供的条款。

## 插画来源

使用内置 image_gen 生成，以用户截图作为风格及姿势参考。浮动卡片和文字使用 HTML/CSS 独立实现。

生成提示词：

> Use case: illustration-story. Create a production website hero illustration asset inspired by the attached reference screenshot, ONLY the illustrated trio of digital coworkers, no website UI. Landscape composition 3:2, pure white background. Elegant black ink editorial line art, bold black hair and white blazers, tiny mint green accent details. Three friendly East Asian office teammates shown waist-up: central large woman with chin-length black bob holding a clipboard, left young man with round glasses holding a tablet, right woman with hair in a bun lifting an open hand while holding a tablet. Central woman's right sleeve dissolves into subtle fine gray geometric mesh and small black squares. Modern premium monochrome hand-drawn illustration, calm professional expressions, natural anatomy. Bottom of figures fades gently into pure white. Match the screenshot's character poses, proportions, line weight and charming visual style. Exclude ALL text, captions, logos, page headings, login controls, floating UI cards, decorative orbit lines; those will be implemented in HTML. Keep the three people filling the asset with minimal whitespace.

提示词含义：依据截图生成三位黑白线稿数字同事，中心人物持任务板，左右人物持平板，衣袖带几何网格消散效果，纯白背景和少量薄荷绿点缀；排除界面文字与浮动卡片，由网页代码实现。

## 左侧动效增强

人物插画以 6 秒周期轻微起伏，Alex 卡片以 4.8 秒周期错峰浮动。任务板三个勾选依次完成，流程节点顺序发光，衣袖附近 8 个小方块向外飘散，轨道光点和十字装饰缓慢旋转。全部采用 CSS 动画，不轮询接口；系统启用减少动态效果时停止动画。
