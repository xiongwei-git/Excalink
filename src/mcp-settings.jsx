import React, { useEffect, useRef, useState } from 'react';
import './mcp-settings.css';

const base = '/api/settings/mcp';
const sections = { setup: '接入与体验', access: '安全授权', activity: '任务记录' };
const transports = { http: '远程 HTTP', stdio: '本地 stdio' };
const stdioScript = '/absolute/path/to/Excalink/src/mcp.js';

function withCode(text, placeholder, code) {
  const [before, after] = text.split(placeholder);
  return <>{before}{code}{after}</>;
}

export function McpSettings({ request, onClose, icon, locale, t }) {
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'medium' });
  const dialog = useRef(null);
  const layout = useRef(null);
  const content = useRef(null);
  const [section, setSection] = useState('setup');
  const [transport, setTransport] = useState('http');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [creating, setCreating] = useState(false);
  const [issued, setIssued] = useState('');
  const [revoke, setRevoke] = useState(null);
  const [filter, setFilter] = useState('all');

  const refresh = async () => setData(await request(base));

  async function action(run) {
    setError('');
    setMessage('');
    setBusy(true);
    try { await run(); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    dialog.current.showModal();
    void action(refresh);
  }, []);

  function copyHttpInstructions(authentication) {
    copy([
      t('请在当前 AI 客户端配置 Excalink MCP，并验证接入。'),
      t('使用 Streamable HTTP 连接 {endpoint}。', { endpoint: data.endpoint }),
      authentication,
      t('先列出工具，再调用 describe_scene 只读验证当前白板。'),
    ].join('\n'));
  }

  function copyHttpConfig(headers) {
    copy(JSON.stringify({ mcpServers: { excalink: {
      type: 'http', url: data.endpoint, ...(headers && { headers }),
    } } }, null, 2));
  }

  const boardOrigin = data ? new URL(data.endpoint).origin : '';
  const stdioConfig = JSON.stringify({ mcpServers: { excalink: {
    command: 'node',
    args: [stdioScript],
    env: { MCP_BOARD_ORIGIN: boardOrigin, MCP_TOKEN: t('<填写在安全授权中生成的令牌>') },
  } } }, null, 2);
  const stdioPrompt = [
    t('请在当前 AI 客户端配置 Excalink MCP，并验证接入。'),
    t('在运行客户端的机器上，使用 Node.js 22.12 或以上版本，在 Excalink 项目目录执行 npm ci。'),
    t('添加 stdio 服务，启动命令为 node，启动参数为这台机器上 src/mcp.js 的实际绝对路径。'),
    t('设置 MCP_BOARD_ORIGIN 为 {origin}。MCP_TOKEN 使用我在 Excalink「本地 stdio → 安全授权」生成的令牌，由我通过客户端的凭据设置提供。请勿回显。', { origin: boardOrigin }),
    t('先列出工具，再调用 describe_scene 只读验证当前白板。'),
  ].join('\n');

  function copy(value) {
    void action(async () => {
      try {
        await navigator.clipboard.writeText(value);
      } catch {
        throw new Error('无法写入剪贴板，请检查浏览器权限后重试。');
      }
      setMessage('已复制。');
    });
  }

  function navigate(next, openForm = false) {
    layout.current.scrollTop = 0;
    content.current.scrollTop = 0;
    setSection(next);
    setIssued('');
    setCreating(openForm);
    setRevoke(null);
    void action(refresh);
  }

  const isStdio = transport === 'stdio';
  const credential = isStdio ? t('访问令牌') : 'API Key';
  const keys = data?.keys.filter(key => key.transport === transport) || [];
  const activity = data?.records.filter(item => item.transport === transport) || [];
  const successes = activity.filter(item => item.ok).length;
  const records = activity.filter(item => filter === 'all' || item.ok === (filter === 'ok'));
  const stdioReady = isStdio && keys.some(key => Date.parse(key.expiresAt) > Date.now());

  return <dialog ref={dialog} className="share-dialog mcp-dialog" aria-labelledby="mcp-title" onClose={onClose}>
    <header className="mcp-header">
      <h2 id="mcp-title">{icon('mcp')} {t('MCP 服务')}</h2>
      <button type="button" className="icon-button" aria-label={t('关闭 MCP 服务')} onClick={() => dialog.current.close()}>{icon('close')}</button>
    </header>
    <div ref={layout} className="mcp-layout">
      <aside className="mcp-sidebar">
        <div className="mcp-transports" role="group" aria-label={t('接入方式')}>
          {Object.entries(transports).map(([value, label]) => <button type="button" key={value} disabled={busy}
            aria-pressed={transport === value} onClick={() => {
              if (transport === value) return;
              setTransport(value);
              setFilter('all');
              navigate(section);
            }}>{t(label)}</button>)}
        </div>
        <nav aria-label={t('{transport}设置', { transport: t(transports[transport]) })}>
          {Object.entries(sections).map(([name, label]) => <button key={name} type="button" aria-current={section === name ? 'page' : undefined}
            onClick={() => navigate(name)} disabled={busy}>{t(label)}</button>)}
        </nav>
      </aside>
      <section ref={content} className="mcp-content" aria-labelledby="mcp-section" tabIndex={0}>
        <h3 id="mcp-section">{t(sections[section])}</h3>
        {error && <p className="dialog-error" role="alert">{t(error)}</p>}
        {message && <p className="dialog-feedback" role="status">{t(message)}</p>}
        {!data && (busy ? <p role="status">{t('正在读取 MCP 设置…')}</p> : <button onClick={() => action(refresh)}>{t('重新读取')}</button>)}
        {data && section === 'setup' && transport === 'http' && <>
          <div className="mcp-status">
            <strong>Streamable HTTP</strong><span>{data.enabled ? t('已启用') : t('未启用')}</span>
          </div>
          {!data.enabled && <p>{!data.privateBoard ? t('请先在部署端启用密码或 OIDC 登录，再签发远程访问凭据。') : t('请在部署端配置白板的 HTTPS 地址，再启用远程接入。')}</p>}
          <div className="mcp-group">
            {data.oauth && <section className="mcp-step" aria-labelledby="mcp-oauth-title">
              <div className="mcp-auth-title"><h4 id="mcp-oauth-title">{t('OAuth 登录')}</h4><span>{t('推荐')}</span></div>
              <p>{t('在 Codex 等支持 OAuth 的客户端添加以下地址，点击连接，然后在浏览器登录 Excalink 并确认授权。')}</p>
              <div className="mcp-address"><code>{data.endpoint}</code>
                <button type="button" className="primary" disabled={busy || !data.enabled} onClick={() => copy(data.endpoint)}>{t('复制地址')}</button>
              </div>
              <div className="mcp-actions mcp-auth-copy">
                <button type="button" disabled={busy || !data.enabled} onClick={() => copyHttpInstructions(t('使用 OAuth 连接，打开浏览器让我登录 Excalink 并确认授权。'))}>{t('复制接入说明')}</button>
                <button type="button" disabled={busy || !data.enabled} onClick={() => copyHttpConfig()}>{t('复制 .mcp.json 示例')}</button>
              </div>
            </section>}
            <section className="mcp-step" aria-labelledby="mcp-api-key-title">
              <div className="mcp-heading mcp-auth-title">
                <h4 id="mcp-api-key-title">API Key</h4>
                <button type="button" disabled={busy || !data.enabled} onClick={() => navigate('access', true)}>{t('创建 API Key')}</button>
              </div>
              <p>{withCode(t('创建 API Key 后，在客户端的认证设置中将它填为 Bearer 令牌。配置示例里的 {placeholder} 是占位符。'), '{placeholder}', <code>{'${EXCALINK_API_KEY}'}</code>)}</p>
              {!data.oauth && <div className="mcp-address"><code>{data.endpoint}</code>
                <button type="button" disabled={busy || !data.enabled} onClick={() => copy(data.endpoint)}>{t('复制地址')}</button>
              </div>}
              <div className="mcp-actions mcp-auth-copy">
                <button type="button" disabled={busy || !data.enabled} onClick={() => copyHttpInstructions(t('使用 Authorization: Bearer <API Key>。由我通过客户端支持的凭据设置提供 Key，请勿回显。'))}>{t('复制接入说明')}</button>
                <button type="button" disabled={busy || !data.enabled} onClick={() => copyHttpConfig({ Authorization: 'Bearer ${EXCALINK_API_KEY}' })}>{t('复制 .mcp.json 示例')}</button>
              </div>
            </section>
          </div>
        </>}
        {data && section === 'setup' && transport === 'stdio' && <>
          <div className="mcp-status">
            <strong>{t('访问令牌')}</strong>
            <span>{stdioReady ? t('已有可用令牌') : keys.length ? t('令牌已过期') : t('暂无可用令牌')}</span>
          </div>
          <div className="mcp-group">
            <div className="mcp-step">
              <h4>{t('第一步 · 生成访问令牌')}</h4>
              <p>{t('在「安全授权」生成一个访问令牌。签发后即可使用。')}</p>
              {!data.enabled && <p>{t('签发令牌需要启用白板登录，并使用 HTTPS 或本机回环地址。')}</p>}
              <button type="button" disabled={busy} onClick={() => navigate('access')}>{t('前往安全授权')}</button>
            </div>
            <div className="mcp-step">
              <h4>{t('第二步 · 连接 AI 客户端')}</h4>
              <p>{withCode(t('在客户端机器上准备同版本源码和 Node.js 22.12 或以上版本，在项目目录执行 {command}，再用以下参数接入。'), '{command}', <code>npm ci</code>)}</p>
              <dl className="mcp-config-fields">
                <dt>{t('启动命令')}</dt><dd><code>node {stdioScript}</code></dd>
                <dt>{t('白板地址')}</dt><dd><code>{boardOrigin}</code></dd>
                <dt>{t('访问令牌')}</dt><dd><code>MCP_TOKEN</code></dd>
              </dl>
              <div className="mcp-actions">
                <button type="button" className="primary" disabled={busy} onClick={() => copy(stdioPrompt)}>{t('复制接入说明')}</button>
                <button type="button" disabled={busy} onClick={() => copy(stdioConfig)}>{t('复制 .mcp.json 示例')}</button>
              </div>
              <p>{withCode(t('使用 Mermaid 转换、图片导出或截图前，在客户端机器的项目目录运行 {command}。'), '{command}', <code>npx playwright install chromium</code>)}</p>
            </div>
          </div>
        </>}
        {data && section === 'access' && <>
          <div className="mcp-group mcp-step">
            <h4>{isStdio ? t('本地客户端授权') : t('远程访问')}</h4>
            <p>{data.enabled ? t('凭据只适用于当前白板。') : t('签发凭据需要启用白板登录，并使用 HTTPS 或本机回环地址。')}</p>
            <code>{isStdio ? boardOrigin : data.endpoint}</code>
          </div>
          <div className="mcp-group mcp-step">
            <div className="mcp-heading"><h4>{isStdio ? t('访问令牌') : t('访问凭据')}</h4>
              <button type="button" className="primary" disabled={busy || !data.enabled || Boolean(issued) || stdioReady}
                onClick={() => setCreating(!creating)}>{creating ? t('取消创建') : isStdio ? t('生成访问令牌') : t('创建访问凭据')}</button></div>
            {stdioReady && <p>{t('本地 stdio 只保留一个有效令牌。需要更换时，请先撤销现有令牌。')}</p>}
            {creating && <form className="mcp-form" onSubmit={event => {
              event.preventDefault();
              const fields = Object.fromEntries(new FormData(event.currentTarget));
              void action(async () => {
                const { token } = await request(base + '/keys', 'POST', { ...fields, transport, days: Number(fields.days) });
                setIssued(token);
                setCreating(false);
                await refresh();
              });
            }}>
              <label>{t('凭据名称')}<input name="name" autoFocus required maxLength={60} placeholder={t('例如 Mac mini')} /></label>
              <label>{t('权限')}<select name="scope"><option value="read">{t('只读')}</option><option value="write">{t('读写')}</option></select></label>
              <label>{t('有效期')}<select name="days"><option value="30">{t('{days} 天', { days: 30 })}</option><option value="90">{t('{days} 天', { days: 90 })}</option><option value="365">{t('{days} 天', { days: 365 })}</option></select></label>
              <button className="primary" disabled={busy}>{t('签发{credential}', { credential })}</button>
            </form>}
            {issued && <div className="mcp-issued">
              <p>{t('{credential}仅在此处显示一次。请先复制并妥善保存。', { credential })}</p>
              <code>{issued}</code>
              <div className="mcp-actions"><button type="button" disabled={busy} onClick={() => copy(issued)}>{t('复制{credential}', { credential })}</button>
                <button type="button" onClick={() => setIssued('')}>{t('完成')}</button></div>
            </div>}
            {keys.length === 0 && <p>{isStdio ? t('暂无访问令牌。') : t('暂无访问凭据。')}</p>}
            {keys.length > 0 && <ul className="mcp-list">
              {keys.map(key => <li key={key.id}>
                <div><strong>{key.name}</strong><div className="mcp-meta">{key.oauth ? 'OAuth' : '••••' + key.suffix} ／ {key.scope === 'read' ? t('只读') : t('读写')} ／ {Date.parse(key.expiresAt) <= Date.now() ? t('已过期') : t('有效')}<br />
                  {t('到期 {date}', { date: date.format(new Date(key.expiresAt)) })}</div></div>
                {revoke === key.id ? <div className="mcp-actions">
                  <span>{t('撤销后该客户端将失去访问权限。')}</span>
                  <button type="button" className="danger-button" disabled={busy} onClick={() => action(async () => {
                    await request(base + '/keys/' + key.id, 'DELETE');
                    setRevoke(null);
                    setMessage('访问凭据已撤销。');
                    await refresh();
                  })}>{t('确认撤销')}</button>
                  <button type="button" onClick={() => setRevoke(null)}>{t('取消')}</button>
                </div> : <button type="button" className="danger-button" disabled={busy} onClick={() => setRevoke(key.id)}>{t('撤销')}</button>}
              </li>)}
            </ul>}
          </div>
        </>}
        {data && section === 'activity' && <>
          <p>{isStdio ? t('显示白板服务收到的读取、保存、选区和视口请求。客户端本地的握手和渲染不会出现在这里。') : t('显示远程 MCP 工具调用。')} {t('最近保留 200 条，服务重启后清空。')}</p>
          <dl className="mcp-summary">
            <div><dt>{isStdio ? t('请求总数') : t('调用总数')}</dt><dd>{activity.length}</dd></div>
            <div><dt>{t('成功')}</dt><dd>{successes}</dd></div>
            <div><dt>{t('失败')}</dt><dd>{activity.length - successes}</dd></div>
          </dl>
          <div className="mcp-heading">
            <label>{isStdio ? t('请求结果') : t('调用结果')} <select value={filter} onChange={event => setFilter(event.target.value)}>
              <option value="all">{t('全部')}</option><option value="ok">{t('成功')}</option><option value="error">{t('失败')}</option>
            </select></label>
            <button type="button" disabled={busy} onClick={() => action(refresh)}>{t('刷新记录')}</button>
          </div>
          {records.length === 0 ? <p>{t('暂无匹配的记录。')}</p> : <ul className="mcp-list">
            {records.map(record => <li key={record.id}>
              <div><strong>{t(record.operation)}</strong><div className="mcp-meta">{record.key} ／ {date.format(new Date(record.at))}</div></div>
              <span className={record.ok ? undefined : 'dialog-error'}>{record.ok ? t('成功') : t('失败')} ／ {record.ms} ms</span>
            </li>)}
          </ul>}
        </>}
      </section>
    </div>
  </dialog>;
}
