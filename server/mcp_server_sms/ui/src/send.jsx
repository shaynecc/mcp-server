import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button } from '@arco-design/web-react';
import { Choice, Confirm, Feedback, Field, LockedFields, More, Receipt, Summary, useOperation } from './common.jsx';
import { OperationError, page, required, withPrefilledOptions } from './client.js';
import { signatureSchema } from './contracts.js';
import { useMessageGroups } from './catalog.js';
import { renderSmsContent, templateVariables } from './template-variables.js';

export function smsSendPayload(values, template) {
  required(values.subAccount, '请选择消息组。'); required(values.signature, '请选择签名。');
  if (!template || template.TemplateId !== values.templateId) throw new OperationError('请选择当前可用模板。');
  if (template.BatchOnly === true || template.TaskFields?.length) throw new OperationError('该模板需要群发任务，请使用群发表单。');
  const content = required(template.TemplateContent ?? template.Content, '模板未返回完整正文，请重新选择。');
  const mobiles = required(values.mobiles, '请填写收件手机号。').split(/\r?\n/);
  if (!mobiles.length || mobiles.length > 200 || mobiles.some(number => !/^1[3-9][0-9]{9}$/.test(number))) {
    throw new OperationError('每行填写一个中国大陆手机号，不要留空行；一次最多 200 个。');
  }
  const templateParams = values.templateParams ?? {};
  renderSmsContent(content, templateParams);
  return { subAccount: values.subAccount, signature: values.signature, templateId: values.templateId,
    mobiles, templateParams, templateContent: content };
}

