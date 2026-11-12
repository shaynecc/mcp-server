import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Checkbox } from '@arco-design/web-react';
import { Choice, Confirm, Feedback, Field, LockedFields, More, Receipt, Summary, useOperation } from './common.jsx';
import { OperationError, page, required } from './client.js';
import { signatureSchema } from './contracts.js';
import { useMessageGroups } from './catalog.js';
import { templateVariables } from './template-variables.js';

const channels = [['CN_OTP', '验证码'], ['CN_NTC', '通知'], ['CN_MKT', '营销']];
const parameterTypes = [[1, '普通变量'], [2, '链接'], [3, '电话号码'], [4, '链接路径'], [5, '超级变量']];

export function templatePayload(values, allGroups) {
  required(values.name, '请填写模板名称。'); required(values.content, '请填写模板正文。');
  if (!channels.some(([kind]) => kind === values.channelType)) throw new OperationError('请选择短信类型。');
  if (!values.signatures?.length) throw new OperationError('请至少选择一个签名。');
  if (!allGroups && !values.subAccounts?.length) throw new OperationError('请选择适用消息组，或明确选择不限定消息组。');
  const occurrences = templateVariables(values.content);
  const names = [...new Set(occurrences)];
  const params = values.templateParams ?? [];
  if (new Set(params.map(row => row.name)).size !== params.length || params.length !== names.length
    || params.some(row => !names.includes(row.name) || !parameterTypes.some(([kind]) => row.paramType === kind))) {
    throw new OperationError('正文变量与变量设置必须一一对应，请明确选择每个变量的类型。');
  }
  if (values.channelType === 'CN_OTP' && (occurrences.length !== 1 || params.length !== 1 || params[0].paramType !== 1)) {
    throw new OperationError('验证码模板需要一个普通变量。');
  }
  const config = values.shortUrlConfig;
  if (config?.isEnabled === '1' && values.channelType !== 'CN_MKT') throw new OperationError('平台短链只适用于营销短信。');
  if (config?.uaCheckStrategy !== undefined && !Number.isInteger(config.uaCheckStrategy)) throw new OperationError('访问校验策略应为整数。');
  const traffic = params.filter(row => [2, 3].includes(row.paramType));
  const combinations = values.templateTrafficDriving ?? [];
  if (traffic.length && !combinations.length) throw new OperationError('请添加引流组合并选择对应资源。');
  for (const group of combinations) {
    if (!group.length || group.length !== traffic.length || new Set(group.map(row => row.name)).size !== group.length
      || group.some(row => !traffic.some(item => item.name === row.name && item.paramType === row.paramType)
        || !(Number.isInteger(row.id) && row.id > 0) && !row.content)) {
      throw new OperationError('每组引流绑定需完整覆盖对应变量，且填写已报备资源或原始链接、号码。');
    }
  }
  return { name: values.name, content: values.content, channelType: values.channelType,
    signatures: [...values.signatures], ...(allGroups ? {} : { subAccounts: [...values.subAccounts] }),
    templateParams: params.map(row => ({ ...row })),
    ...(values.desc !== undefined ? { desc: values.desc } : {}), ...(values.project !== undefined ? { project: values.project } : {}),
    ...(config ? { shortUrlConfig: { ...config } } : {}),
    ...(combinations.length ? { templateTrafficDriving: combinations.map(rows => rows.map(row => ({ ...row }))) } : {}) };
}

