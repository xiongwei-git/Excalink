import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Excalidraw, MainMenu, serializeAsJSON } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import './workspace.css';
import { McpSettings } from './mcp-settings.jsx';
import { localeNames, preferredLocale, savedLocale, translator } from './locale.js';

window.EXCALIDRAW_ASSET_PATH = '/assets/';
const mcpLogin = /^[\w-]{43}$/.exec(new URLSearchParams(location.search).get('mcp_login') || '')?.[0];
const boardId = /^\/boards\/([^/]+)$/.exec(location.pathname)?.[1];
const shareToken = /^\/share\/([\w-]{43})$/.exec(location.pathname)?.[1];
const savedBoard = Boolean(boardId || shareToken);
const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform);
const shiftAlt = key => ({
  code: 'Key' + key, shift: true, alt: true,
  label: isMac ? `⌥⇧${key}` : `Alt ⇧ ${key}`, aria: 'Shift+Alt+' + key,
});
const saveShortcut = shift => ({
  code: 'KeyS', mod: true, shift,
  label: isMac ? (shift ? '⇧⌘S' : '⌘S') : (shift ? 'Ctrl ⇧ S' : 'Ctrl S'),
  aria: [isMac ? 'Meta' : 'Control', ...(shift ? ['Shift'] : []), 'S'].join('+'),
});
const backgroundShortcut = shiftAlt('B');
const themeShortcut = shiftAlt('D');
const endpoint = shareToken ? `/api/share/${shareToken}` : boardId ? `/api/boards/${encodeURIComponent(boardId)}` : '/api/current';

async function request(path, method = 'GET', data) {
  const response = await fetch(path, {
    method,
    headers: data ? { 'Content-Type': 'application/json' } : undefined,
    body: data ? JSON.stringify(data) : undefined,
  }).catch(() => { throw new Error('暂时无法连接白板服务，请重试。'); });
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
  home: 'm3 10 9-7 9 7v10H3zM9 20v-6h6v6',
  save: 'M4 4h13l3 3v13H4zM8 4v6h8V4M8 20v-6h8v6',
  copy: 'M8 8h12v12H8zM16 4H4v12',
  plus: 'M12 5v14M5 12h14',
  share: 'M12 15V3m-4 4 4-4 4 4M5 12v8h14v-8',
  download: 'M12 3v12m-4-4 4 4 4-4M5 12v8h14v-8',
  close: 'm6 6 12 12M18 6 6 18',
  arrow: 'M5 12h14m-5-5 5 5-5 5',
  mcp: 'M5 13h14M8 13v-3a4 4 0 0 1 8 0v3m-8 0v2a4 4 0 0 0 8 0v-2M10 4V2m4 2V2m-2 17v3',
  language: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20ZM2 12h20M12 2a16 16 0 0 1 0 20 16 16 0 0 1 0-20Z',
  link: 'M10 13a3 3 0 0 0 4 0l4-4a3 3 0 0 0-4-4l-2 2m2 4a3 3 0 0 0-4 0l-4 4a3 3 0 0 0 4 4l2-2',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5',
  edit: 'm5 16-1 4 4-1L19 8l-3-3zM14 7l3 3',
};
function Icon({ name, size = 18 }) {
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth={size === 16 ? 1.5 : 1.65} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={icons[name]} />
  </svg>;
}
function Brand({ t }) {
  return <div className="brand"><span className="brand-mark"><Icon name="board" /></span><span>{t('个人白板')}</span></div>;
}

