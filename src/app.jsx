import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Excalidraw, MainMenu, serializeAsJSON } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import './workspace.css';

window.EXCALIDRAW_ASSET_PATH = '/assets/';
const boardId = /^\/boards\/([^/]+)$/.exec(location.pathname)?.[1];
const shareToken = /^\/share\/([\w-]{43})$/.exec(location.pathname)?.[1];
const savedBoard = Boolean(boardId || shareToken);
const endpoint = shareToken ? `/api/share/${shareToken}` : boardId ? `/api/boards/${encodeURIComponent(boardId)}` : '/api/current';

async function request(path, method = 'GET', data) {
  const response = await fetch(path, {
    method,
    headers: data ? { 'Content-Type': 'application/json' } : undefined,
    body: data ? JSON.stringify(data) : undefined,
  });
  const value = await response.json().catch(() => null);
  if (!response.ok || !value) throw new Error(value?.error || '暂时无法连接白板服务，请重试。');
  return value;
}

function sceneJSON(elements, appState, files) {
  const scene = JSON.parse(serializeAsJSON(elements, {
    gridSize: 20, gridStep: 5, gridModeEnabled: false, viewBackgroundColor: '#ffffff', ...appState,
  }, files, 'local'));
  return JSON.stringify({ elements: scene.elements, appState: scene.appState, files: scene.files });
}

const icons = {
  archive: 'M3 8h18v12H3zM2 4h20v4H2zM9 12h6',
  board: 'M4 4h16v16H4zM8 15l3-5 3 3 2-4',
  copy: 'M8 8h12v12H8zM16 4H4v12',
  plus: 'M12 5v14M5 12h14',
  share: 'M12 15V3m-4 4 4-4 4 4M5 12v8h14v-8',
  close: 'm6 6 12 12M18 6 6 18',
  arrow: 'M5 12h14m-5-5 5 5-5 5',
  link: 'M10 13a3 3 0 0 0 4 0l4-4a3 3 0 0 0-4-4l-2 2m2 4a3 3 0 0 0-4 0l-4 4a3 3 0 0 0 4 4l2-2',
  edit: 'm5 16-1 4 4-1L19 8l-3-3zM14 7l3 3',
};
function Icon({ name }) {
  return <svg className="icon" width="18" height="18" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={icons[name]} />
  </svg>;
}
function Brand() {
  return <div className="brand"><span className="brand-mark"><Icon name="board" /></span><span>个人白板</span></div>;
}
const archiveDate = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
function displayName(name) {
  if (!name) return '当前白板';
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(name) && !Number.isNaN(Date.parse(name))
    ? archiveDate.format(new Date(name)) : name;
}

// Excalidraw 0.18.1 does not expose these labels through component props.
function useCanvasAccessibility() {
  const root = useRef(null);
  useEffect(() => {
    const canvas = root.current;
    function labelControls() {
      const menu = canvas.querySelector('.main-menu-trigger');
      if (menu && !menu.hasAttribute('aria-label')) menu.setAttribute('aria-label', '白板菜单');
      const labels = [
        ['.sidebar-tab-trigger[id$="-trigger-search"]', '搜索素材'],
        ['.sidebar-tab-trigger[id$="-trigger-library"]', '素材库'],
        ['.library-menu-dropdown-container > .dropdown-menu-button', '素材库操作'],
      ];
      for (const [selector, label] of labels) {
        for (const control of canvas.querySelectorAll(selector)) {
          if (!control.hasAttribute('aria-label')) control.setAttribute('aria-label', label);
        }
      }
      for (const picker of canvas.querySelectorAll('.color-picker-container[role="dialog"]')) {
        if (!picker.hasAttribute('aria-label')) picker.setAttribute('aria-label', '颜色选择');
      }
      const theme = canvas.querySelector('[data-testid="toggle-dark-mode"]');
      if (theme) theme.setAttribute('aria-label', theme.textContent.trim());
      const zoom = canvas.querySelector('.reset-zoom-button');
      if (zoom) zoom.setAttribute('aria-label', `${zoom.textContent.trim()}，重置缩放`);
      const footer = canvas.querySelector('footer');
      if (footer) footer.setAttribute('role', 'presentation');
    }
    const observer = new MutationObserver(labelControls);
    observer.observe(canvas, { subtree: true, childList: true, characterData: true });
    function labelPortals() {
      const help = window.document.querySelector('.HelpDialog')?.closest('[role="dialog"]');
      if (help && !help.hasAttribute('aria-label') && !window.document.getElementById(help.getAttribute('aria-labelledby') || '')) {
        help.setAttribute('aria-label', '白板帮助');
      }
      const tooltip = window.document.querySelector('.excalidraw-tooltip');
      if (tooltip && !tooltip.hasAttribute('role')) tooltip.setAttribute('role', 'tooltip');
    }
    const portals = new MutationObserver(labelPortals);
    portals.observe(window.document.body, { childList: true });
    labelControls();
    labelPortals();
    return () => { observer.disconnect(); portals.disconnect(); };
  }, []);
  return root;
}

