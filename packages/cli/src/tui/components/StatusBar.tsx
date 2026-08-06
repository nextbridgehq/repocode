import React from 'react';
import { Text } from 'ink';
import { Colors } from '../constants.js';

interface StatusBarProps {
  selectedCount: number;
  totalCount: number;
  selectedTokens: number;
  maxTokens: number | null;
  profileName: string | null;
  sortBy: string;
}

export function StatusBar({ selectedCount, totalCount, selectedTokens, maxTokens, profileName, sortBy }: StatusBarProps) {
  const sel = `${selectedCount}/${totalCount} selected`;

  let tokenPart: string;
  if (maxTokens === null) {
    tokenPart = `${selectedTokens.toLocaleString()} tokens │ no budget`;
  } else {
    const over = selectedTokens > maxTokens;
    const tokenStr = `${selectedTokens.toLocaleString()} / ${maxTokens.toLocaleString()} tokens`;
    tokenPart = over ? Colors.amber(tokenStr + ' ⚠') : tokenStr;
  }

  const profilePart = profileName ? ` │ profile: ${profileName}` : '';
  const sortPart = ` │ sort: ${sortBy}`;

  return <Text>{sel} │ {tokenPart}{sortPart}{profilePart}</Text>;
}
