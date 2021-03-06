/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import InstallationManager from './installer/manager';
import PIOTasksProvider from './tasks';
import PIOTerminal from './terminal';
import ProjectIndexer from './project/indexer';
import initCommand from './commands/init';
import { updateOSEnviron } from './maintenance';
import vscode from 'vscode';


class PlatformIOVSCodeExtension {

  constructor() {
    this._context = null;
    this._isMonitorRun = false;
    this.pioTerm = new PIOTerminal();
  }

  async activate(context) {
    this._context = context;

    updateOSEnviron();
    this.registerCommands();

    await this.startInstaller();

    if (!vscode.workspace.rootPath) {
      return;
    }

    this.initTasksProvider();
    this.initStatusBar();
    this.initProjectIndexer();
  }

  startInstaller() {
    return vscode.window.withProgress({
      location: vscode.ProgressLocation.Window,
      title: 'PlatformIO',
    }, async (progress) => {
      progress.report({
        message: 'Verifying PlatformIO Core installation...',
      });

      const im = new InstallationManager(this._context.globalState);
      if (im.locked()) {
        vscode.window.showInformationMessage(
          'PlatformIO IDE installation has been suspended, because PlatformIO '
          + 'IDE Installer is already started in another window.');
      } else if (await im.check()) {
        return;
      } else {
        progress.report({
          message: 'Installing PlatformIO IDE...',
        });
        const outputChannel = vscode.window.createOutputChannel('PlatformIO Instalation');
        outputChannel.show();

        outputChannel.appendLine('Installing PlatformIO Core...');
        outputChannel.appendLine('Please don\'t close this window and don\'t '
          + 'open other folders until this process is completed.');

        try {
          im.lock();
          await im.install();
          outputChannel.appendLine('PlatformIO IDE installed successfully.');
        } catch (err) {
          vscode.window.showErrorMessage(err.toString(), {
            modal: true,
          });
          outputChannel.appendLine('Failed to install PlatformIO IDE.');
        } finally {
          im.unlock();
        }
      }
      im.destroy();
      return Promise.reject(null);
    });
  }

  registerCommands() {
    this._context.subscriptions.push(vscode.commands.registerCommand(
      'platformio-ide.initProject',
      initCommand
    ));
    this._context.subscriptions.push(vscode.commands.registerCommand(
      'platformio-ide.build',
      async () => {
        await this.terminateMonitorTask();
        vscode.commands.executeCommand('workbench.action.tasks.runTask', 'PlatformIO: Build');
      }
    ));
    this._context.subscriptions.push(vscode.commands.registerCommand(
      'platformio-ide.upload',
      async () => {
        await this.terminateMonitorTask();

        let task = 'PlatformIO: Upload';
        const config = vscode.workspace.getConfiguration('platformio-ide');
        if(config.get('forceUploadAndMonitor')) {
          task = 'PlatformIO: Upload and Monitor';
          this._isMonitorRun = true;
        }
        vscode.commands.executeCommand('workbench.action.tasks.runTask', task);
      }
    ));
    this._context.subscriptions.push(vscode.commands.registerCommand(
      'platformio-ide.clean',
      async () => {
        await this.terminateMonitorTask();
        vscode.commands.executeCommand('workbench.action.tasks.runTask', 'PlatformIO: Clean');
      }
    ));
    this._context.subscriptions.push(vscode.commands.registerCommand(
      'platformio-ide.serialMonitor',
      async () => {
        await this.terminateMonitorTask();
        this._isMonitorRun = true;
        vscode.commands.executeCommand('workbench.action.tasks.runTask', 'PlatformIO: Monitor');
      }
    ));
    this._context.subscriptions.push(vscode.commands.registerCommand(
      'platformio-ide.libraryManager',
      () => this.pioTerm.sendText('pio lib')
    ));
    this._context.subscriptions.push(vscode.commands.registerCommand(
      'platformio-ide.newTerminal',
      () => this.pioTerm.new().show()
    ));
    this._context.subscriptions.push(vscode.commands.registerCommand(
      'platformio-ide.updateCore',
      () => this.pioTerm.sendText('pio update')
    ));
    this._context.subscriptions.push(vscode.commands.registerCommand(
      'platformio-ide.upgradeCore',
      () => this.pioTerm.sendText('pio upgrade')
    ));
  }

  async terminateMonitorTask() {
    if (!this._isMonitorRun) {
      return;
    }
    try {
      await vscode.commands.executeCommand('workbench.action.tasks.terminate');
    } catch(err) {
      console.error(err);
    }
    this._isMonitorRun = false;
    return new Promise(resolve => setTimeout(() => resolve(), 500));
  }

  initTasksProvider() {
    this._context.subscriptions.push(new PIOTasksProvider(vscode.workspace.rootPath));
  }

  initStatusBar() {
    const items = [
      ['$(check)', 'PlatformIO: Build', 'platformio-ide.build'],
      ['$(arrow-right)', 'PlatformIO: Upload', 'platformio-ide.upload'],
      ['$(trashcan)', 'PlatformIO: Clean', 'platformio-ide.clean'],
      ['$(checklist)', 'PlatformIO: Run a Task', 'workbench.action.tasks.runTask'],
      ['$(file-code)', 'PlatformIO: Initialize or update project', 'platformio-ide.initProject'],
      ['$(code)', 'PlatformIO: Library Manager', 'platformio-ide.libraryManager'],
      ['$(plug)', 'PlatformIO: Serial Monitor', 'platformio-ide.serialMonitor'],
      ['$(terminal)', 'PlatformIO: New Terminal', 'platformio-ide.newTerminal']
    ];
    items.reverse().forEach((item, index) => {
      const [text, tooltip, command] = item;
      const sbItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10 + index);
      sbItem.text = text;
      sbItem.tooltip = tooltip;
      sbItem.command = command;
      sbItem.show();
      this._context.subscriptions.push(sbItem);
    });
  }

  initProjectIndexer() {
    const indexer = new ProjectIndexer(vscode.workspace.rootPath);
    this._context.subscriptions.push(indexer);
    this._context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(() => indexer.toggle()));
    indexer.toggle();
    this._context.subscriptions.push(vscode.commands.registerCommand(
      'platformio-ide.rebuildProjectIndex',
      () => indexer.doRebuild({ verbose: true })
    ));
  }

  deactivate() {
    this.pioTerm.dispose();
  }
}

const pio = new PlatformIOVSCodeExtension();

export function activate(context) {
  pio.activate(context);
}

export function deactivate() {
  pio.deactivate();
}