// Excalidraw 0.18.1 does not expose these labels through component props.
function useCanvasAccessibility(t) {
  const root = useRef(null);
  useEffect(() => {
    const canvas = root.current;
    function labelControls() {
      const menu = canvas.querySelector('.main-menu-trigger');
      if (menu) menu.setAttribute('aria-label', t('白板菜单'));
      const labels = [
        ['.sidebar-tab-trigger[id$="-trigger-search"]', t('搜索素材')],
        ['.sidebar-tab-trigger[id$="-trigger-library"]', t('素材库')],
        ['.library-menu-dropdown-container > .dropdown-menu-button', t('素材库操作')],
      ];
      for (const [selector, label] of labels) {
        for (const control of canvas.querySelectorAll(selector)) {
          control.setAttribute('aria-label', label);
        }
      }
      for (const picker of canvas.querySelectorAll('.color-picker-container[role="dialog"]')) {
        picker.setAttribute('aria-label', t('颜色选择'));
      }
      const background = canvas.querySelector('.workspace-menu-background .properties-trigger');
      if (background) background.setAttribute('aria-keyshortcuts', backgroundShortcut.aria);
      const theme = canvas.querySelector('[data-testid="toggle-dark-mode"]');
      if (theme) {
        theme.setAttribute('aria-keyshortcuts', themeShortcut.aria);
        const hint = theme.querySelector('.dropdown-menu-item__shortcut');
        if (hint && hint.textContent !== themeShortcut.label) hint.textContent = themeShortcut.label;
        theme.setAttribute('aria-label', theme.textContent.trim());
      }
      const zoom = canvas.querySelector('.reset-zoom-button');
      if (zoom) zoom.setAttribute('aria-label', t('{zoom}，重置缩放', { zoom: zoom.textContent.trim() }));
      const footer = canvas.querySelector('footer');
      if (footer) footer.setAttribute('role', 'presentation');
    }
    const observer = new MutationObserver(labelControls);
    observer.observe(canvas, { subtree: true, childList: true, characterData: true });
    function labelPortals() {
      const help = window.document.querySelector('.HelpDialog')?.closest('[role="dialog"]');
      if (help && !window.document.getElementById(help.getAttribute('aria-labelledby') || '')) {
        help.setAttribute('aria-label', t('白板帮助'));
      }
      const tooltip = window.document.querySelector('.excalidraw-tooltip');
      if (tooltip && !tooltip.hasAttribute('role')) tooltip.setAttribute('role', 'tooltip');
    }
    const portals = new MutationObserver(labelPortals);
    portals.observe(window.document.body, { childList: true });
    labelControls();
    labelPortals();
    return () => { observer.disconnect(); portals.disconnect(); };
  }, [t]);
  return root;
}

