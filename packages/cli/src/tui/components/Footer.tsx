import React from 'react';
import { Text } from 'ink';
import {
  FOOTER_BROWSE, FOOTER_SEARCH, FOOTER_PROFILE_SAVE, FOOTER_PROFILE_LOAD,
} from '../constants.js';

interface FooterProps {
  mode: 'browse' | 'search' | 'profile-save' | 'profile-load';
  editorHint?: boolean;
}

export function Footer({ mode, editorHint }: FooterProps) {
  if (editorHint) {
    return <Text dimColor>Set $EDITOR to open files</Text>;
  }
  const hints =
    mode === 'browse'       ? FOOTER_BROWSE :
    mode === 'search'       ? FOOTER_SEARCH :
    mode === 'profile-save' ? FOOTER_PROFILE_SAVE :
                              FOOTER_PROFILE_LOAD;
  return <Text dimColor>{hints}</Text>;
}
