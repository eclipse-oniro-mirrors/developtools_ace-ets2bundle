/*
 * Copyright (c) 2021 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as ts from 'typescript';
import Stats from 'webpack/lib/Stats';
import Compiler from 'webpack/lib/Compiler';
import Compilation from 'webpack/lib/Compilation';
import JavascriptModulesPlugin from 'webpack/lib/javascript/JavascriptModulesPlugin';
import {
  configure,
  getLogger
} from 'log4js';
import path from 'path';
import fs from 'fs';
import CachedSource from 'webpack-sources/lib/CachedSource';
import ConcatSource from 'webpack-sources/lib/ConcatSource';

import { transformLog } from './process_ui_syntax';
import {
  useOSFiles,
  sourcemapNamesCollection
} from './validate_ui_syntax';
import {
  circularFile,
  mkDir,
} from './utils';
import {
  MODULE_ETS_PATH,
  MODULE_SHARE_PATH,
  BUILD_SHARE_PATH,
} from './pre_define';
import {
  createLanguageService,
  createWatchCompilerHost
} from './ets_checker';
import {
  globalProgram,
  projectConfig
} from '../main';
import cluster from 'cluster';

configure({
  appenders: { 'ETS': {type: 'stderr', layout: {type: 'messagePassThrough'}}},
  categories: {'default': {appenders: ['ETS'], level: 'info'}}
});
export const logger = getLogger('ETS');

export const props: string[] = [];

interface Info {
  message?: string;
  issue?: {
    message: string,
    file: string,
    location: { start?: { line: number, column: number } }
  };
}

export interface CacheFileName {
  mtimeMs: number,
  children: string[],
  error: boolean
}

interface NeedUpdateFlag {
  flag: boolean;
}

export let cache: Cache;
type Cache = Record<string, CacheFileName>;

export class ResultStates {
  private mStats: Stats;
  private mErrorCount: number = 0;
  private mWarningCount: number = 0;
  private warningCount: number = 0;
  private noteCount: number = 0;
  private red: string = '\u001b[31m';
  private yellow: string = '\u001b[33m';
  private blue: string = '\u001b[34m';
  private reset: string = '\u001b[39m';
  private moduleSharePaths: Set<string> = new Set([]);

  public apply(compiler: Compiler): void {
    compiler.hooks.compilation.tap('SourcemapFixer', compilation => {
      compilation.hooks.afterProcessAssets.tap('SourcemapFixer', assets => {
        Reflect.ownKeys(assets).forEach(key => {
          if (/\.map$/.test(key.toString()) && assets[key]._value) {
            assets[key]._value = assets[key]._value.toString().replace('.ets?entry', '.ets');
            assets[key]._value = assets[key]._value.toString().replace('.ts?entry', '.ts');

            let absPath: string = path.resolve(projectConfig.projectPath, key.toString().replace('.js.map','.js'));
            if (sourcemapNamesCollection && absPath) {
              let map: Map<string, string> = sourcemapNamesCollection.get(absPath);
              if (map && map.size != 0) {
                let names: Array<string> = Array.from(map).flat();
                let sourcemapObj: any = JSON.parse(assets[key]._value);
                sourcemapObj.nameMap = names;
                assets[key]._value = JSON.stringify(sourcemapObj);
              }
            }
          }
        });
      }
      );

      compilation.hooks.buildModule.tap('findModule', (module) => {
        if (module.context) {
          if (module.context.indexOf(projectConfig.projectPath) >= 0) {
            return;
          }
          const modulePath: string = path.join(module.context);
          const srcIndex: number = modulePath.lastIndexOf(MODULE_ETS_PATH);
          if (srcIndex < 0) {
            return;
          }
          const moduleSharePath: string = path.resolve(modulePath.substring(0, srcIndex), MODULE_SHARE_PATH);
          if (fs.existsSync(moduleSharePath)) {
            this.moduleSharePaths.add(moduleSharePath);
          }
        }
      });
    });

    compiler.hooks.afterCompile.tap('copyFindModule', () => {
      this.moduleSharePaths.forEach(modulePath => {
        circularFile(modulePath, path.resolve(projectConfig.buildPath, BUILD_SHARE_PATH));
      });
    });

    compiler.hooks.compilation.tap('CommonAsset', compilation => {
      compilation.hooks.processAssets.tap(
        {
          name: 'GLOBAL_COMMON_MODULE_CACHE',
          stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
        },
        (assets) => {
          const GLOBAL_COMMON_MODULE_CACHE = `
          globalThis["__common_module_cache__${projectConfig.hashProjectPath}"] =` +
          ` globalThis["__common_module_cache__${projectConfig.hashProjectPath}"] || {};`;
          if (assets['commons.js']) {
            assets['commons.js'] = new CachedSource(
              new ConcatSource(assets['commons.js'], GLOBAL_COMMON_MODULE_CACHE));
          } else if (assets['vendors.js']) {
            assets['vendors.js'] = new CachedSource(
              new ConcatSource(assets['vendors.js'], GLOBAL_COMMON_MODULE_CACHE));
          }
        });
    });

    compiler.hooks.compilation.tap('Require', compilation => {
      JavascriptModulesPlugin.getCompilationHooks(compilation).renderRequire.tap('renderRequire',
        (source) => {
          return `var commonCachedModule = globalThis` +
          `["__common_module_cache__${projectConfig.hashProjectPath}"] ? ` +
            `globalThis["__common_module_cache__${projectConfig.hashProjectPath}"]` +
            `[moduleId]: null;\n` +
            `if (commonCachedModule) { return commonCachedModule.exports; }\n` +
            source.replace('// Execute the module function',
              `function isCommonModue(moduleId) {
                if (globalThis["webpackChunk${projectConfig.hashProjectPath}"]) {
                  const length = globalThis["webpackChunk${projectConfig.hashProjectPath}"].length;
                  switch (length) {
                    case 1:
                      return globalThis["webpackChunk${projectConfig.hashProjectPath}"][0][1][moduleId];
                    case 2:
                      return globalThis["webpackChunk${projectConfig.hashProjectPath}"][0][1][moduleId] ||
                      globalThis["webpackChunk${projectConfig.hashProjectPath}"][1][1][moduleId];
                  }
                }
                return undefined;
              }\n` +
              `if (globalThis["__common_module_cache__${projectConfig.hashProjectPath}"]` +
              ` && String(moduleId).indexOf("?name=") < 0 && isCommonModue(moduleId)) {\n` +
              `  globalThis["__common_module_cache__${projectConfig.hashProjectPath}"]` +
              `[moduleId] = module;\n}`);
        });
    });

    compiler.hooks.entryOption.tap('beforeRun', () => {
      const rootFileNames: string[] = [];
      Object.values(projectConfig.entryObj).forEach((fileName: string) => {
        rootFileNames.push(fileName.replace('?entry', ''));
      });
      if (process.env.watchMode === 'true') {
        globalProgram.watchProgram = ts.createWatchProgram(
          createWatchCompilerHost(rootFileNames, this.printDiagnostic.bind(this),
            this.delayPrintLogCount.bind(this)));
      } else {
        let languageService: ts.LanguageService = null;
        let cacheFile: string = null;
        if (projectConfig.xtsMode) {
          languageService = createLanguageService(rootFileNames);
        } else {
          cacheFile = path.resolve(projectConfig.cachePath, '../.ts_checker_cache');
          cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile).toString()) : {};
          const filterFiles: string[] = filterInput(rootFileNames);
          languageService = createLanguageService(filterFiles);
        }
        globalProgram.program = languageService.getProgram();
        const allDiagnostics: ts.Diagnostic[] = globalProgram.program
          .getSyntacticDiagnostics()
          .concat(globalProgram.program.getSemanticDiagnostics())
          .concat(globalProgram.program.getDeclarationDiagnostics());
        allDiagnostics.forEach((diagnostic: ts.Diagnostic) => {
          this.printDiagnostic(diagnostic);
        });
        if (process.env.watchMode !== 'true' && !projectConfig.xtsMode) {
          fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2));
        }
      }
    });

    compiler.hooks.done.tap('Result States', (stats: Stats) => {
      if (projectConfig.isPreview && projectConfig.aceSoPath &&
        useOSFiles && useOSFiles.size > 0) {
        this.writeUseOSFiles();
      }
      this.mStats = stats;
      this.warningCount = 0;
      this.noteCount = 0;
      if (this.mStats.compilation.errors) {
        this.mErrorCount += this.mStats.compilation.errors.length;
      }
      if (this.mStats.compilation.warnings) {
        this.mWarningCount = this.mStats.compilation.warnings.length;
      }
      this.printResult();
    });

    compiler.hooks.watchRun.tap('Listening State', (compiler: Compiler) => {
      if (compiler.modifiedFiles) {
        const isTsAndEtsFile: boolean = [...compiler.modifiedFiles].some((item: string) => {
          return /.(ts|ets)$/.test(item);
        });
        if (!isTsAndEtsFile) {
          process.env.watchTs = 'end';
        }
      }
    });
  }

  private printDiagnostic(diagnostic: ts.Diagnostic): void {
    const message: string = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
    if (this.validateError(message)) {
      if (process.env.watchMode !== 'true' && !projectConfig.xtsMode) {
        updateErrorFileCache(diagnostic);
      }
      this.mErrorCount += 1;
      if (diagnostic.file) {
        const { line, character }: ts.LineAndCharacter =
          diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start!);
        logger.error(this.red,
          `ETS:ERROR File: ${diagnostic.file.fileName}:${line + 1}:${character + 1}\n ${message}\n`);
      } else {
        logger.error(this.red, `ETS:ERROR: ${message}`);
      }
    }
  }

  private writeUseOSFiles(): void {
    let info: string = '';
    if (!fs.existsSync(projectConfig.aceSoPath)) {
      const parent: string = path.join(projectConfig.aceSoPath, '..');
      if (!(fs.existsSync(parent) && !fs.statSync(parent).isFile())) {
        mkDir(parent);
      }
    } else {
      info = fs.readFileSync(projectConfig.aceSoPath, 'utf-8') + '\n';
    }
    fs.writeFileSync(projectConfig.aceSoPath, info + Array.from(useOSFiles).join('\n'));
  }

  private printResult(): void {
    this.printWarning();
    this.printError();
    if (process.env.watchMode === 'true') {
      process.env.watchEts = 'end';
      this.delayPrintLogCount();
    } else {
      this.printLogCount();
    }
  }

  private delayPrintLogCount() {
    if (process.env.watchEts === 'end' && process.env.watchTs === 'end') {
      this.printLogCount();
      process.env.watchEts = 'start';
      process.env.watchTs = 'start';
    }
  }

  private printLogCount(): void {
    if (this.mErrorCount + this.warningCount + this.noteCount > 0) {
      let result: string;
      let resultInfo: string = '';
      if (this.mErrorCount > 0) {
        resultInfo += `ERROR:${this.mErrorCount}`;
        result = 'FAIL ';
        process.exitCode = 1;
      } else {
        result = 'SUCCESS ';
      }
      if (this.warningCount > 0) {
        resultInfo += ` WARN:${this.warningCount}`;
      }
      if (this.noteCount > 0) {
        resultInfo += ` NOTE:${this.noteCount}`;
      }
      if (result === 'SUCCESS ' && projectConfig.isPreview) {
        this.printPreviewResult(resultInfo);
      } else {
        logger.info(this.blue, 'COMPILE RESULT:' + result + `{${resultInfo}}`, this.reset);
      }
    } else {
      if (projectConfig.isPreview) {
        this.printPreviewResult();
      } else {
        console.info(this.blue, 'COMPILE RESULT:SUCCESS ', this.reset);
      }
    }
    this.clearCount();
  }

  private clearCount(): void {
    this.mErrorCount = 0;
    this.warningCount = 0;
    this.noteCount = 0;
  }

  private printPreviewResult(resultInfo: string = ''): void {
    const workerNum: number = Object.keys(cluster.workers).length;
    const printSuccessInfo = this.printSuccessInfo;
    const blue: string = this.blue;
    const reset: string = this.reset;
    if (workerNum === 0) {
      printSuccessInfo(blue, reset, resultInfo);
    }
  }

  private printSuccessInfo(blue: string, reset: string, resultInfo: string): void {
    if (resultInfo.length === 0) {
      console.info(blue, 'COMPILE RESULT:SUCCESS ', reset);
    } else {
      console.info(blue, 'COMPILE RESULT:SUCCESS ' + `{${resultInfo}}`, reset);
    }
  }

  private printWarning(): void {
    if (this.mWarningCount > 0) {
      const warnings: Info[] = this.mStats.compilation.warnings;
      const length: number = warnings.length;
      for (let index = 0; index < length; index++) {
        const message: string = warnings[index].message.replace(/^Module Warning\s*.*:\n/, '')
          .replace(/\(Emitted value instead of an instance of Error\) BUILD/, '');
        if (/^NOTE/.test(message)) {
          this.noteCount++;
          logger.info(this.blue, message, this.reset, '\n');
        } else {
          this.warningCount++;
          logger.warn(this.yellow, message.replace(/^WARN/, 'ETS:WARN'), this.reset, '\n');
        }
      }
      if (this.mWarningCount > length) {
        this.warningCount = this.warningCount + this.mWarningCount - length;
      }
    }
  }

  private printError(): void {
    if (this.mErrorCount > 0) {
      const errors: Info[] = [...this.mStats.compilation.errors];
      for (let index = 0; index < errors.length; index++) {
        if (errors[index].issue) {
          const position: string = errors[index].issue.location
            ? `:${errors[index].issue.location.start.line}:${errors[index].issue.location.start.column}`
            : '';
          const location: string = errors[index].issue.file.replace(/\\/g, '/') + position;
          const detail: string = errors[index].issue.message;
          logger.error(this.red, 'ETS:ERROR File: ' + location, this.reset);
          logger.error(this.red, detail, this.reset, '\n');
        } else if (/BUILDERROR/.test(errors[index].message)) {
          const errorMessage: string = errors[index].message.replace(/^Module Error\s*.*:\n/, '')
            .replace(/\(Emitted value instead of an instance of Error\) BUILD/, '')
            .replace(/^ERROR/, 'ETS:ERROR');
          this.printErrorMessage(errorMessage, true, errors[index]);
        } else if (!/TS[0-9]+:/.test(errors[index].message.toString())) {
          let errorMessage: string = `${errors[index].message.replace(/\[tsl\]\s*/, '')
            .replace(/\u001b\[.*?m/g, '').replace(/\.ets\.ts/g, '.ets').trim()}\n`;
          errorMessage = this.filterModuleError(errorMessage)
            .replace(/^ERROR in /, 'ETS:ERROR File: ').replace(/\s{6}TS/g, ' TS')
            .replace(/\(([0-9]+),([0-9]+)\)/, ':$1:$2');
          this.printErrorMessage(errorMessage, false, errors[index]);
        }
      }
    }
  }
  private printErrorMessage(errorMessage: string, lineFeed: boolean, errorInfo: Info): void {
    if (this.validateError(errorMessage)) {
      const formatErrMsg = errorMessage.replace(/\\/g, '/');
      if (lineFeed) {
        logger.error(this.red, formatErrMsg + '\n', this.reset);
      } else {
        logger.error(this.red, formatErrMsg, this.reset);
      }
    } else {
      const errorsIndex = this.mStats.compilation.errors.indexOf(errorInfo);
      this.mStats.compilation.errors.splice(errorsIndex, 1);
      this.mErrorCount = this.mErrorCount - 1;
    }
  }
  private validateError(message: string): boolean {
    const propInfoReg: RegExp = /Cannot find name\s*'(\$?\$?[_a-zA-Z0-9]+)'/;
    const stateInfoReg: RegExp = /Property\s*'(\$?[_a-zA-Z0-9]+)' does not exist on type/;
    if (this.matchMessage(message, props, propInfoReg) ||
      this.matchMessage(message, props, stateInfoReg)) {
      return false;
    }
    return true;
  }
  private matchMessage(message: string, nameArr: any, reg: RegExp): boolean {
    if (reg.test(message)) {
      const match: string[] = message.match(reg);
      if (match[1] && nameArr.includes(match[1])) {
        return true;
      }
    }
    return false;
  }
  private filterModuleError(message: string): string {
    if (/You may need an additional loader/.test(message) && transformLog && transformLog.sourceFile) {
      const fileName: string = transformLog.sourceFile.fileName;
      const errorInfos: string[] = message.split('You may need an additional loader to handle the result of these loaders.');
      if (errorInfos && errorInfos.length > 1 && errorInfos[1]) {
        message = `ERROR in ${fileName}\n The following syntax is incorrect.${errorInfos[1]}`;
      }
    }
    return message;
  }
}

function updateErrorFileCache(diagnostic: ts.Diagnostic): void {
  if (diagnostic.file && cache[path.resolve(diagnostic.file.fileName)]) {
    cache[path.resolve(diagnostic.file.fileName)].error = true;
  }
}

function filterInput(rootFileNames: string[]): string[] {
  return rootFileNames.filter((file: string) => {
    const needUpdate: NeedUpdateFlag = { flag: false };
    const alreadyCheckedFiles: Set<string> = new Set();
    checkNeedUpdateFiles(path.resolve(file), needUpdate, alreadyCheckedFiles);
    return needUpdate.flag;
  });
}

function checkNeedUpdateFiles(file: string, needUpdate: NeedUpdateFlag, alreadyCheckedFiles: Set<string>): void {
  if (alreadyCheckedFiles.has(file)) {
    return;
  } else {
    alreadyCheckedFiles.add(file);
  }

  if (needUpdate.flag) {
    return;
  }

  const value: CacheFileName = cache[file];
  const mtimeMs: number = fs.statSync(file).mtimeMs;
  if (value) {
    if (value.error || value.mtimeMs !== mtimeMs) {
      needUpdate.flag = true;
      return;
    }
    for (let i = 0; i < value.children.length; ++i) {
      checkNeedUpdateFiles(value.children[i], needUpdate, alreadyCheckedFiles);
    }
  } else {
    cache[file] = { mtimeMs, children: [], error: false };
    needUpdate.flag = true;
  }
}