function Workspace({ initial, session, locale, t, changeLocale }) {
  const archiveDate = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  function displayName(name) {
    if (!name) return t('当前白板');
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(name) && !Number.isNaN(Date.parse(name))
      ? archiveDate.format(new Date(name)) : name;
  }
  const [document, setDocument] = useState(initial);
  const [status, setStatus] = useState('已载入');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [boards, setBoards] = useState(null);
  const [archiveQuery, setArchiveQuery] = useState('');
  const archiveSearch = useRef(null);
  const focusArchive = useRef(false);
  const newDialog = useRef(null);
  const [renaming, setRenaming] = useState(null);
  const [renameError, setRenameError] = useState('');
  const renameInput = useRef(null);
  const deleteDialog = useRef(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteError, setDeleteError] = useState('');
  const [share, setShare] = useState(initial.share || '');
  const [shareMessage, setShareMessage] = useState('');
  const [mcpOpen, setMcpOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const dialog = useRef(null);
  const drawing = useRef(null);
  const connection = useRef(null);
  const selection = useRef('');
  const canvas = useCanvasAccessibility(t);
  const writing = useRef(false);
  const initialized = useRef(null);
  const remote = useRef(null);
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
      setShare('');
    }
    record.current = next;
    const { elements, appState, files } = next.scene;
    baseline.current = latest.current = sceneJSON(elements, appState, files);
    setDocument(next);
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
    link.download = t('白板草稿.excalidraw');
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
      setShare('');
      newDialog.current.close();
      if (boards) setBoards(await request('/api/boards'));
    });
  }

  function openShare() {
    setError('');
    setShareMessage('');
    return action(async () => {
      const result = await request(endpoint);
      setShare(result.share || '');
      setShareOpen(true);
    });
  }

  async function toggleShare(enabled) {
    setShareMessage('');
    if (!boardId) await persist();
    const result = boardId
      ? await request(`/api/boards/${boardId}/share`, 'PUT', { enabled })
      : await request('/api/current/share', 'POST', { ...version(), enabled });
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
    if (busy && renaming) return;
    setRenaming(null);
    setRenameError('');
    setBoards(null);
    focusBoardMenu();
  }

  function beginRename(board) {
    if (busy) return;
    setRenameError('');
    setRenaming({ id: board.id, value: displayName(board.name) });
  }

  function renameOpenBoard() {
    return action(async () => {
      const entries = await request('/api/boards');
      const board = entries.find(entry => entry.id === boardId);
      if (!board) throw new Error('未找到此白板。');
      setArchiveQuery('');
      setBoards(entries);
      setRenameError('');
      setRenaming({ id: board.id, value: displayName(board.name) });
    });
  }

  function closeRename(id) {
    setRenaming(null);
    setRenameError('');
    requestAnimationFrame(() => {
      (window.document.querySelector(`[data-archive-rename="${id}"]`) || archiveSearch.current)?.focus();
    });
  }

  useEffect(() => {
    if (renaming?.id) {
      renameInput.current?.focus();
      renameInput.current?.select();
    }
  }, [renaming?.id]);

  function saveArchiveName(board) {
    const value = renaming.value.trim();
    if (!value) {
      setRenameError('请输入白板名称。');
      return;
    }
    if (value === displayName(board.name)) return closeRename(board.id);
    return action(async () => {
      try {
        if (board.id === boardId) await queue.current;
        const revision = board.id === boardId ? record.current.revision : board.revision;
        const updated = await request(`/api/boards/${board.id}`, 'PATCH', { revision, name: value });
        setBoards(entries => entries.map(entry => entry.id === board.id ? { id: updated.id, name: updated.name, revision: updated.revision } : entry));
        if (board.id === boardId) {
          record.current = updated;
          setDocument(updated);
          setStatus('已重命名');
        }
        closeRename(board.id);
      } catch (failure) {
        setRenameError(failure.message);
        requestAnimationFrame(() => renameInput.current?.focus());
      }
    });
  }

  function confirmArchiveDeletion(board) {
    setDeleteTarget(board.id === boardId ? { ...board, revision: record.current.revision } : board);
    setDeleteError('');
    deleteDialog.current.showModal();
  }

  function deleteArchive() {
    const board = deleteTarget;
    return action(async () => {
      try {
        if (board.id === boardId) await queue.current;
        await request(`/api/boards/${board.id}`, 'DELETE', { revision: board.revision });
        if (board.id === boardId) {
          clearTimeout(timer.current);
          baseline.current = latest.current;
          location.href = '/';
          return;
        }
        setBoards(entries => entries.filter(entry => entry.id !== board.id));
        deleteDialog.current.close();
        requestAnimationFrame(() => (archiveSearch.current || window.document.querySelector('#archive-panel button'))?.focus());
      } catch (failure) {
        setDeleteError(failure.message);
      }
    });
  }

  const menuItems = [
    session.owner && { label: t('白板档案'), icon: 'archive', shortcut: shiftAlt('O'), disabled: busy, run: openArchive },
    savedBoard && session.owner && { label: t('返回当前白板'), icon: 'home', shortcut: shiftAlt('H'), run: () => { location.href = '/'; } },
    savedBoard
      ? { label: t('保存更改'), icon: 'save', shortcut: saveShortcut(false), disabled: busy || revoked, run: () => action(persist) }
      : { label: t('新建白板'), icon: 'plus', shortcut: shiftAlt('N'), disabled: busy, run: () => {
        setError('');
        requestAnimationFrame(() => newDialog.current?.showModal());
      } },
    boardId && session.owner && { label: t('修改白板名称'), icon: 'edit',
      shortcut: { code: 'F2', label: 'F2', aria: 'F2' }, disabled: busy, run: renameOpenBoard },
    !savedBoard && { label: t('保存副本'), icon: 'copy', shortcut: saveShortcut(true), disabled: busy, run: saveCopy },
    !shareToken && { label: boardId ? t('分享白板') : t('分享当前白板'), icon: 'share', shortcut: shiftAlt('S'), disabled: busy, run: openShare },
    { label: t('导出文件'), icon: 'download', shortcut: shiftAlt('E'), run: exportDraft },
  ].filter(Boolean);
  const mcpItem = session.owner && !shareToken && {
    label: t('MCP 服务'), icon: 'mcp', shortcut: shiftAlt('M'), run: () => setMcpOpen(true),
  };
  const backgroundItem = {
    shortcut: backgroundShortcut, disabled: busy || revoked, keepMenuOpen: true,
    run: () => drawing.current?.updateScene({ appState: { openMenu: 'canvas', openPopup: 'canvasBackground' } }),
  };

  useEffect(() => {
    function handleShortcut(event) {
      if (event.defaultPrevented || event.repeat || event.isComposing || renaming || drawing.current?.getAppState().editingTextElement ||
          window.document.querySelector('dialog[open]') ||
          event.target instanceof Element && (event.target.closest('input, textarea, select, [contenteditable], [aria-modal="true"]') ||
          event.code === 'F2' && event.target.closest('#archive-panel'))) return;
      const item = [...menuItems, mcpItem, backgroundItem].find(item => item && !item.disabled &&
        event.code === item.shortcut.code && event.altKey === Boolean(item.shortcut.alt) &&
        event.shiftKey === Boolean(item.shortcut.shift) &&
        event.metaKey === Boolean(isMac && item.shortcut.mod) &&
        event.ctrlKey === Boolean(!isMac && item.shortcut.mod));
      if (!item) return;
      event.preventDefault();
      event.stopPropagation();
      if (!item.keepMenuOpen && drawing.current?.getAppState().openMenu === 'canvas') {
        drawing.current.updateScene({ appState: { openMenu: null } });
      }
      item.run();
    }
    window.addEventListener('keydown', handleShortcut, true);
    return () => window.removeEventListener('keydown', handleShortcut, true);
  });

  function renderMenuItem({ label, icon, shortcut, disabled, run }) {
    return <MainMenu.Item key={icon} className="workspace-menu-item" icon={<Icon name={icon} size={16} />}
      shortcut={shortcut.label} aria-keyshortcuts={shortcut.aria} disabled={disabled} onSelect={run}>{label}</MainMenu.Item>;
  }

  const visibleBoards = boards?.toReversed().filter(board => board.id === renaming?.id || displayName(board.name).toLowerCase().includes(archiveQuery.trim().toLowerCase()));
  return <main className="workspace" aria-label={displayName(document.name)} aria-busy={busy}>
    <div className="work-surface">
      <div className="board-overlay">
        {(busy || status === '正在保存') && !error && <div className="board-loading" role="status"
          aria-label={busy ? t('正在处理白板') : t('正在保存白板')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M20 12a8 8 0 1 1-8-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>}
      {error && !shareOpen && !newDialog.current?.open && <div className="problem" role="alert"><span>{t(error)}</span><div className="problem-actions">
        <button onClick={exportDraft}>{t('导出草稿')}</button>
        {!revoked && <button disabled={busy} onClick={() => action(persist)}>{t('重试保存')}</button>}
      </div></div>}
      </div>
      <div className="drawing-area">
        {boards && <aside id="archive-panel" className="library" aria-labelledby="files-heading" onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); closeArchive(); }
        }}>
          <div className="panel-heading">
            <h2 id="files-heading">{t('白板档案')}</h2>
            <button className="icon-button" aria-label={t('关闭白板档案')} onClick={closeArchive}><Icon name="close" /></button>
          </div>
          {boards.length ? <>
            <label className="archive-search">{t('搜索档案')}
              <input ref={archiveSearch} value={archiveQuery} onChange={event => setArchiveQuery(event.target.value)} type="search" />
            </label>
            <p className="archive-count" role="status">{archiveQuery ? t('找到 {count} 份白板', { count: visibleBoards.length }) : t('{count} 份白板', { count: boards.length })}</p>
            {visibleBoards.length === 0 && <p className="empty-archive">{t('没有找到匹配的白板。试试其他名称。')}</p>}
            <ul>{visibleBoards.map(board => <li key={board.id} onKeyDown={event => {
              if (event.key === 'F2' && !renaming) {
                event.preventDefault();
                beginRename(board);
              }
            }}>
              {renaming?.id === board.id ? <form className="archive-rename" onSubmit={event => {
                event.preventDefault();
                void saveArchiveName(board);
              }} onKeyDown={event => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  if (!busy) closeRename(board.id);
                }
              }}>
                <input ref={renameInput} aria-label={t('白板名称')} aria-invalid={Boolean(renameError)}
                  aria-describedby={renameError ? 'archive-rename-error' : undefined} value={renaming.value}
                  onChange={event => { setRenameError(''); setRenaming({ ...renaming, value: event.target.value }); }}
                  maxLength={200} readOnly={busy} />
                {renameError && <p id="archive-rename-error" role="alert">{t(renameError)}</p>}
              </form> : <div className="archive-row" data-current={board.id === boardId || undefined}>
                <Icon name="board" />
                <span className="archive-name" onDoubleClick={() => beginRename(board)}>{displayName(board.name)}</span>
                <button type="button" className="icon-button" aria-label={t('重命名 {name}', { name: displayName(board.name) })}
                  data-archive-rename={board.id} disabled={busy} onClick={() => beginRename(board)}>
                  <Icon name="edit" />
                </button>
                <a className="archive-open" href={`/boards/${board.id}`} aria-current={board.id === boardId ? 'page' : undefined}
                  aria-label={t('打开 {name}', { name: displayName(board.name) })} title={t('打开白板')}>
                  <Icon name="arrow" />
                </a>
                <button type="button" className="icon-button archive-delete" aria-label={t('删除 {name}', { name: displayName(board.name) })}
                  title={t('删除档案')} disabled={busy} onClick={() => confirmArchiveDeletion(board)}>
                  <Icon name="trash" />
                </button>
              </div>}
            </li>)}</ul>
          </> : <p className="empty-archive">{t('还没有档案。保存副本或新建白板后，可以在这里打开之前的内容。')}</p>}
          {session.mode !== 'public' && <button className="logout" onClick={() => action(async () => {
            if (latest.current !== baseline.current) await persist();
            await request('/auth/logout', 'POST');
            location.href = '/';
          })}>{t('退出登录')}</button>}
        </aside>}
        <section ref={canvas} className="canvas" aria-label={t('绘图画布')}>
          <Excalidraw key={`${document.generation || document.id}:${epoch}`} initialData={{ ...document.scene, scrollToContent: true }}
            excalidrawAPI={api => { drawing.current = api; }} langCode={locale} onChange={change} viewModeEnabled={busy || revoked}
            UIOptions={{ canvasActions: { saveToActiveFile: false, loadScene: false, export: false } }}>
            <MainMenu>
              {menuItems.map(renderMenuItem)}
              <MainMenu.Separator />
              {mcpItem && renderMenuItem(mcpItem)}
              <MainMenu.Item icon={<Icon name="language" size={16} />} onSelect={() => changeLocale(otherLocale(locale))}
                aria-label={t('切换语言') + ' · ' + localeNames[otherLocale(locale)]}>
                {t('语言')} · <span lang={otherLocale(locale)}>{localeNames[otherLocale(locale)]}</span>
              </MainMenu.Item>
              <MainMenu.DefaultItems.ToggleTheme />
              {!backgroundItem.disabled && <div className="workspace-menu-background">
                <span aria-hidden="true">{backgroundShortcut.label}</span>
                <MainMenu.DefaultItems.ChangeCanvasBackground />
              </div>}
            </MainMenu>
          </Excalidraw>
        </section>
      </div>

    </div>
    {mcpOpen && <McpSettings locale={locale} t={t} request={request} icon={name => <Icon name={name} />} onClose={() => {
      setMcpOpen(false);
      focusBoardMenu();
    }} />}
    <dialog ref={deleteDialog} className="share-dialog" aria-labelledby="delete-archive-heading"
      onCancel={event => { if (busy) event.preventDefault(); }}
      onClose={() => { setDeleteTarget(null); setDeleteError(''); }}>
      <h2 id="delete-archive-heading">{t('删除档案')}</h2>
      {deleteTarget && <>
        <p className="archive-delete-description">{t('删除「{name}」后，无法在白板中恢复，已有分享链接也会失效。', { name: displayName(deleteTarget.name) })}</p>
        {deleteTarget.id === boardId && latest.current !== baseline.current && <p>{t('此白板还有未保存的更改，删除后会一并丢弃。')}</p>}
      </>}
      {deleteError && <p className="dialog-error" role="alert">{t(deleteError)}</p>}
      <div className="dialog-actions">
        <button type="button" autoFocus disabled={busy} onClick={() => deleteDialog.current.close()}>{t('取消')}</button>
        <button type="button" className="danger-button" disabled={busy || !deleteTarget} onClick={deleteArchive}>
          {busy ? t('正在删除…') : t('确认删除')}
        </button>
      </div>
    </dialog>
    <dialog ref={newDialog} className="share-dialog" aria-labelledby="new-heading"
      onCancel={event => { if (busy) event.preventDefault(); }}
      onClose={() => { setError(''); focusBoardMenu(); }}>
      <h2 id="new-heading">{t('新建白板')}</h2>
      <p>{t('有内容或正在共享的白板会先保存到档案，然后打开空白画布。原分享链接仍可访问归档白板。')}</p>
      {error && <p className="dialog-error" role="alert">{t(error)}</p>}
      <div className="dialog-actions">
        <button type="button" autoFocus disabled={busy} onClick={() => newDialog.current.close()}>{t('取消')}</button>
        <button type="button" className="primary" disabled={busy} onClick={newBoard}>{busy ? t('正在新建…') : t('确认新建')}</button>
      </div>
    </dialog>
    <dialog ref={dialog} className="share-dialog" onCancel={event => { if (busy) event.preventDefault(); }}
      onClose={() => { setShareOpen(false); setError(''); focusBoardMenu(); }}
      aria-labelledby="share-heading">
      <div className="panel-heading">
        <h2 id="share-heading">{boardId ? t('分享白板') : t('分享当前白板')}</h2>
        <button className="icon-button" aria-label={t('关闭')} disabled={busy} onClick={() => setShareOpen(false)}><Icon name="close" /></button>
      </div>
      {!boardId && <p>{t('访客通过链接与你编辑同一张白板。新建白板后，原链接仍指向归档里的这张白板。')}</p>}
      <p className="sharing-policy">{session.mode === 'public' ? t('这是公开白板。撤销分享链接后，原白板地址仍可编辑。') : t('有编辑链接的人可以共同编辑。撤销链接会断开访客的连接。')}</p>
      {share ? <>
        <label className="share-field">{t('编辑链接')}
          <input readOnly aria-label={t('分享链接')} value={`${location.origin}/share/${share}`}
            onFocus={event => event.currentTarget.select()} />
        </label>
        <div className="dialog-actions">
          <button className="primary" disabled={busy} onClick={() => action(async () => {
            try {
              await navigator.clipboard.writeText(`${location.origin}/share/${share}`);
            } catch {
              throw new Error('无法写入剪贴板，请检查浏览器权限后重试。');
            }
            setShareMessage('链接已复制。');
          })}><Icon name="copy" />{t('复制链接')}</button>
          <button className="danger-button" disabled={busy} onClick={() => action(() => toggleShare(false))}>{busy ? t('处理中…') : t('撤销分享')}</button>
        </div>
      </> : <div className="dialog-actions">
        <button className="primary" disabled={busy} onClick={() => action(() => toggleShare(true))}>
          {busy ? t('正在创建…') : t('创建编辑链接')}
        </button>
      </div>}
      {shareMessage && <p className="dialog-feedback" role="status">{t(shareMessage)}</p>}
      {error && <p className="dialog-error" role="alert">{t(error)}</p>}
    </dialog>
  </main>;
}

