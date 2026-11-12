import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';
import html from '../../src/mcp_server_sms/static/forms.html?raw';
import config from '../../src/mcp_server_sms/form_config.json';

// 仅用于本地可视验证。没有真实 API 客户端、账号凭据或线上请求。
const rank = Object.fromEntries(['isOnlyTwoElement', 'isSkipOtherUse', 'needOtherUseCheck', 'operatorThreeElement', 'needOperatorImage', 'needOperatorMobile', 'responsibleThreeElement', 'needResponsibleImage', 'needResponsibleMobile', 'needBusinessCertificateImage'].map(key => [key, false]));
const group = { subAccountId: 'demo-group', subAccountName: '客户通知' };
const sendPrefill = { signature: '演示科技', templateId: 'demo-template', mobiles: ['13800000000'],
  templateParams: { time: '明天下午三点' } };
const templatePrefill = { name: '预约通知草稿', content: '您预约的服务时间为 ${time}，请准时到店。',
  signatures: ['演示科技'], templateParams: [{ name: 'time', paramType: 1 }] };
const task = { subAccount: 'demo-group', taskId: 'demo-task' };
const scenarios = {
  send: [
    { id: 'missing_group', label: '预填：待补消息组', prefill: sendPrefill },
    { id: 'missing_signature', label: '预填：待补签名', prefill: { ...sendPrefill, subAccount: 'demo-group', signature: undefined } },
    { id: 'unknown_send', label: '提交：结果未知', prefill: { ...sendPrefill, subAccount: 'demo-group' }, sendUnknown: true },
  ],
  template: [
    { id: 'missing_group', label: '预填：待补消息组', prefill: { ...templatePrefill, channelType: 'CN_NTC' } },
    { id: 'missing_type', label: '预填：待补短信类型', prefill: { ...templatePrefill, subAccounts: ['demo-group'] } },
  ],
  batch: [
    { id: 'existing', label: '历史任务', task },
    { id: 'read_failure', label: '历史任务：首次查询失败', task, firstReadFails: true },
  ],
};
let bridge, frame;
let scenario = {};
let taskReads = 0;
let taskStatus = 2;
let serviceAvailable = false;
let called = 0;
function response(result, privateData = false) {
  const envelope = { success: true, result, error: null };
  return { content: [{ type: 'text', text: '模拟结果' }], structuredContent: privateData ? { ...envelope, result: null } : envelope,
    ...(privateData ? { _meta: { 'sms/form': envelope } } : {}) };
}
function tool({ name, arguments: args }) {
  called += 1;
  document.getElementById('status').textContent = `AppBridge 已连接 · 模拟工具调用 ${called} 次 · 最近工具 ${name}`;
  if (name === 'get_qualification_requirements') return response(rank);
  if (name === 'get_account_information') return response({ businessName: '演示科技有限公司', userType: 'enterprise' });
  if (name === 'list_qualifications') return response({ list: [{ id: 101, materialName: '演示企业资质', businessCertificateName: '演示科技有限公司', purpose: 1, auditStatus: 3, usable: true }], total: 1 });
  if (name === 'query_sms_resources') {
    const { action } = args.request;
    if (action === 'GetApplySignatureBind') return response([{ id: 101, materialName: '演示企业资质', businessCertificateName: '演示科技有限公司', purpose: 1 }]);
    if (action === 'GetSubAccountListForAgent') return response({ list: [group], total: 1 });
    if (action === 'ListSignaturesForAgent') return response({ List: [{ Signature: '演示科技', Status: 3, StatusDescription: '审核通过', Usable: true }], Total: 1 });
    if (action === 'ListBatchTemplatesForAgent') return response({ List: [{ TemplateId: 'demo-template', TemplateName: '预约通知', ChannelType: 'CN_NTC', TemplateContent: '您预约的服务时间为 ${time}，请准时到店。', TaskFields: [] }], Total: 1 });
    if (action === 'GetTobTrafficDrivingLinkListForAgent' || action === 'GetTobTrafficDrivingPhoneListForAgent') return response({ list: [], total: 0 });
    if (action === 'ValidateBatchTaskContentForAgent') return response({ Approved: true });
  }
  if (name === 'check_qualification_enterprise' && args.business_certificate_name === '演示待人工企业') {
    return response({ manualReview: true, code: 'enterprise_check_mismatch', requestId: 'demo-check' }, true);
  }
  if (name === 'check_qualification_enterprise' || name === 'check_qualification_person') return response({ status: 0, ticket: 'demo-ticket' }, true);
  if (name === 'recognize_qualification_document') return response({ businessCertificateName: '演示科技有限公司', unifiedSocialCreditIdentifier: 'DEMO-CREDIT', legalPersonName: '演示人员', businessCertificateValidityPeriodStart: '2020-01-01', businessCertificateValidityPeriodEnd: '长期', personName: '演示人员', personIDCard: 'DEMO-ID' }, true);
  // 本地预览不会联网或上传文件。实际字节传输由 uploads.test.jsx 的模拟 HTTP 验证。
  if (name === 'prepare_material_upload' || name === 'prepare_recipients_upload') {
    return { content: [], isError: true, structuredContent: { success: false, error: {
      code: 'preview_upload_unavailable', message: '本地样式预览不执行上传，请使用上传回归或联调环境。', outcome_unknown: false,
    } } };
  }
  if (name === 'list_templates') return response({ List: [{ TemplateId: 'demo-template', TemplateName: '预约通知', ChannelType: 'CN_NTC', TemplateContent: '您预约的服务时间为 ${time}，请准时到店。' }], Total: 1 });
  if (name === 'submit_template') return response({ templateId: 'demo-template', status: 1 });
  if (name === 'send_sms') {
    if (scenario.sendUnknown) return { content: [], isError: true, structuredContent: { success: false,
      error: { code: '1999', message: '模拟发送结果待确认，请先查询发送记录。', outcome_unknown: true } } };
    return response({ MessageIds: ['demo-message'] });
  }
  if (name === 'get_batch_csv_template') return response({ value: 'phone,time\n13800000000,明天上午\n', variables: ['time'] });
  if (name === 'send_batch_test_sms') return response({ messageId: 'demo-test-sms', requestedAt: Math.floor(Date.now() / 1000) }, true);
  if (name === 'list_send_logs') return response({ list: [{ messageId: 'demo-test-sms', status: 3 }], total: 1 });
  if (name === 'complete_recipients_upload') {
    return response({ name: args.request.context.name, file: args.request.context.file, receipt: args.request, totalCount: 2, dupCount: 0,
      ...(args.traffic ? { trafficReport: { totalRows: 2, checkedRows: 2, failedRows: 0, uncheckedRows: 0, missingResourceRows: 0, missingRowNumbers: [] } } : {}) }, true);
  }
  if (name === 'submit_qualification') return response(1001);
  if (name === 'submit_signature') return response({ applyId: 'demo-application', status: 1 });
  if (name === 'create_batch_task') { taskStatus = 2; return response({ taskId: 'demo-task', totalCount: 2, dupCount: 0 }); }
  if (name === 'query_batch_tasks') {
    taskReads += 1;
    if (scenario.firstReadFails && taskReads === 1) return { content: [], isError: true, structuredContent: { success: false,
      error: { code: 'preview_query_failed', message: '模拟首次查询失败，请刷新任务状态。', outcome_unknown: false } } };
    return response({ taskId: 'demo-task', subAccount: 'demo-group', templateId: 'demo-template', signature: '演示科技', name: '演示历史任务', totalCount: 2, dupCount: 0, sendContent: '您预约的服务时间为 ${time}，请准时到店。', status: taskStatus });
  }
  if (name === 'start_batch_task') { taskStatus = 3; return response(null); }
  if (name === 'cancel_batch_task') { taskStatus = 7; return response(null); }
  if (name === 'preview_traffic_resource') return response({ count: args.request.params.data.length });
  if (name === 'submit_traffic_resources') return response('');
  if (name === 'submit_sms_service_onboarding') serviceAvailable = true;
  if (name === 'get_sms_service_onboarding' || name === 'submit_sms_service_onboarding') {
    return response({
      status: serviceAvailable ? 'available' : 'activation_required', businessName: '演示科技有限公司',
      protocols: config.smsOnboarding.protocols, pricingUrl: config.smsOnboarding.pricingUrl,
      consoleUrl: config.smsOnboarding.consoleUrl, ...(serviceAvailable ? {} : { confirmation: 'demo-confirmation' }),
    }, true);
  }
  if (name === 'send_verification_code') return response({ messageId: 'demo-message' });
  if (name === 'verify_code') return response({ status: 0 });
  return { content: [{ type: 'text', text: '模拟器没有此工具' }], isError: true };
}

