/*
 * Copyright (c) 2022 Huawei Device Co., Ltd.
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

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as childProcess from 'child_process';
import * as process from 'process';
import { logger } from './compile_info';
import { projectConfig } from '../main';
import {
  FAIL,
  FILESINFO_TXT,
  MODULES_ABC,
  MODULES_CACHE,
  NPMENTRIES_TXT,
  NODE_MODULES
} from './pre_define';
import { EntryInfo, ModuleInfo, initAbcEnv } from './gen_abc_plugin';
import { mkdirsSync, toUnixPath } from './utils';

const red: string = '\u001b[31m';
const reset: string = '\u001b[39m';

function generateCompileFilesInfo(moduleInfos: Array<ModuleInfo>) {
  const tempModuleInfos: ModuleInfo[] = Array<ModuleInfo>();
  moduleInfos.forEach((item) => {
    let check: boolean = tempModuleInfos.every((newItem) => {
      return item.tempFilePath !== newItem.tempFilePath;
    });
    if (check) {
      tempModuleInfos.push(item);
    }
  });
  moduleInfos = tempModuleInfos;

  const filesInfoPath: string = path.join(process.env.cachePath, FILESINFO_TXT);
  let filesInfo: string = '';
  moduleInfos.forEach(info => {
    const moduleType: string = info.isCommonJs ? 'cjs' : 'esm';
    filesInfo += `${info.tempFilePath};${info.recordName};${moduleType}\n`;
  });
  fs.writeFileSync(filesInfoPath, filesInfo, 'utf-8');
}

function generateNpmEntriesInfo(entryInfos: Map<string, EntryInfo>) {
  const npmEntriesInfoPath: string = path.join(process.env.cachePath, NPMENTRIES_TXT);
  let entriesInfo: string = '';
  for (const value of entryInfos.values()) {
    const buildPath: string = value.buildPath.replace(toUnixPath(projectConfig.nodeModulesPath), '');
    const entryFile: string = toUnixPath(path.join(buildPath, value.entry));
    const entry: string = entryFile.substring(0, entryFile.lastIndexOf('.'));
    entriesInfo +=
      `${toUnixPath(path.join(NODE_MODULES, buildPath))}:${toUnixPath(path.join(NODE_MODULES, entry))}\n`;
  }
  fs.writeFileSync(npmEntriesInfoPath, entriesInfo, 'utf-8');
}

export function generateMergedAbc(moduleInfos: Array<ModuleInfo>, entryInfos: Map<string, EntryInfo>) {
  generateCompileFilesInfo(moduleInfos);
  generateNpmEntriesInfo(entryInfos);

  const filesInfoPath: string = path.join(process.env.cachePath, FILESINFO_TXT);
  const npmEntriesInfoPath: string = path.join(process.env.cachePath, NPMENTRIES_TXT);
  const cacheFilePath: string = path.join(process.env.cachePath, MODULES_CACHE);
  const outputABCPath: string = path.join(projectConfig.buildPath, MODULES_ABC);
  const fileThreads = os.cpus().length < 16 ? os.cpus().length : 16;
  mkdirsSync(projectConfig.buildPath);
  const gen_abc_cmd: string =
    `${initAbcEnv().join(' ')} "@${filesInfoPath}" --npm-module-entry-list "${npmEntriesInfoPath}" --cache-file "${cacheFilePath}" --output "${outputABCPath}" --file-threads "${fileThreads}"`;
  logger.debug('gen abc cmd is: ', gen_abc_cmd);
  try {
    const child = childProcess.exec(gen_abc_cmd);
    child.on('exit', (code: any) => {
        if (code === 1) {
            logger.error(red, "ETS:ERROR failed to execute es2abc", reset);
        }
    });

    child.on('error', (err: any) => {
        logger.error(red, err.toString(), reset);
    });
  } catch (e) {
    logger.error(red, `ETS:ERROR failed to generate abc with filesInfo ${filesInfoPath} `, reset);
    process.exit(FAIL);
  }
}