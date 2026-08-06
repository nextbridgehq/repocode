import React, { useState, useMemo, useLayoutEffect } from 'react';
import { Box, Text, useApp, useStdin } from 'ink';
import { spawnSync } from 'child_process';
import type { TUIPipelineResult } from '@repocode/core';
import { useFileList } from './hooks/useFileList.js';
import { listProfiles, loadProfile, saveProfile, profileExists } from './hooks/useProfiles.js';
import { StatusBar } from './components/StatusBar.js';
import { FileList } from './components/FileList.js';
import { SearchBar } from './components/SearchBar.js';
import { Footer } from './components/Footer.js';
import { ProfileSavePrompt, ProfileLoadPrompt } from './components/ProfilePrompt.js';
import { createStdinDecoder } from './stdinDecoder.js';

type Mode = 'browse' | 'search' | 'profile-save' | 'profile-load';

interface AppProps {
  tuiResult: TUIPipelineResult;
  budget: number | null;
  root: string;
  initialSelected?: Set<string>;
  initialProfileName?: string;
  gitStatuses: Map<string, 'M' | 'A' | 'D' | '?'>;
  onPack: (selected: Set<string>) => void;
  onQuit: () => void;
}

const CHROME_ROWS = 4; // StatusBar + divider + footer + padding

/** Minimal key descriptor — same shape as ink's Key */
interface Key {
  upArrow: boolean;
  downArrow: boolean;
  escape: boolean;
  return: boolean;
  backspace: boolean;
  delete: boolean;
  ctrl: boolean;
  shift: boolean;
  tab: boolean;
  leftArrow: boolean;
  rightArrow: boolean;
  pageDown: boolean;
  pageUp: boolean;
  meta: boolean;
}

/** Parse raw byte string into (input, Key) matching ink's useInput semantics */
function parseInput(raw: string): [string, Key] {
  const key: Key = {
    upArrow: false, downArrow: false, escape: false, return: false,
    backspace: false, delete: false, ctrl: false, shift: false,
    tab: false, leftArrow: false, rightArrow: false, pageDown: false,
    pageUp: false, meta: false,
  };

  if (raw === '\r' || raw === '\n')           { key.return = true;    return ['', key]; }
  if (raw === '\x1b' || raw === '\x1b\x1b')  { key.escape = true;    return ['', key]; }
  if (raw === '\t')                           { key.tab = true;       return ['', key]; }
  if (raw === '\x7f' || raw === '\x1b\x7f')  { key.backspace = true; return ['', key]; }
  if (raw === '\b' || raw === '\x1b\b')       { key.backspace = true; return ['', key]; }
  if (raw === '\x1b[A' || raw === '\x1bOA')  { key.upArrow = true;   return ['', key]; }
  if (raw === '\x1b[B' || raw === '\x1bOB')  { key.downArrow = true; return ['', key]; }
  if (raw === '\x1b[C' || raw === '\x1bOC')  { key.rightArrow = true; return ['', key]; }
  if (raw === '\x1b[D' || raw === '\x1bOD')  { key.leftArrow = true; return ['', key]; }
  if (raw === '\x1b[3~')                     { key.delete = true;    return ['', key]; }
  if (raw === '\x1b[5~')                     { key.pageUp = true;    return ['', key]; }
  if (raw === '\x1b[6~')                     { key.pageDown = true;  return ['', key]; }

  // Ctrl+letter
  if (raw.length === 1 && raw <= '\x1a') {
    key.ctrl = true;
    const letter = String.fromCharCode(raw.charCodeAt(0) + 'a'.charCodeAt(0) - 1);
    return [letter, key];
  }

  // Printable / space / letters
  return [raw, key];
}