async function open() {
  const formSelect = document.getElementById('form');
  const scenarioSelect = document.getElementById('scenario');
  if (formSelect.disabled) return;
  const form = formSelect.value;
  formSelect.disabled = true; scenarioSelect.disabled = true;
  document.getElementById('status').textContent = '正在建立标准 AppBridge 连接…';
  if (bridge) { await bridge.teardownResource({}).catch(() => {}); await bridge.close(); }
  frame?.remove(); called = 0; taskReads = 0; taskStatus = 2; serviceAvailable = false;
  scenario = (scenarios[form] ?? []).find(item => item.id === scenarioSelect.value) ?? {};
  frame = document.createElement('iframe');
  frame.title = '短信表单'; frame.style.width = '960px'; frame.style.height = '540px';
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  document.getElementById('mount').appendChild(frame);
  bridge = new AppBridge(null, { name: 'SMS local preview', version: '1' }, { serverTools: {}, downloadFile: {} }, {
    hostContext: { theme: document.getElementById('dark').checked ? 'dark' : 'light', displayMode: 'inline', availableDisplayModes: ['inline', 'fullscreen'] },
  });
  bridge.oncalltool = async params => tool(params);
  bridge.onupdatemodelcontext = async () => ({});
  bridge.ondownloadfile = async () => ({});
  bridge.onsandboxready = () => bridge.sendSandboxResourceReady({ html });
  bridge.oninitialized = async () => {
    document.getElementById('status').textContent = 'AppBridge 已连接';
    await bridge.sendToolResult({ content: [{ type: 'text', text: '打开模拟表单' }], structuredContent: {
      success: true, form, mode: 'input', result: null,
    }, _meta: { 'sms/form': { prefill: scenario.prefill, task: scenario.task } } });
    formSelect.disabled = false;
    scenarioSelect.disabled = !scenarios[form]?.length;
  };
  await bridge.connect(new PostMessageTransport(frame.contentWindow, frame.contentWindow));
  const sandbox = new URL('/dev/sandbox.html', window.location.href);
  sandbox.hostname = window.location.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
  frame.src = sandbox.href;
}
function updateScenarios() {
  const select = document.getElementById('scenario');
  const options = scenarios[document.getElementById('form').value] ?? [];
  select.replaceChildren(new Option('空白表单', ''), ...options.map(item => new Option(item.label, item.id)));
  select.disabled = options.length === 0;
}
document.getElementById('form').addEventListener('change', () => { updateScenarios(); open(); });
document.getElementById('scenario').addEventListener('change', open);
document.getElementById('wide').addEventListener('click', () => { frame.style.width = '960px'; });
document.getElementById('narrow').addEventListener('click', () => { frame.style.width = '390px'; });
document.getElementById('dark').addEventListener('change', event => bridge.setHostContext({ theme: event.target.checked ? 'dark' : 'light' }));
updateScenarios();
open();
