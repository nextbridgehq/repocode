import React from 'react';
import { Text } from 'ink';

interface SearchBarProps {
  filter: string;
}

export function SearchBar({ filter }: SearchBarProps) {
  return <Text>{'/ '}{filter}<Text dimColor>{'█'}</Text></Text>;
}