export function App({
  tuiResult, budget, root, initialSelected, initialProfileName,
  gitStatuses, onPack, onQuit,
}: AppProps) {
  const { exit } = useApp();
  const { stdin, setRawMode } = useStdin();

  const [mode, setMode]             = useState<Mode>('browse');
  const [filter, setFilter]         = useState('');
  const [profileInput, setProfileInput] = useState('');
  const [profileCursor, setProfileCursor] = useState(0);
  const [isOverwrite, setIsOverwrite]   = useState(false);
  const [editorHint, setEditorHint]     = useState(false);
  const [profileName, setProfileName]   = useState<string | null>(initialProfileName ?? null);

  const decodeStdin = useMemo(() => createStdinDecoder(), []);

  const {
    filteredFiles, cursor, depFiles, selected, sortBy,
    moveCursor, toggleCursor, selectAllVisible, deselectAll,
    addDepsOfCursor, cycleSortBy, setSelected,
  } = useFileList(tuiResult.files, tuiResult.imports, filter);

  // Apply initialSelected on mount only — useLayoutEffect so it fires synchronously
  // before any stdin events can arrive (important for test predictability)
  React.useLayoutEffect(() => {
    if (initialSelected && initialSelected.size > 0) setSelected(initialSelected);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedTokens = useMemo(
    () => tuiResult.files.filter(f => selected.has(f.path)).reduce((s, f) => s + f.tokens, 0),
    [tuiResult.files, selected],
  );

  const profiles = useMemo(() => listProfiles(root), [root]);

  const cols = process.stdout.columns || 120;
  const rows = process.stdout.rows    || 40;
  const visibleRows = Math.max(1, rows - CHROME_ROWS);

  // Use useLayoutEffect so keyboard listener is set up synchronously after each commit.
  // This ensures stdin.write() in tests triggers the handler immediately.
  useLayoutEffect(() => {
    setRawMode(true);
    return () => { setRawMode(false); };
  }, [setRawMode]);

  // No dep array: re-register every render so handler always closes over fresh state.
  // useLayoutEffect (not useEffect) to fire synchronously before stdin events in tests.
  useLayoutEffect(() => {
    const handleData = (data: unknown) => {
      const raw = decodeStdin(data);
      const [input, key] = parseInput(raw);

      // Clear editor hint on any keypress
      if (editorHint) setEditorHint(false);

      if (mode === 'search') {
        if (key.escape) { setFilter(''); setMode('browse'); return; }
        if (key.return) { setMode('browse'); return; }
        if (key.backspace || key.delete) { setFilter(f => f.slice(0, -1)); return; }
        if (input && !key.ctrl) { setFilter(f => f + input); return; }
        return;
      }

      if (mode === 'profile-save') {
        if (key.escape) { setProfileInput(''); setIsOverwrite(false); setMode('browse'); return; }
        if (key.return) {
          if (!isOverwrite && profileExists(root, profileInput)) {
            setIsOverwrite(true); return;
          }
          if (isOverwrite && input !== 'y') { setProfileInput(''); setIsOverwrite(false); setMode('browse'); return; }
          saveProfile(root, profileInput, selected);
          setProfileName(profileInput);
          setProfileInput(''); setIsOverwrite(false); setMode('browse');
          return;
        }
        if (!isOverwrite) {
          if (key.backspace || key.delete) { setProfileInput(p => p.slice(0, -1)); return; }
          if (input && !key.ctrl) { setProfileInput(p => p + input); return; }
        }
        if (isOverwrite && (input === 'y' || input === 'n')) {
          if (input === 'y') {
            saveProfile(root, profileInput, selected);
            setProfileName(profileInput);
          }
          setProfileInput(''); setIsOverwrite(false); setMode('browse');
        }
        return;
      }

      if (mode === 'profile-load') {
        if (key.escape) { setMode('browse'); return; }
        if (key.upArrow   || input === 'k') { setProfileCursor(c => Math.max(0, c - 1)); return; }
        if (key.downArrow || input === 'j') { setProfileCursor(c => Math.min(profiles.length - 1, c + 1)); return; }
        if (key.return && profiles[profileCursor]) {
          const loaded = loadProfile(root, profiles[profileCursor].name, tuiResult.files);
          setSelected(loaded);
          setProfileName(profiles[profileCursor].name);
          setMode('browse');
        }
        return;
      }

      // browse mode
      if (key.upArrow   || input === 'k') { moveCursor(-1); return; }
      if (key.downArrow || input === 'j') { moveCursor(1);  return; }
      if (input === ' ')  { toggleCursor();      return; }
      if (input === 'd')  { addDepsOfCursor();   return; }
      if (input === 'a')  { selectAllVisible();  return; }
      if (input === 'n')  { deselectAll();       return; }
      if (input === '/')  { setMode('search');   return; }
      if (input === 'r')  { cycleSortBy();       return; }
      if (input === 's')  { setProfileInput(''); setIsOverwrite(false); setMode('profile-save'); return; }
      if (input === 'l')  { setProfileCursor(0); setMode('profile-load'); return; }
      if (input === 'o')  {
        const editor = process.env.EDITOR || process.env.VISUAL;
        if (!editor) { setEditorHint(true); return; }
        const file = filteredFiles[cursor];
        if (file) {
          spawnSync(editor, [file.absolutePath], { stdio: 'inherit' });
        }
        return;
      }
      if (key.return) { exit(); onPack(selected); return; }
      if (input === 'q' || (key.ctrl && input === 'c')) { exit(); onQuit(); return; }
    };

    stdin.on('data', handleData);
    return () => { stdin.off('data', handleData); };
  });

  return (
    <Box flexDirection="column" width={cols}>
      <StatusBar
        selectedCount={selected.size}
        totalCount={tuiResult.files.length}
        selectedTokens={selectedTokens}
        maxTokens={budget}
        profileName={profileName}
        sortBy={sortBy}
      />
      <Text dimColor>{'─'.repeat(cols)}</Text>

      {mode === 'search' && <SearchBar filter={filter} />}
      {mode === 'profile-save' && (
        <ProfileSavePrompt
          nameInput={profileInput}
          isOverwrite={isOverwrite}
          onConfirm={() => {}}
          onCancel={() => {}}
        />
      )}
      {mode === 'profile-load' && (
        <ProfileLoadPrompt
          profiles={profiles}
          cursor={profileCursor}
          onConfirm={() => {}}
          onCancel={() => {}}
        />
      )}

      <FileList
        files={filteredFiles}
        cursor={cursor}
        selected={selected}
        depFiles={depFiles}
        gitStatuses={gitStatuses}
        visibleRows={visibleRows}
        cols={cols}
      />

      <Text dimColor>{'─'.repeat(cols)}</Text>
      <Footer mode={mode} editorHint={editorHint} />
    </Box>
  );
}