function Workspace({ initial, session }) {
  const [document, setDocument] = useState(initial);
  const [status, setStatus] = useState('已载入');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [boards, setBoards] = useState(null);
  const [archiveQuery, setArchiveQuery] = useState('');
  const archiveSearch = useRef(null);
  const focusArchive = useRef(false);
  const newDialog = useRef(null);
  const [renaming, setRenaming] = useState(false);
  const renameInput = useRef(null);
  const [share, setShare] = useState(initial.share || '');
  const [shareTarget, setShareTarget] = useState(boardId || null);
  const [shareMessage, setShareMessage] = useState('');
  const [shareOpen, setShareOpen] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const dialog = useRef(null);
  const drawing = useRef(null);
  const connection = useRef(null);
  const selection = useRef('');
  const canvas = useCanvasAccessibility();
  const writing = useRef(false);
  const initialized = useRef(null);
  const remote = useRef(null);
  const [name, setName] = useState(initial.name || '');
  const record = useRef(initial);
  const timer = useRef();
  const queue = useRef(Promise.resolve());
  const baseline = useRef(sceneJSON(initial.scene.elements, initial.scene.appState, initial.scene.files));
  const latest = useRef(baseline.current);
  const locked = useRef(false);

  useEffect(() => {
    const protect = event => {
      if (latest.current !== baseline.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', protect);
    return () => {
      window.removeEventListener('beforeunload', protect);
      clearTimeout(timer.current);
    };
  }, []);

  function acceptRemote() {
    const next = remote.current;
    if (!next || writing.current || locked.current) return;
    const previous = record.current;
    if (next.generation === previous.generation && next.revision <= previous.revision) {
      remote.current = null;
      return;
    }
    if (latest.current !== baseline.current) {
      setError('其他窗口已保存更新。当前草稿仍在此窗口，请先导出草稿，再重新加载。');
      return;
    }
    remote.current = null;
    if (next.generation !== previous.generation) {
      setShareTarget(null);
      setShare('');
    }
    record.current = next;
    const { elements, appState, files } = next.scene;
    baseline.current = latest.current = sceneJSON(elements, appState, files);
    setDocument(next);
    setName(next.name || '');
    setEpoch(value => value + 1);
    setStatus('已同步');
  }

  useEffect(() => {
    const url = new URL(endpoint + '/events', location.origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    let socket;
    let timer;
    let stopped = false;
    let delay = 500;
    function connect() {
      socket = new WebSocket(url);
      connection.current = socket;
      socket.onopen = () => {
        selection.current = '';
        delay = 500;
      };
      socket.onmessage = event => {
        const message = JSON.parse(event.data);
        if (message.type === 'revoked') {
          stopped = true;
          setRevoked(true);
          setError('访问权限已撤销。可导出当前草稿。');
          socket.close();
        } else if (message.type === 'viewport') {
          const api = drawing.current;
          if (!api || message.generation !== record.current.generation) return;
          const view = message.viewport;
          const ids = view.scrollToElementIds || (view.scrollToElementId ? [view.scrollToElementId] : []);
          if (view.scrollToContent || ids.length) {
            const elements = api.getSceneElements().filter(item => !ids.length || ids.includes(item.id));
            if (elements.length) api.scrollToContent(elements, {
              fitToViewport: Boolean(view.scrollToContent || view.scrollToElementIds), viewportZoomFactor: view.viewportZoomFactor,
            });
          } else {
            api.updateScene({ appState: {
              ...(view.zoom === undefined ? {} : { zoom: { value: view.zoom } }),
              ...(view.offsetX === undefined ? {} : { scrollX: view.offsetX }),
              ...(view.offsetY === undefined ? {} : { scrollY: view.offsetY }),
            } });
          }
        } else if (message.type === 'board') {
          remote.current = message.board;
          acceptRemote();
        }
      };
      socket.onclose = () => {
        if (stopped) return;
        timer = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 15_000);
      };
    }
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      socket?.close();
    };
  }, []);

  useEffect(() => {
    if (shareOpen && !dialog.current.open) dialog.current.showModal();
    if (!shareOpen && dialog.current.open) dialog.current.close();
  }, [shareOpen]);

  function exportDraft() {
    const data = { type: 'excalidraw', version: 2, source: location.origin, ...JSON.parse(latest.current) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    const link = window.document.createElement('a');
    link.href = url;
    link.download = '白板草稿.excalidraw';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function persist() {
    clearTimeout(timer.current);
    const task = queue.current.then(async () => {
      const snapshot = latest.current;
      if (snapshot === baseline.current) return;
      setStatus('正在保存');
      const { revision, generation } = record.current;
      writing.current = true;
      try {
        record.current = await request(endpoint, savedBoard ? 'PATCH' : 'PUT', {
          revision, generation, scene: JSON.parse(snapshot),
        });
      } finally {
        writing.current = false;
      }
      baseline.current = snapshot;
      setError('');
      setStatus(snapshot === latest.current ? '已保存' : '等待保存');
      acceptRemote();
    });
    queue.current = task.catch(message => {
      setError(message.message);
      setStatus('未保存');
    });
    return task;
  }

  function change(elements, appState, files) {
    if (locked.current || appState.isLoading) return;
    if (!savedBoard && connection.current?.readyState === WebSocket.OPEN) {
      const ids = Object.keys(appState.selectedElementIds || {}).filter(id => appState.selectedElementIds[id] && id.length <= 100).slice(0, 100);
      const message = JSON.stringify({ type: 'selection', generation: record.current.generation, ids });
      if (message !== selection.current) {
        selection.current = message;
        connection.current.send(message);
      }
    }
    const snapshot = sceneJSON(elements, appState, files);
    const mount = `${document.generation || document.id}:${epoch}`;
    if (initialized.current !== mount) {
      initialized.current = mount;
      baseline.current = latest.current = snapshot;
      return;
    }
    if (snapshot === latest.current) return;
    latest.current = snapshot;
    if (!boardId || share || shareToken) {
      setStatus('等待保存');
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void persist().catch(() => {}), 500);
    } else {
      setStatus(snapshot === baseline.current ? '已保存' : '有未保存更改');
    }
  }

  async function action(callback) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      await callback();
    } catch (failure) {
      setError(failure.message);
    } finally {
      locked.current = false;
      setBusy(false);
      acceptRemote();
    }
  }

  const version = () => ({ revision: record.current.revision, generation: record.current.generation });
  function saveCopy() {
    return action(async () => {
      await persist();
      await request('/api/current/save', 'POST', version());
      setStatus('已保存副本');
      if (boards) setBoards(await request('/api/boards'));
    });
  }
  function newBoard() {
    return action(async () => {
      await persist();
      const result = await request('/api/current/new', 'POST', version());
      record.current = result.current;
      const { elements, appState, files } = result.current.scene;
      baseline.current = latest.current = sceneJSON(elements, appState, files);
      setDocument(result.current);
      setStatus(result.archived ? '已归档旧白板' : '已新建白板');
      setShareTarget(null);
      setShare('');
      newDialog.current.close();
      if (boards) setBoards(await request('/api/boards'));
    });
  }

  function openShare() {
    setError('');
    setShareMessage('');
    if (!boardId && !shareTarget) {
      setShareOpen(true);
      return;
    }
    return action(async () => {
      const result = await request(`/api/boards/${boardId || shareTarget}`);
      setShare(result.share || '');
      setShareOpen(true);
    });
  }

  async function toggleShare(enabled) {
    setShareMessage('');
    const target = boardId || shareTarget;
    if (!target) {
      await persist();
      const copy = await request('/api/current/share', 'POST', version());
      setShareTarget(copy.id);
      setShare(copy.share);
      setShareMessage('副本已创建，可以复制编辑链接。');
      if (boards) setBoards(await request('/api/boards'));
      return;
    }
    const result = await request(`/api/boards/${target}/share`, 'PUT', { enabled });
    setShare(result.share || '');
    setShareMessage(enabled ? '编辑链接已创建。' : '分享已撤销，原编辑链接已失效。');
  }

  async function openArchive() {
    if (boards) return closeArchive();
    await action(async () => {
      setArchiveQuery('');
      const entries = await request('/api/boards');
      focusArchive.current = true;
      setBoards(entries);
    });
  }

  useEffect(() => {
    if (boards && !busy && focusArchive.current) {
      focusArchive.current = false;
      (archiveSearch.current || window.document.querySelector('#archive-panel button'))?.focus();
    }
  }, [boards, busy]);

  function focusBoardMenu() {
    requestAnimationFrame(() => canvas.current?.querySelector('.main-menu-trigger')?.focus());
  }

  function closeArchive() {
    setBoards(null);
    focusBoardMenu();
  }

  function closeRename() {
    setRenaming(false);
    focusBoardMenu();
  }

  useEffect(() => {
    if (renaming) renameInput.current?.select();
  }, [renaming]);

  const visibleBoards = boards?.toReversed().filter(board => displayName(board.name).toLowerCase().includes(archiveQuery.trim().toLowerCase()));
  return <main className="workspace" aria-label={displayName(document.name)} aria-busy={busy}>
    <div className="work-surface">
      <div className="board-overlay">
        {(busy || status === '正在保存') && !error && <div className="board-loading" role="status"
          aria-label={busy ? '正在处理白板' : '正在保存白板'}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M20 12a8 8 0 1 1-8-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>}
      {renaming && <form className="rename" onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); if (!busy) closeRename(); }
      }} onSubmit={event => {
        event.preventDefault();
        void action(async () => {
          record.current = await request(endpoint, 'PATCH', { revision: record.current.revision, name });
          setDocument(record.current);
          setName(record.current.name);
          setStatus('已重命名');
          closeRename();
        });
      }}>
        <input ref={renameInput} aria-label="白板名称" value={name} onChange={event => setName(event.target.value)}
          required maxLength={200} disabled={busy} />
        <button disabled={busy || !name.trim() || name.trim() === displayName(document.name)}>重命名</button>
        <button type="button" disabled={busy} onClick={closeRename}>取消</button>
      </form>}
      {error && !shareOpen && !newDialog.current?.open && <div className="problem" role="alert"><span>{error}</span><div className="problem-actions">
        <button onClick={exportDraft}>导出草稿</button>
        {!revoked && <button disabled={busy} onClick={() => action(persist)}>重试保存</button>}
      </div></div>}
      </div>
      <div className="drawing-area">
        {boards && <aside id="archive-panel" className="library" aria-labelledby="files-heading" onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); closeArchive(); }
        }}>
          <div className="panel-heading">
            <h2 id="files-heading">白板档案</h2>
            <button className="icon-button" aria-label="关闭白板档案" onClick={closeArchive}><Icon name="close" /></button>
          </div>
          {boards.length ? <>
            <label className="archive-search">搜索档案
              <input ref={archiveSearch} value={archiveQuery} onChange={event => setArchiveQuery(event.target.value)} type="search" />
            </label>
            <p className="archive-count" role="status">{archiveQuery ? `找到 ${visibleBoards.length} 份白板` : `${boards.length} 份白板`}</p>
            {visibleBoards.length === 0 && <p className="empty-archive">没有找到匹配的白板。试试其他名称。</p>}
            <ul>{visibleBoards.map(board => <li key={board.id}>
              <a href={`/boards/${board.id}`} aria-current={board.id === boardId ? 'page' : undefined}>
                <Icon name="board" /><span>{displayName(board.name)}</span>
              </a>
            </li>)}</ul>
          </> : <p className="empty-archive">还没有档案。保存副本或新建白板后，可以在这里打开之前的内容。</p>}
          {session.mode !== 'public' && <button className="logout" onClick={() => action(async () => {
            if (latest.current !== baseline.current) await persist();
            await request('/auth/logout', 'POST');
            location.href = '/';
          })}>退出登录</button>}
        </aside>}
        <section ref={canvas} className="canvas" aria-label="绘图画布">
          <Excalidraw key={`${document.generation || document.id}:${epoch}`} initialData={{ ...document.scene, scrollToContent: true }}
            excalidrawAPI={api => { drawing.current = api; }} langCode="zh-CN" onChange={change} viewModeEnabled={busy || revoked}
            UIOptions={{ canvasActions: { saveToActiveFile: false, loadScene: false, export: false } }}>
            <MainMenu>
              {session.owner && <MainMenu.Item icon={<Icon name="archive" />} disabled={busy} onSelect={openArchive}>白板档案</MainMenu.Item>}
              {savedBoard && session.owner && <MainMenu.Item onSelect={() => { location.href = '/'; }}>返回当前白板</MainMenu.Item>}
              {savedBoard ? <>
                <MainMenu.Item disabled={busy || revoked} onSelect={() => action(persist)}>保存更改</MainMenu.Item>
                {boardId && <MainMenu.Item icon={<Icon name="edit" />} disabled={busy} onSelect={() => {
                  setName(displayName(document.name));
                  setRenaming(true);
                }}>修改白板名称</MainMenu.Item>}
              </> : <>
                <MainMenu.Item icon={<Icon name="plus" />} disabled={busy} onSelect={() => {
                  setError('');
                  requestAnimationFrame(() => newDialog.current?.showModal());
                }}>新建白板</MainMenu.Item>
                <MainMenu.Item icon={<Icon name="copy" />} disabled={busy} onSelect={saveCopy}>保存副本</MainMenu.Item>
              </>}
              {!shareToken && <MainMenu.Item icon={<Icon name="share" />} disabled={busy} onSelect={openShare}>
                {boardId ? '分享白板' : '分享副本'}
              </MainMenu.Item>}
              <MainMenu.Separator />
              <MainMenu.Item onSelect={exportDraft}>导出白板文件</MainMenu.Item>
              <MainMenu.DefaultItems.ToggleTheme />
              <MainMenu.DefaultItems.ChangeCanvasBackground />
            </MainMenu>
          </Excalidraw>
        </section>
      </div>

    </div>
    <dialog ref={newDialog} className="share-dialog" aria-labelledby="new-heading"
      onCancel={event => { if (busy) event.preventDefault(); }}
      onClose={() => { setError(''); focusBoardMenu(); }}>
      <h2 id="new-heading">新建白板</h2>
      <p>有内容的当前白板会先保存到档案，然后打开空白画布。</p>
      {error && <p className="dialog-error" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button type="button" autoFocus disabled={busy} onClick={() => newDialog.current.close()}>取消</button>
        <button type="button" className="primary" disabled={busy} onClick={newBoard}>{busy ? '正在新建…' : '确认新建'}</button>
      </div>
    </dialog>
    <dialog ref={dialog} className="share-dialog" onCancel={event => { if (busy) event.preventDefault(); }}
      onClose={() => { setShareOpen(false); setError(''); focusBoardMenu(); }}
      aria-labelledby="share-heading">
      <div className="panel-heading">
        <h2 id="share-heading">{boardId ? '分享白板' : '分享副本'}</h2>
        <button className="icon-button" aria-label="关闭" disabled={busy} onClick={() => setShareOpen(false)}><Icon name="close" /></button>
      </div>
      {!boardId && !shareTarget && <p>把当前内容保存为一张独立白板，供其他人共同编辑。你会留在当前画布。</p>}
      {!boardId && shareTarget && <p>链接指向独立副本。当前画布和副本的编辑各自保存。</p>}
      <p className="sharing-policy">{session.mode === 'public' ? '这是公开白板。撤销分享链接后，原白板地址仍可编辑。' : '有编辑链接的人可以共同编辑。撤销链接会断开访客的连接。'}</p>
      {share ? <>
        <label className="share-field">编辑链接
          <input readOnly aria-label="分享链接" value={`${location.origin}/share/${share}`}
            onFocus={event => event.currentTarget.select()} />
        </label>
        <div className="dialog-actions">
          <button className="primary" disabled={busy} onClick={() => action(async () => {
            await navigator.clipboard.writeText(`${location.origin}/share/${share}`);
            setShareMessage('链接已复制。');
          })}><Icon name="copy" />复制链接</button>
          <button className="danger-button" disabled={busy} onClick={() => action(() => toggleShare(false))}>{busy ? '处理中…' : '撤销分享'}</button>
        </div>
      </> : <div className="dialog-actions">
        <button className="primary" disabled={busy} onClick={() => action(() => toggleShare(true))}>
          {busy ? '正在创建…' : shareTarget ? '创建编辑链接' : '创建共享副本'}
        </button>
      </div>}
      {!boardId && shareTarget && <a className="share-archive-link" href={`/boards/${shareTarget}`}>打开共享副本</a>}
      {shareMessage && <p className="dialog-feedback" role="status">{shareMessage}</p>}
      {error && <p className="dialog-error" role="alert">{error}</p>}
    </dialog>
  </main>;
}