export function SmsSendForm({ client, prefill }) {
  const [values, setValues] = useState(() => ({ subAccount: prefill?.subAccount, signature: prefill?.signature,
    templateId: prefill?.templateId, mobiles: prefill?.mobiles?.join('\n'), templateParams: prefill?.templateParams ?? {} }));
  const [signatures, setSignatures] = useState({ rows: [], total: 0, page: 0 });
  const [templates, setTemplates] = useState({ rows: [], total: 0, page: 0 });
  const [exact, setExact] = useState({});
  const [snapshot, setSnapshot] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [logs, setLogs] = useState(null);
  const initial = useRef({ signature: prefill?.signature, templateId: prefill?.templateId });
  const operation = useOperation();
  const groups = useMessageGroups(client, operation, prefill?.subAccount ? [prefill.subAccount] : []);
  const signatureRows = withPrefilledOptions(signatures.rows, exact.signature ? [exact.signature] : [], 'Signature');
  const templateRows = withPrefilledOptions(templates.rows, exact.template ? [exact.template] : [], 'TemplateId');
  const selected = templateRows.find(row => row.TemplateId === values.templateId);
  const update = (name, value) => setValues(current => ({ ...current, [name]: value }));
  const loadTemplates = async (group, signature, next = 1) => {
    const result = page(await client.call('list_templates', { sub_accounts: [group], signatures: [signature], page: next, page_size: 100 }));
    setTemplates(current => ({ rows: next === 1 ? result.rows : [...current.rows, ...result.rows], total: result.total, page: next }));
    return result.rows;
  };
  const loadSignatures = async (group, next = 1) => {
    const result = page(await client.query('ListSignaturesForAgent', { SubAccounts: [group], Statuses: [3, 5], Page: next, PageSize: 100 }), signatureSchema);
    setSignatures(current => ({ rows: next === 1 ? result.rows : [...current.rows, ...result.rows], total: result.total, page: next }));
    return result.rows;
  };
  const selectSignature = async (group, signature) => {
    update('signature', signature);
    const templates = await loadTemplates(group, signature);
    const id = initial.current.templateId;
    if (id === undefined) return;
    const template = templates.find(row => row.TemplateId === id) ?? page(await client.call('list_templates', {
      template_id: id, sub_accounts: [group], signatures: [signature], page: 1, page_size: 100,
    })).rows.find(row => row.TemplateId === id);
    if (!template) throw new OperationError('预填模板当前不可用，请重新选择。');
    initial.current.templateId = undefined;
    setExact(current => ({ ...current, template })); update('templateId', id);
  };
  const selectGroup = async group => {
    update('subAccount', group); setSignatures({ rows: [], total: 0, page: 0 }); setTemplates({ rows: [], total: 0, page: 0 });
    const rows = await loadSignatures(group);
    const signature = initial.current.signature;
    if (signature === undefined) return;
    const found = rows.find(row => row.Signature === signature) ?? page(await client.query('ListSignaturesForAgent', {
      SubAccounts: [group], Signature: signature, ExactMatch: true, Statuses: [3, 5], Page: 1, PageSize: 100,
    }), signatureSchema).rows.find(row => row.Signature === signature);
    if (!found) throw new OperationError('预填签名不适用于当前消息组，请重新选择。');
    initial.current.signature = undefined;
    setExact({ signature: found });
    await selectSignature(group, signature);
  };
  const initialGroup = useRef(prefill?.subAccount);
  useEffect(() => {
    if (!initialGroup.current || operation.busy || !groups.options.some(row => row.subAccountId === initialGroup.current)) return;
    const id = initialGroup.current; initialGroup.current = undefined;
    operation.run(() => selectGroup(id));
  }, [groups.options, operation.busy]);
  const readLogs = async (sent, next = 1) => {
    const result = page(await client.call('list_send_logs', { sub_account: sent.subAccount, message_id: sent.messageId,
      from_time: sent.requestedAt, to_time: Math.max(sent.requestedAt, Math.floor(Date.now() / 1000)) + 1, page: next, page_size: 100 }));
    setLogs(current => ({ ...result, rows: next === 1 ? result.rows : [...current.rows, ...result.rows], page: next, messageId: sent.messageId }));
  };
  const send = () => operation.run(async () => {
    const requestedAt = Math.floor(Date.now() / 1000);
    const result = await client.call('send_sms', { request: {
      subAccount: snapshot.subAccount, signature: snapshot.signature, templateId: snapshot.templateId,
      mobiles: snapshot.mobiles, templateParams: snapshot.templateParams,
    } }, { write: true });
    const ids = result?.MessageIds ?? (result?.MessageId ? [result.MessageId] : []);
    if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string' || !id)) {
      throw new OperationError('未收到可核对的发送编号，请查询发送记录。', { unknown: true });
    }
    const sent = { ids, subAccount: snapshot.subAccount, count: snapshot.mobiles.length, requestedAt };
    setReceipt(sent); setSnapshot(null); setValues(current => ({ ...current, mobiles: '', templateParams: {} }));
    await client.report({ form: 'send', state: 'accepted', messageIds: ids, count: sent.count });
  }, { mutation: true });
  let variables = [], variableError;
  try { variables = selected ? [...new Set(templateVariables(selected.TemplateContent ?? selected.Content ?? ''))] : []; }
  catch (cause) { variableError = cause.message; }
  return <LockedFields locked={operation.busy || operation.uncertain}><main className="batch-page">
    <header className="batch-header"><div className="batch-header-inner"><div className="batch-brand">火山引擎 · 短信服务</div>
      <h1>发送短信</h1><p>选择签名和模板，核对号码与实际正文后发送。不同内容的批量名单请使用群发表单。</p></div></header>
    <div className="batch-body"><Feedback operation={operation} /><section className="batch-sheet batch-section">
      {receipt ? <Receipt title="短信发送请求已受理" id={receipt.ids.join('、')}>
        <p>本次 {receipt.count} 个收件号码；请求受理不等于送达。</p>
        {receipt.ids.map(id => <Button key={id} loading={operation.busy} onClick={() => operation.run(() => readLogs({ ...receipt, messageId: id }))}>查询发送记录 {id}</Button>)}
        {logs && <><p>已读取 {logs.rows.length} / {logs.total} 条记录：成功 {logs.rows.filter(row => (row.status ?? row.Status) === 3).length} 条，失败 {logs.rows.filter(row => (row.status ?? row.Status) === 2).length} 条；未返回或未知状态不能据此判断送达。</p>
          <More loaded={logs.rows.length} total={logs.total} disabled={operation.busy} onClick={() => operation.run(() => readLogs({ ...receipt, messageId: logs.messageId }, logs.page + 1))} /></>}
      </Receipt> : snapshot ? <Confirm title="核对本次发送" submitLabel="确认发送短信" busy={operation.busy} disabled={operation.uncertain}
        onBack={() => setSnapshot(null)} onSubmit={send}>
        <Alert type="warning" content="确认后会向以下号码发送短信，并按当前账号计费。" />
        <Summary items={[["签名", snapshot.signature], ["收件号码", snapshot.mobiles.join('、')],
          ["实际短信正文", renderSmsContent(snapshot.templateContent, snapshot.templateParams)]]} />
      </Confirm> : <><div className="form-grid">
        <div><Choice label="消息组" value={values.subAccount} options={groups.options.map(row => [row.subAccountId, row.subAccountName ?? row.subAccountId])}
          onChange={id => operation.run(async () => {
            if (values.subAccount !== undefined && values.subAccount !== id) {
              initial.current = {}; setExact({});
              setValues(current => ({ ...current, signature: undefined, templateId: undefined, templateParams: {} }));
            }
            await selectGroup(id);
          })} />
          <More loaded={groups.rows.length} total={groups.total} disabled={operation.busy} onClick={() => operation.run(groups.load)} /></div>
        <div><Choice label="短信签名" value={values.signature} options={signatureRows.map(row => [row.Signature, row.Signature])} disabled={!values.subAccount}
          onChange={name => operation.run(async () => {
            if (values.signature !== undefined && values.signature !== name) {
              initial.current.templateId = undefined; setExact({});
              setValues(current => ({ ...current, templateId: undefined, templateParams: {} }));
            }
            initial.current.signature = undefined;
            await selectSignature(values.subAccount, name);
          })} />
          <More loaded={signatures.rows.length} total={signatures.total} disabled={operation.busy} onClick={() => operation.run(() => loadSignatures(values.subAccount, signatures.page + 1))} /></div>
        <div><Choice label="短信模板" value={values.templateId} disabled={!values.signature}
          options={templateRows.filter(row => row.BatchOnly !== true && !row.TaskFields?.length).map(row => [row.TemplateId, row.TemplateName ?? row.TemplateId])}
          onChange={id => setValues(current => ({ ...current, templateId: id, templateParams: {} }))} />
          <More loaded={templates.rows.length} total={templates.total} disabled={operation.busy} onClick={() => operation.run(() => loadTemplates(values.subAccount, values.signature, templates.page + 1))} /></div>
      </div>
      {selected && <p className="batch-message-content">{selected.TemplateContent ?? selected.Content}</p>}
      <Field label="收件手机号（一行一个）" value={values.mobiles} onChange={value => update('mobiles', value)} multiline required />
      <div className="batch-param-grid">{variableError && <Alert type="error" content={variableError} />}{variables.map(name => <Field key={name} label={`变量 ${name}`} value={Object.hasOwn(values.templateParams, name) ? values.templateParams[name] : ''}
        onChange={value => setValues(current => ({ ...current, templateParams: { ...current.templateParams, [name]: value } }))} required />)}</div>
      <Button type="primary" disabled={operation.busy || operation.uncertain || Boolean(variableError)} onClick={() => operation.run(() => setSnapshot(smsSendPayload(values, selected)))}>核对发送信息</Button>
      </>}
    </section></div>
  </main></LockedFields>;
}