const otherLocale = locale => locale === 'en' ? 'zh-CN' : 'en';

function LanguageButton({ locale, changeLocale }) {
  const next = otherLocale(locale);
  return <button type="button" lang={next} onClick={() => changeLocale(next)}>{localeNames[next]}</button>;
}

function App() {
  const [locale, setLocale] = useState(() => savedLocale(document.cookie) || preferredLocale(navigator.languages));
  const t = React.useMemo(() => translator(locale), [locale]);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = t('个人白板') + ' · Excalink';
  }, [locale, t]);
  function changeLocale(next) {
    document.cookie = `excalink_locale=${next}; Path=/; Max-Age=31536000; SameSite=Lax` +
      (location.protocol === 'https:' ? '; Secure' : '');
    setLocale(next);
  }
  const [initial, setInitial] = useState(null);
  const [session, setSession] = useState(null);
  const [error, setError] = useState(new URLSearchParams(location.search).get('login') === 'failed' ? '登录未完成，请重试或联系管理员。' : '');
  const [busy, setBusy] = useState(false);
  const signingIn = useRef(false);
  useEffect(() => {
    request('/auth/session').then(value => {
      if (mcpLogin && value.owner && value.mode !== 'public') {
        location.replace('/mcp/oauth/' + mcpLogin);
        return;
      }
      setSession(value);
      if (shareToken || value.owner) return request(endpoint).then(setInitial);
    }).catch(failure => setError(failure.message));
  }, []);
  if (initial) return <Workspace initial={initial} session={session} locale={locale} t={t} changeLocale={changeLocale} />;
  if (session && !session.owner && !shareToken) return <main className="login-page">
    <div className="login-intro">
      <Brand t={t} />
      <h1 id="login-heading">{mcpLogin ? t('登录以连接白板') : t('打开你的白板')}</h1>
      <p>{mcpLogin ? t('登录后确认客户端的访问权限。') : t('登录后打开你的白板和档案。')}</p>
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
      <div className="login-language"><LanguageButton locale={locale} changeLocale={changeLocale} /></div>
      {session.mode === 'oidc' ? <a className="primary sign-in-link" href={'/auth/oidc' + (mcpLogin ? '?mcp_login=' + mcpLogin : '')}>{t('使用身份服务登录')}</a> : <form onSubmit={async event => {
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
        <label>{t('用户名')}<input name="username" required autoComplete="username" /></label>
        <label>{t('密码')}<input name="password" type="password" required autoComplete="current-password" /></label>
        <button className="primary" disabled={busy}>{busy ? t('正在登录…') : t('登录')}</button>
      </form>}
      {error && <p role="alert">{t(error)}</p>}
  </section></main>;
  if (error) return <main className="problem standalone"><p role="alert">{t(error)}</p> <a href="/">{t('返回当前白板')}</a>
    <LanguageButton locale={locale} changeLocale={changeLocale} /></main>;
  return <main className="loading"><Brand t={t} /><p role="status">{t('正在载入白板')}</p></main>;
}

createRoot(document.getElementById('root')).render(<App />);