function App() {
  const [initial, setInitial] = useState(null);
  const [session, setSession] = useState(null);
  const [error, setError] = useState(new URLSearchParams(location.search).get('login') === 'failed' ? '登录未完成，请重试或联系管理员。' : '');
  const [busy, setBusy] = useState(false);
  const signingIn = useRef(false);
  useEffect(() => {
    request('/auth/session').then(value => {
      setSession(value);
      if (shareToken || value.owner) return request(endpoint).then(setInitial);
    }).catch(failure => setError(failure.message));
  }, []);
  if (initial) return <Workspace initial={initial} session={session} />;
  if (session && !session.owner && !shareToken) return <main className="login-page">
    <div className="login-intro">
      <Brand />
      <h1 id="login-heading">打开你的白板</h1>
      <p>登录后打开你的白板和档案。</p>
    <div className="login-illustration" aria-hidden="true">
      <svg viewBox="0 0 420 300" fill="none">
        <path d="M110 100v104h101m-31-20 31 20-31 20M261 103h68v66" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <rect x="52" y="58" width="116" height="65" rx="10" fill="var(--paper)" stroke="currentColor" strokeWidth="2"/>
        <rect x="212" y="171" width="123" height="68" rx="10" fill="var(--paper)" stroke="currentColor" strokeWidth="2"/>
        <path d="m220 59 45 44-45 44-45-44z" fill="var(--accent-wash)" stroke="currentColor" strokeWidth="2"/>
        <path d="M74 84h67m-67 15h42m158 100h39m-59 15h59" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        <circle cx="329" cy="174" r="6" fill="currentColor"/>
      </svg>
    </div>
    </div>
    <section className="login" aria-labelledby="login-heading">
      {session.mode === 'oidc' ? <a className="primary sign-in-link" href="/auth/oidc">使用身份服务登录</a> : <form onSubmit={async event => {
        event.preventDefault();
        if (signingIn.current) return;
        signingIn.current = true;
        const data = Object.fromEntries(new FormData(event.currentTarget));
        setError('');
        setBusy(true);
        try {
          await request('/auth/password', 'POST', data);
          location.reload();
        } catch (failure) {
          setError(failure.message);
        } finally {
          signingIn.current = false;
          setBusy(false);
        }
      }}>
        <label>用户名<input name="username" required autoComplete="username" /></label>
        <label>密码<input name="password" type="password" required autoComplete="current-password" /></label>
        <button className="primary" disabled={busy}>{busy ? '正在登录…' : '登录'}</button>
      </form>}
      {error && <p role="alert">{error}</p>}
  </section></main>;
  if (error) return <main className="problem standalone" role="alert">{error} <a href="/">返回当前白板</a></main>;
  return <main className="loading"><Brand /><p role="status">正在载入白板</p></main>;
}

createRoot(document.getElementById('root')).render(<App />);
