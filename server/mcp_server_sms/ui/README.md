# 短信 MCP Apps

七种表单由同一个自包含 HTML 资源承载。使用官方 MCP Apps SDK 的 AppBridge 调用本服务工具，不依赖 localhost HTTP 或浏览器存储。文件使用服务端下发的单文件能力直传 ImageX/TOS，账号 AK/SK 不进入页面。

`src/styles/{qualification,signature,traffic,batch}.css` 原样复制自 byted-sms-sender 1.4.6 对应的 `*_wizard.css`（参考仓库提交 e3d7e1f997671590cb1c26d1977f0dcd19abcba2）。布局和组件沿用 React 18.2.0、Arco 2.66.15；窄屏、对话卡片和主题覆盖在 `host.css` 中维护。这里的构建和运行都不读取或修改 Skill。

前端开发使用 Node.js 22.12 或以上版本；部署预构建的 Python wheel 不需要 Node.js。

```bash
npm ci
npm test
npm run build
```

构建输出 `../src/mcp_server_sms/static/forms.html`，由 Python 包随 wheel 分发。业务数据不能写入 HTML。修改前端后需重新构建再打 Python 包。

`npm run dev` 后打开 `/dev/preview.html` 可预览七个表单、窄屏和深色模式。这里使用官方 AppBridge 与跨源双 iframe 沙箱及模拟业务数据。`dev/sandbox.ts` 复用官方 ext-apps 的 basic-host 沙箱。生产构建不包含这些预览代码。构建器生成的 `THIRD_PARTY_LICENSES.md` 随 Python 包分发。

上传使用 `prepare_*` → 存储 HTTPS 直传 → `complete_*`。CSV 直传后在核对任务时调用 `complete_recipients_upload`，一次回读共同完成校验与可选引流检查；相同输入的完整结果可在当前页面复用。`uploads.test.jsx` 使用严格的 32,000 字符宿主模拟与合成大文件回归；真实豆包的 CSP、CORS、上传授权与接口权限需另做联调。文件上传失败允许重选，正式提交结果未知仍锁定。

模型可见工具只查询资源或打开页面，所有业务写入均由页面使用 App-only 工具执行。开表和提交不再共用工具名：`open_qualification_form` / `submit_qualification`、`open_signature_form` / `submit_signature`、`open_traffic_form` / `submit_traffic_resources`、`open_template_form` / `submit_template`、`open_sms_send_form` / `send_sms`。`open_batch_task_form` 的 `prefill` 用于新建，`task` 用于查看和管理已有任务；两者互斥。

签名表单的候选使用 `GetApplySignatureBind` 原生数组，空结果 `null` 表示没有候选；不依赖 `auditStatus/usable`，不分页或逐条补查。预填资质必须出现在该候选数组中。名称风险提示和提交确认在页面完成，提交时只调用 `ApplySmsSignatureV2`，不再次查询资质。

本地样式预览不进行文件上传，也不伪装成功；上传行为由 `uploads.test.jsx` 的合成大文件与模拟 HTTP 回归验证。真实宿主测试需单独授权。

普通发送和群发试发仅把用户确认的原生发送参数交给 MCP，展示用模板正文留在页面，不在提交前再次查询。群发核对复用已选模板及 CSV 列定义，文件、列定义或引流正文改变时重新检查；上传账号绑定、文件完整性和一次回读保留。引流录入按接口受理结果展示，不再等待逐条资源 ID 回读。
