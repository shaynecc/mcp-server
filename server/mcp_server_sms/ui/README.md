# 短信 MCP Apps

七种表单由同一个自包含 HTML 资源承载。使用官方 MCP Apps SDK 的 AppBridge 调用本服务工具，不依赖 localhost HTTP 或浏览器存储。文件使用服务端下发的单文件能力直传 ImageX/TOS，账号 AK/SK 不进入页面。

`src/styles/{qualification,signature,traffic,batch}.css` 原样复制自 byted-sms-sender 1.4.6 对应的 `*_wizard.css`（参考仓库提交 e3d7e1f997671590cb1c26d1977f0dcd19abcba2）。布局和组件沿用 React 18.2.0、Arco 2.66.15；窄屏、对话卡片和主题覆盖在 `host.css` 中维护。这里的构建和运行都不读取或修改 Skill。

图片附件支持本地缩略图和点击放大，保留原上传控件、表单布局和业务调用。选中图片后预览本地 File，上传成功后在页面保留 Blob；预填 Base64 图片直接预览。替换、移除或页面卸载会释放 Blob URL，切回步骤时可从页面内的 Blob 恢复预览。只有远端文件引用时仍显示文件名，不额外查询 ImageX/TOS。预览数据不会进入业务提交或模型摘要。

材料上传按 ImageX [固定上传入口](https://www.volcengine.com/docs/508/1537728)协议执行：`PUT /<StoreUri>`，携带 `Authorization`、`Content-CRC32` 和 `Specified-Content-Type`，响应 `success: 0` 后再提交上传确认。`form_config.json` 的 `materialUpload.uploadHosts` 首项是实际入口（全球加速），区域入口保留供配置切换；服务端、前端和 CSP 共用该配置。ImageX 返回的动态 `UploadHosts` 不再作为上传目标，也不再逐一匹配历史域名。没有自动换域名重试。升级后应重新打开已有表单，加载对应上传协议的新版页面。

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

签名页面沿用 Skill 的“签名信息 → 资质材料”两步结构及 Arco `Select/Input/Upload/Modal` 组件。签名归属筛选可用资质；已预填的有效资质及归属锁定，唯一候选自动填入企业全称。发送类型固定 `CN_OTP/CN_NTC/CN_MKT`，公司、APP、商标的字段、材料格式和名称规则与 Skill 一致。所有材料分类合计最多五份，单文件沿用 MCP 的 10 MB 限制；预填材料需要上传后才能核对，当前来源以外的附件不进入申请。项目名称只保留预填值，不额外增加 Skill 没有的表单项。

核对申请后普通名称可“确认提交”；名称未连续出现在企业全称中时，必须通过“强制提交”的 Arco 确认弹窗接受风险。修改字段或材料会撤销预览，已知失败可重新核对，未知写结果锁定编辑和重试。放弃填写只清理当前页面草稿并报告结束。结果页沿用 `ListSignaturesForAgent` 刷新审核状态。`signature.test.jsx` 覆盖这些行为及原生参数、附件引用、批量上传和提交防重。

引流页面沿用 Skill 的 Arco `Select/Input/Alert/Button` 控件和录入、预览布局，布尔短链选择、协议、七种号码类型、个人证件及企业字段保持一致。自有链接支持选填跳转信息，火山短链只提交跳转分支；域名和 Path 自动解析并只读回显，完整链接保留原值和查询参数。预填号码推断类型，文案链接自动识别协议，号码格式和必填错误显示在字段旁。开表已指定 `kind` 时固定资源类型；未指定时可在页面选择链接或号码。

“预览录入内容”继续调用 `preview_traffic_resource` 校验格式、协议及重复项，通过后才显示“确认录入”。编辑、添加、移除或切换类型均撤销旧预览；已知提交失败需重新预览，未知写结果锁定编辑和重试。链接最多十条、号码最多一百条，提交仍使用 MCP 的两个 `BulkCreateTobTrafficDriving*ForAgent` 接口；按原生空字符串响应报告受理，不自动回查资源 ID。结束本次录入清除页面草稿并报告结束，私密字段只在页面及业务请求中使用，模型摘要只含类型和数量。`traffic.test.jsx` 覆盖原生字段、分支隔离、格式校验、预览撤销及失败处理。

MCP 宿主可能不允许原生表单提交，签名页的“下一步”和“核对申请”、引流页的“预览录入内容”直接通过按钮事件执行；普通输入框的 Enter 同样触发页面动作。交互不依赖 iframe 的 `allow-forms` 权限，回归测试同时覆盖宿主阻断原生 `submit` 时的按钮与 Enter 操作。

本地样式预览不进行文件上传，也不伪装成功；上传行为由 `uploads.test.jsx` 的合成大文件与模拟 HTTP 回归验证。真实宿主测试需单独授权。

普通发送和群发试发仅把用户确认的原生发送参数交给 MCP，展示用模板正文留在页面，不在提交前再次查询。群发核对复用已选模板及 CSV 列定义，文件、列定义或引流正文改变时重新检查；上传账号绑定、文件完整性和一次回读保留。引流录入按接口受理结果展示，不再等待逐条资源 ID 回读。
