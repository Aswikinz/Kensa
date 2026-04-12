// Viewing <-> Editing transitions. Thin wrapper that owns the policy for when
// a mode switch is allowed: viewing requires a file source (variables are
// always editing), editing requires Python to be available.

import * as vscode from 'vscode';
import type { DataRouter } from './dataRouter';
import type { EditorMode } from '../shared/types';

export class ModeManager {
  constructor(private readonly router: DataRouter) {}

  async switchTo(mode: EditorMode): Promise<EditorMode> {
    if (mode === 'editing') {
      try {
        await this.router.switchMode('editing');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Kensa: could not switch to Editing mode — ${msg}`);
        return 'viewing';
      }
    } else {
      await this.router.switchMode('viewing');
    }
    return this.router.currentMode;
  }

  get current(): EditorMode {
    return this.router.currentMode;
  }
}
