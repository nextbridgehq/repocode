import React from 'react';
import { Text, Box } from 'ink';
import type { Profile } from '../hooks/useProfiles.js';

interface ProfileSavePromptProps {
  nameInput: string;
  isOverwrite: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ProfileSavePrompt({ nameInput, isOverwrite }: ProfileSavePromptProps) {
  if (isOverwrite) {
    return (
      <Box flexDirection="column">
        <Text>Profile <Text bold>"{nameInput}"</Text> exists. Overwrite? (y/n)</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column">
      <Text>Save profile as: {nameInput}<Text dimColor>█</Text></Text>
    </Box>
  );
}

interface ProfileLoadPromptProps {
  profiles: Profile[];
  cursor: number;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

export function ProfileLoadPrompt({ profiles, cursor }: ProfileLoadPromptProps) {
  if (profiles.length === 0) {
    return <Text dimColor>No profiles saved. Press s to save the current selection.</Text>;
  }
  return (
    <Box flexDirection="column">
      <Text>Load profile:</Text>
      {profiles.map((p, i) => (
        <Text key={p.name}>
          {i === cursor ? '▶ ' : '  '}
          {p.name}
          <Text dimColor> ({p.files.length} files)</Text>
        </Text>
      ))}
    </Box>
  );
}
