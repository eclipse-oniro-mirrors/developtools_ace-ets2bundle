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

import ts from 'typescript';
import fs from 'fs';

import {
  ReplaceResult,
  sourceReplace,
  validateUISyntax,
  processSystemApi,
  componentCollection
} from './validate_ui_syntax';
import {
  LogType,
  LogInfo,
  emitLogInfo
} from './utils';
import { BUILD_ON } from './pre_define';
import { projectConfig } from '../main.js';
import { genETS } from '../codegen/codegen_ets.js';

function preProcess(source: string): string {
  process.env.compiler = BUILD_ON;
  if (/\.ets$/.test(this.resourcePath)) {
    const result: ReplaceResult = sourceReplace(source, this.resourcePath);
    let newContent: string = result.content;
    const log: LogInfo[] = result.log.concat(validateUISyntax(source, newContent,
      this.resourcePath, this.resourceQuery));
    newContent = parseVisual(this.resourcePath, newContent, log);
    if (log.length) {
      emitLogInfo(this, log);
    }
    return newContent;
  } else {
    return processSystemApi(source);
  }
}

function parseVisual(resourcePath: string, content: string, log: LogInfo[]): string {
  if (componentCollection.entryComponent && projectConfig.aceSuperVisualPath) {
    const sourceFile: ts.SourceFile = ts.createSourceFile(resourcePath, content,
      ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    if (sourceFile.statements) {
      sourceFile.statements.forEach(statement => {
        content = parseStatement(statement, content, log, resourcePath);
      });
    }
  }
  return content;
}

function parseStatement(statement: ts.Statement, content: string, log: LogInfo[],
  resourcePath: string): string {
  if (statement.kind === ts.SyntaxKind.ClassDeclaration &&
    statement.name && statement.name.getText() === componentCollection.entryComponent) {
    const visualPath: string = findVisualFile(resourcePath);
    if (visualPath && fs.existsSync(visualPath) && statement.members) {
      statement.members.forEach(member => {
        if (member.kind && member.kind === ts.SyntaxKind.MethodDeclaration) {
          content = parseMember(member, content, log, visualPath)
        }
      });
    }
  }
  return content;
}

function parseMember(member: ts.MethodDeclaration, content: string, log: LogInfo[],
  visualPath: string): string {
  if (member.name && member.name.getText() === 'build') {
    const buildBody: string = content.substring(member.pos, member.end);
    if (buildBody.replace(/\ +/g, '').replace(/[\r\n]/g, '') === 'build(){}') {
      const visualContent: string = getVisualContent(visualPath, log, member.pos);
      if (visualContent) {
        content = content.replace(buildBody, '\nbuild() {\n' +
          visualContent + '}\n');
      }
    } else {
      log.push({
        type: LogType.ERROR,
        message: `when the corresponding visual file exists,` +
          ` the build function of the entry component must be empty.`,
        pos: member.pos
      });
    }
  }
  return content;
}

function findVisualFile(filePath: string): string {
  const visualPath: string = filePath.replace(projectConfig.projectPath,
    projectConfig.aceSuperVisualPath).replace('.ets', '.visual');
  return visualPath;
}

function getVisualContent(visualPath: string, log: LogInfo[], pos: number): string {
  const parseContent: any = genETS(fs.readFileSync(visualPath, 'utf-8'));
  if (parseContent && parseContent.errorType && parseContent.errorType != '') {
    log.push({
      type: LogType.ERROR,
      message: parseContent.message,
      pos: pos
    });
  }
  return parseContent ? parseContent.ets : null;
}

module.exports = preProcess;