export function TemplateForm({ client, prefill }) {
  const [values, setValues] = useState(() => ({ ...prefill, signatures: prefill?.signatures ?? [], subAccounts: prefill?.subAccounts ?? [],
    templateParams: prefill?.templateParams?.map(row => ({ ...row })) ?? [],
    templateTrafficDriving: prefill?.templateTrafficDriving?.map(rows => rows.map(row => ({ ...row }))) ?? [],
    shortUrlConfig: prefill?.shortUrlConfig ? { ...prefill.shortUrlConfig } : undefined }));
  const [allGroups, setAllGroups] = useState(() => prefill?.subAccounts !== undefined && prefill.subAccounts.length === 0);
  const [signatures, setSignatures] = useState({ rows: [], total: 0, page: 0 });
  const [traffic, setTraffic] = useState({ links: [], phones: [] });
  const [snapshot, setSnapshot] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [status, setStatus] = useState(null);
  const operation = useOperation();
  const groups = useMessageGroups(client, operation, prefill?.subAccounts ?? []);
  const loadedScope = useRef(null);
  const initialSignatures = useRef(prefill?.signatures ?? []);
  const update = (key, value) => setValues(current => ({ ...current, [key]: value }));
  const signatureScope = { ...(allGroups ? {} : { SubAccounts: values.subAccounts }),
    ...(values.channelType ? { ChannelTypes: [values.channelType] } : {}), Statuses: [3, 5] };
  const loadSignatures = async (next = 1) => {
    const result = page(await client.query('ListSignaturesForAgent', { ...signatureScope, Page: next, PageSize: 100 }), signatureSchema);
    const rows = [...result.rows];
    if (next === 1) {
      for (const name of initialSignatures.current) {
        if (rows.some(row => row.Signature === name)) continue;
        const match = page(await client.query('ListSignaturesForAgent', { ...signatureScope, Signature: name, ExactMatch: true, Page: 1, PageSize: 100 }), signatureSchema)
          .rows.find(row => row.Signature === name);
        if (!match) throw new OperationError('预填签名当前不可用，请重新选择。');
        rows.push(match);
      }
      initialSignatures.current = [];
    }
    setSignatures(current => ({ rows: next === 1 ? rows : [...current.rows, ...rows], total: result.total, page: next }));
  };
  const scopeKey = JSON.stringify([values.subAccounts, values.channelType, allGroups]);
  useEffect(() => {
    if (operation.busy || !groups.page || !allGroups && !values.subAccounts.length || loadedScope.current === scopeKey) return;
    loadedScope.current = scopeKey;
    operation.run(() => loadSignatures(1));
  }, [scopeKey, groups.page, operation.busy]);
  const changeScope = (key, value) => {
    // 补齐未知范围时，保留用户已给签名并在新范围中重新核实；变更已确定范围才清除旧选择。
    const hadScope = key === 'channelType' ? values.channelType !== undefined
      : allGroups || values.subAccounts.length > 0;
    initialSignatures.current = hadScope ? [] : [...values.signatures];
    setSignatures({ rows: [], total: 0, page: 0 });
    setValues(current => ({ ...current, [key]: value, signatures: hadScope ? [] : current.signatures }));
  };
  const editParameter = (index, key, value) => update('templateParams', values.templateParams.map((row, i) => i === index ? { ...row, [key]: value } : row));
  const editBinding = (group, index, fields) => update('templateTrafficDriving', values.templateTrafficDriving.map((rows, g) => g === group
    ? rows.map((row, i) => i === index ? { ...row, ...fields } : row) : rows));
  const loadTraffic = () => operation.run(async () => {
    const links = await client.query('GetTobTrafficDrivingLinkListForAgent');
    const phones = await client.query('GetTobTrafficDrivingPhoneListForAgent');
    const linkRows = links?.list ?? links?.List; const phoneRows = phones?.list ?? phones?.List;
    if (!Array.isArray(linkRows) || !Array.isArray(phoneRows)) throw new OperationError('引流资源列表不完整，请稍后重试。');
    setTraffic({ links: linkRows, phones: phoneRows });
  });
  const submit = () => operation.run(async () => {
    const result = await client.call('submit_template', { request: snapshot }, { write: true });
    setReceipt({ ...result, name: snapshot.name }); setSnapshot(null);
    await client.report({ form: 'template', state: 'submitted', templateId: result.templateId, status: result.status });
  }, { mutation: true });
  const shortUrl = values.shortUrlConfig ?? {};
  const shortField = (key, value) => update('shortUrlConfig', { ...shortUrl, [key]: value });
  return <LockedFields locked={operation.busy || operation.uncertain}><main className="batch-page">
    <header className="batch-header"><div className="batch-header-inner"><div className="batch-brand">火山引擎 · 短信服务</div>
      <h1>申请短信模板</h1><p>填写正文、变量与适用范围。提交后仍需等待模板审核和运营商报备。</p></div></header>
    <div className="batch-body"><Feedback operation={operation} /><section className="batch-sheet batch-section">
      {receipt ? <Receipt title="模板申请已受理" id={receipt.templateId}>
        <p>{receipt.name} 已提交；受理不等于审核或报备通过。</p>
        {receipt.templateId && <Button loading={operation.busy} onClick={() => operation.run(async () => setStatus(page(await client.call('list_templates', {
          template_id: receipt.templateId, page: 1, page_size: 100,
        }))))}>刷新审核状态</Button>}
        {status && <p>查询到 {status.total} 条模板记录；{status.rows.map(row => row.StatusDescription ?? row.statusDescription ?? '请按返回的审核状态继续核对').join('；')}</p>}
      </Receipt> : snapshot ? <Confirm title="核对模板申请" submitLabel="确认提交模板" busy={operation.busy} disabled={operation.uncertain}
        onBack={() => setSnapshot(null)} onSubmit={submit}>
        <Summary items={[["名称", snapshot.name], ["短信类型", channels.find(([kind]) => kind === snapshot.channelType)?.[1]],
          ["签名", snapshot.signatures.join('、')], ["适用消息组", snapshot.subAccounts?.map(id => groups.options.find(row => row.subAccountId === id)?.subAccountName ?? id).join('、') ?? '未限定，按短信服务当前配置处理'],
          ["正文", snapshot.content], ["用途说明", snapshot.desc], ["项目", snapshot.project]]} />
        {snapshot.templateParams.map(row => <Summary key={row.name} items={[["变量", row.name], ["类型", parameterTypes.find(([kind]) => kind === row.paramType)?.[1]]]} />)}
        {snapshot.templateTrafficDriving?.map((rows, group) => <div key={group}><h3>引流组合 {group + 1}</h3>{rows.map((row, index) => <Summary key={index} items={[["变量", row.name], ["资源", row.content ?? `已报备资源 ${row.id}`]]} />)}</div>)}
        {snapshot.shortUrlConfig && <Summary items={[["平台短链", snapshot.shortUrlConfig.isEnabled === '1' ? '启用' : '未启用'], ["短链归属", snapshot.shortUrlConfig.belong],
          ["点击明细", snapshot.shortUrlConfig.isNeedClickDetails], ["访问校验策略", snapshot.shortUrlConfig.uaCheckStrategy]]} />}
      </Confirm> : <>
        <div className="form-grid"><Field label="模板名称" value={values.name} onChange={value => update('name', value)} maxLength={50} required />
          <Choice label="短信类型" value={values.channelType} options={channels} onChange={value => changeScope('channelType', value)} />
          <Field label="用途说明" value={values.desc} onChange={value => update('desc', value)} maxLength={300} />
          <Field label="项目（可选）" value={values.project} onChange={value => update('project', value)} /></div>
        <Choice label="适用消息组" mode="multiple" value={values.subAccounts} disabled={allGroups}
          options={groups.options.map(row => [row.subAccountId, row.subAccountName ?? row.subAccountId])} onChange={value => changeScope('subAccounts', value)} />
        <More loaded={groups.rows.length} total={groups.total} disabled={operation.busy} onClick={() => operation.run(groups.load)} />
        <Checkbox checked={allGroups} disabled={operation.busy || operation.uncertain} onChange={value => { setAllGroups(value); changeScope('subAccounts', values.subAccounts); }}>不限定消息组，按短信服务当前签名配置处理</Checkbox>
        <Choice label="适用签名" mode="multiple" value={values.signatures} options={signatures.rows.map(row => [row.Signature, row.Signature])} onChange={value => update('signatures', value)} />
        <More loaded={signatures.rows.length} total={signatures.total} disabled={operation.busy} onClick={() => operation.run(() => loadSignatures(signatures.page + 1))} />
        <Button disabled={operation.busy || operation.uncertain} onClick={() => operation.run(() => loadSignatures(1))}>刷新签名</Button>
        <Field label="模板正文" value={values.content} onChange={value => update('content', value)} multiline required />
        <p>变量写作 {'${name}'}；名称由英文、数字或下划线组成。变量类型需按实际用途选择。</p>
        <Button disabled={operation.busy || operation.uncertain} onClick={() => operation.run(() => update('templateParams', [...new Set(templateVariables(values.content ?? ''))].map(name =>
          values.templateParams.find(row => row.name === name) ?? { name }))) }>从正文提取变量</Button>
        {values.templateParams.map((row, index) => <div className="form-grid" key={index}>
          <Field label={`变量 ${index + 1} 名称`} value={row.name} onChange={value => editParameter(index, 'name', value)} />
          <Choice label={`变量 ${index + 1} 类型`} value={row.paramType} options={parameterTypes} onChange={value => editParameter(index, 'paramType', value)} />
        </div>)}
        <details><summary>引流变量绑定</summary>
          <p>链接或电话号码变量需要关联已报备资源。同一组覆盖本次所有引流变量。</p>
          <Button disabled={operation.busy || operation.uncertain} onClick={loadTraffic}>读取已报备引流资源</Button>
          {values.templateTrafficDriving.map((rows, group) => <section key={group}><h3>引流组合 {group + 1}</h3>
            {rows.map((row, index) => <div className="form-grid" key={index}>
              <Choice label={`组合 ${group + 1} 第 ${index + 1} 项变量`} value={row.name} options={values.templateParams.filter(item => [2, 3].includes(item.paramType)).map(item => [item.name, item.name])}
                onChange={name => editBinding(group, index, { name, paramType: values.templateParams.find(item => item.name === name)?.paramType, id: undefined, content: undefined })} />
              <Choice label={`组合 ${group + 1} 第 ${index + 1} 项资源`} value={row.id}
                options={(row.paramType === 2 ? traffic.links : traffic.phones).filter(item => Number.isInteger(item.id)).map(item => [item.id, item.link ?? item.jumpLink ?? item.number ?? `资源 ${item.id}`])}
                onChange={id => editBinding(group, index, { id, content: undefined })} />
              <Field label={`组合 ${group + 1} 第 ${index + 1} 项原始链接或号码`} value={row.content} onChange={content => editBinding(group, index, { content, id: undefined })} />
              <Button disabled={operation.busy || operation.uncertain} onClick={() => update('templateTrafficDriving', values.templateTrafficDriving.map((items, i) => i === group ? items.filter((_row, j) => j !== index) : items))}>移除此项</Button>
            </div>)}
            <Button disabled={operation.busy || operation.uncertain} onClick={() => update('templateTrafficDriving', values.templateTrafficDriving.map((items, i) => i === group ? [...items, {}] : items))}>添加绑定项</Button>
            <Button disabled={operation.busy || operation.uncertain} onClick={() => update('templateTrafficDriving', values.templateTrafficDriving.filter((_rows, i) => i !== group))}>移除组合</Button>
          </section>)}
          <Button disabled={operation.busy || operation.uncertain} onClick={() => update('templateTrafficDriving', [...values.templateTrafficDriving, []])}>添加引流组合</Button>
        </details>
        <details><summary>短链设置（可选）</summary>
          <Choice label="启用平台短链" value={shortUrl.isEnabled} options={[["0", "不启用"], ["1", "启用"]]} allowClear onChange={value => shortField('isEnabled', value)} />
          <Choice label="记录点击明细" value={shortUrl.isNeedClickDetails} options={[["0", "不记录"], ["1", "记录"]]} allowClear onChange={value => shortField('isNeedClickDetails', value)} />
          <Field label="短链归属（按现有配置，可选）" value={shortUrl.belong} onChange={value => shortField('belong', value)} />
          <Field label="访问校验策略（按现有配置，可选）" type="number" value={shortUrl.uaCheckStrategy} onChange={value => shortField('uaCheckStrategy', value === '' ? undefined : Number(value))} />
        </details>
        <Alert type="info" content="模板申请受理后仍需审核；营销内容按实际业务保留退订提示，是否可用以审核和报备结果为准。" />
        <Button type="primary" disabled={operation.busy || operation.uncertain} onClick={() => operation.run(() => {
          if (!allGroups && values.subAccounts.some(id => !groups.options.some(row => row.subAccountId === id))) throw new OperationError('消息组尚未核实，请重新选择。');
          if (values.signatures.some(name => !signatures.rows.some(row => row.Signature === name))) throw new OperationError('签名尚未核实，请重新选择或刷新签名。');
          setSnapshot(templatePayload(values, allGroups));
        })}>核对模板申请</Button>
      </>}
    </section></div>
  </main></LockedFields>;
}
