import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { ProfileSavePrompt, ProfileLoadPrompt } from '../../src/tui/components/ProfilePrompt.js';

describe('ProfileSavePrompt', () => {
  it('shows the current name input', () => {
    const { lastFrame } = render(
      <ProfileSavePrompt nameInput="auth" isOverwrite={false} onConfirm={vi.fn()} onCancel={vi.fn()} />
    );
    expect(lastFrame()).toContain('auth');
  });

  it('shows overwrite confirmation when isOverwrite is true', () => {
    const { lastFrame } = render(
      <ProfileSavePrompt nameInput="auth" isOverwrite={true} onConfirm={vi.fn()} onCancel={vi.fn()} />
    );
    expect(lastFrame()).toContain('Overwrite');
  });
});

describe('ProfileLoadPrompt', () => {
  it('shows a list of profile names', () => {
    const profiles = [{ name: 'auth', files: [] }, { name: 'api', files: [] }];
    const { lastFrame } = render(
      <ProfileLoadPrompt profiles={profiles} cursor={0} onConfirm={vi.fn()} onCancel={vi.fn()} />
    );
    expect(lastFrame()).toContain('auth');
    expect(lastFrame()).toContain('api');
  });

  it('shows "No profiles saved" when list is empty', () => {
    const { lastFrame } = render(
      <ProfileLoadPrompt profiles={[]} cursor={0} onConfirm={vi.fn()} onCancel={vi.fn()} />
    );
    expect(lastFrame()).toContain('No profiles');
  });
});
