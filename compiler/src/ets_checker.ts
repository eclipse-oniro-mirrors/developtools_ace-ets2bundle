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

import fs from 'fs';
import path from 'path';
import * as ts from 'typescript';

import { projectConfig } from '../main';
import {
  processSystemApi,
  preprocessExtend,
  preprocessNewExtend
} from './validate_ui_syntax';
import {
  INNER_COMPONENT_MEMBER_DECORATORS,
  COMPONENT_IF,
  COMPONENT_DECORATORS_PARAMS,
  COMPONENT_BUILD_FUNCTION,
  STYLE_ADD_DOUBLE_DOLLAR,
  $$,
  PROPERTIES_ADD_DOUBLE_DOLLAR
} from './pre_define';
import { JS_BIND_COMPONENTS } from './component_map';
import { getName } from './process_component_build';
import { INNER_COMPONENT_NAMES } from './component_map';
import { props } from './compile_info';

function readDeaclareFiles(): string[] {
  const declarationsFileNames: string[] = [];
  fs.readdirSync(path.resolve(__dirname, '../declarations'))
    .forEach((fileName: string) => {
      if (/\.d\.ts$/.test(fileName)) {
        declarationsFileNames.push(path.resolve(__dirname, '../declarations', fileName));
      }
    });
  return declarationsFileNames;
}

const compilerOptions: ts.CompilerOptions = ts.readConfigFile(
  path.resolve(__dirname, '../tsconfig.json'), ts.sys.readFile).config.compilerOptions;
function setCompilerOptions() {
  const allPath: Array<string> = [
    '*',
  ]
  if (!projectConfig.aceModuleJsonPath) {
    allPath.push('../../../../../*');
    allPath.push('../../*');
  } else {
    allPath.push('../../../../*');
    allPath.push('../*');
  }
  Object.assign(compilerOptions, {
    'allowJs': false,
    'importsNotUsedAsValues': ts.ImportsNotUsedAsValues.Preserve,
    'module': ts.ModuleKind.CommonJS,
    'moduleResolution': ts.ModuleResolutionKind.NodeJs,
    'noEmit': true,
    'target': ts.ScriptTarget.ES2017,
    'baseUrl': path.resolve(projectConfig.projectPath),
    'paths': {
      '*': allPath
    },
    'lib': [
      'lib.es2020.d.ts'
    ]
  });
}

export function createLanguageService(rootFileNames: string[]): ts.LanguageService {
  setCompilerOptions();
  const files: ts.MapLike<{ version: number }> = {};
  const servicesHost: ts.LanguageServiceHost = {
    getScriptFileNames: () => [...rootFileNames, ...readDeaclareFiles()],
    getScriptVersion: fileName =>
      files[fileName] && files[fileName].version.toString(),
    getScriptSnapshot: fileName => {
      if (!fs.existsSync(fileName)) {
        return undefined;
      }
      if (/(?<!\.d)\.(ets|ts)$/.test(fileName)) {
        const content: string = processContent(fs.readFileSync(fileName).toString());
        checkUISyntax(content, fileName);
        return ts.ScriptSnapshot.fromString(content);
      }
      return ts.ScriptSnapshot.fromString(fs.readFileSync(fileName).toString());
    },
    getCurrentDirectory: () => process.cwd(),
    getCompilationSettings: () => compilerOptions,
    getDefaultLibFileName: options => ts.getDefaultLibFilePath(options),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    resolveModuleNames: resolveModuleNames,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories
  };
  return ts.createLanguageService(servicesHost, ts.createDocumentRegistry());
}

function resolveModuleNames(moduleNames: string[], containingFile: string): ts.ResolvedModuleFull[] {
  const resolvedModules: ts.ResolvedModuleFull[] = [];
  for (const moduleName of moduleNames) {
    const result = ts.resolveModuleName(moduleName, containingFile, compilerOptions, {
      fileExists(fileName: string): boolean {
        return ts.sys.fileExists(fileName);
      },
      readFile(fileName: string): string | undefined {
        return ts.sys.readFile(fileName);
      }
    });
    if (result.resolvedModule) {
      resolvedModules.push(result.resolvedModule);
    } else if (/^@(system|ohos)/.test(moduleName.trim())) {
      const modulePath: string = path.resolve(__dirname, '../../../api', moduleName + '.d.ts');
      if (ts.sys.fileExists(modulePath)) {
        resolvedModules.push(getResolveModule(modulePath, '.d.ts'));
      } else {
        resolvedModules.push(null);
      }
    } else if (/\.ets$/.test(moduleName)) {
      const modulePath: string = path.resolve(path.dirname(containingFile), moduleName);
      if (ts.sys.fileExists(modulePath)) {
        resolvedModules.push(getResolveModule(modulePath, '.ets'));
      } else {
        resolvedModules.push(null);
      }
    } else if (/\.ts$/.test(moduleName)) {
      const modulePath: string = path.resolve(path.dirname(containingFile), moduleName);
      if (ts.sys.fileExists(modulePath)) {
        resolvedModules.push(getResolveModule(modulePath, '.ts'));
      } else {
        resolvedModules.push(null);
      }
    } else {
      const modulePath: string = path.resolve(__dirname, '../../../api', moduleName + '.d.ts');
      if (ts.sys.fileExists(modulePath)) {
        resolvedModules.push(getResolveModule(modulePath, '.d.ts'));
      } else {
        resolvedModules.push(null);
      }
    }
  }
  return resolvedModules;
}

export function createWatchCompilerHost(rootFileNames: string[],
  reportDiagnostic: ts.DiagnosticReporter, delayPrintLogCount: Function
): ts.WatchCompilerHostOfFilesAndCompilerOptions<ts.BuilderProgram> {
  setCompilerOptions();
  const createProgram = ts.createSemanticDiagnosticsBuilderProgram;
  const host = ts.createWatchCompilerHost(
    [...rootFileNames, ...readDeaclareFiles()], compilerOptions,
    ts.sys, createProgram, reportDiagnostic,
    (diagnostic: ts.Diagnostic) => {
      // End of compilation in watch mode flag.
      if ([6193, 6194].includes(diagnostic.code)) {
        process.env.watchTs = 'end';
        delayPrintLogCount();
      }
    });
  host.readFile = (fileName: string) => {
    if (!fs.existsSync(fileName)) {
      return undefined;
    }
    if (/(?<!\.d)\.(ets|ts)$/.test(fileName)) {
      const content: string = processContent(fs.readFileSync(fileName).toString());
      checkUISyntax(content, fileName);
      return content;
    }
    return fs.readFileSync(fileName).toString();
  };
  host.resolveModuleNames = resolveModuleNames;
  return host;
}

function getResolveModule(modulePath: string, type): ts.ResolvedModuleFull {
  return {
    resolvedFileName: modulePath,
    isExternalLibraryImport: false,
    extension: type
  };
}

export const dollarCollection: Set<string> = new Set();
export const appComponentCollection: Set<string> = new Set();
export const decoratorParamsCollection: Set<string> = new Set();
export const extendCollection: Set<string> = new Set();
export const importModuleCollection: Set<string> = new Set();

function checkUISyntax(source: string, fileName: string): void {
  if (/\.ets$/.test(fileName)) {
    if (path.basename(fileName) !== 'app.ets') {
      const sourceFile: ts.SourceFile = ts.createSourceFile(fileName, source,
        ts.ScriptTarget.Latest, true, ts.ScriptKind.ETS);
      collectComponents(sourceFile);
      parseAllNode(sourceFile, sourceFile);
      props.push(...dollarCollection, ...decoratorParamsCollection, ...extendCollection);
    }
  }
}

function collectComponents(node: ts.SourceFile): void {
  // @ts-ignore
  if (process.env.watchMode !== 'true' && node.identifiers && node.identifiers.size) {
    // @ts-ignore
    for (const key of node.identifiers.keys()) {
      if (JS_BIND_COMPONENTS.has(key)) {
        appComponentCollection.add(key);
      }
    }
  }
}

function parseAllNode(node: ts.Node, sourceFileNode: ts.SourceFile): void {
  if (ts.isStructDeclaration(node)) {
    if (node.members) {
      node.members.forEach(item => {
        if (ts.isPropertyDeclaration(item) && ts.isIdentifier(item.name)) {
          const propertyName: string = item.name.getText();
          if (item.decorators && item.decorators.length) {
            for (let i = 0; i < item.decorators.length; i++) {
              const decoratorName: string = item.decorators[i].getText().replace(/\(.*\)$/, '').trim();
              if (INNER_COMPONENT_MEMBER_DECORATORS.has(decoratorName)) {
                dollarCollection.add('$' + propertyName);
              }
              if (isDecoratorCollection(item.decorators[i], decoratorName)) {
                decoratorParamsCollection.add(item.decorators[i].expression.arguments[0].getText());
              }
            }
          }
        }
      });
    }
  }
  if (ts.isIfStatement(node)) {
    appComponentCollection.add(COMPONENT_IF);
  }
  if (ts.isMethodDeclaration(node) && node.name.getText() === COMPONENT_BUILD_FUNCTION) {
    if (node.body && node.body.statements && node.body.statements.length) {
      const checkProp: ts.NodeArray<ts.Statement> = node.body.statements;
      checkProp.forEach((item, index) => {
        traverseBuild(item, index);
      });
    }
  }
  node.getChildren().forEach((item: ts.Node) => parseAllNode(item, sourceFileNode));
}

function traverseBuild(node: ts.Node, index: number): void {
  if (ts.isExpressionStatement(node)) {
    let parentComponentName: string = getName(node);
    if (!INNER_COMPONENT_NAMES.has(parentComponentName) && node.parent && node.parent.statements && index >= 1 &&
      node.parent.statements[index - 1].expression && node.parent.statements[index - 1].expression.expression) {
      parentComponentName = node.parent.statements[index - 1].expression.expression.escapedText;
    }
    node = node.expression;
    if (ts.isEtsComponentExpression(node) && node.body && ts.isBlock(node.body)) {
      node.body.statements.forEach((item, indexBlock) => {
        traverseBuild(item, indexBlock);
      });
    } else {
      loopNodeFindDoubleDollar(node, parentComponentName);
    }
  } else if (ts.isIfStatement(node)) {
    if (node.thenStatement && ts.isBlock(node.thenStatement) && node.thenStatement.statements) {
      node.thenStatement.statements.forEach((item, indexIfBlock) => {
        traverseBuild(item, indexIfBlock);
      });
    }
    if (node.elseStatement && ts.isBlock(node.elseStatement) && node.elseStatement.statements) {
      node.elseStatement.statements.forEach((item, indexElseBlock) => {
        traverseBuild(item, indexElseBlock);
      });
    }
  }
}

function loopNodeFindDoubleDollar(node: ts.Node, parentComponentName: string): void {
  while (node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const argument: ts.NodeArray<ts.Node> = node.arguments;
      const propertyName: ts.Identifier | ts.PrivateIdentifier = node.expression.name;
      if (isCanAddDoubleDollar(propertyName.getText(), parentComponentName)) {
        argument.forEach((item: ts.Node) => {
          doubleDollarCollection(item);
        });
      }
    } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.arguments
      && node.arguments.length) {
      node.arguments.forEach((item: ts.Node) => {
        if (ts.isObjectLiteralExpression(item) && item.properties && item.properties.length) {
          item.properties.forEach((param: ts.Node) => {
            if (isObjectPram(param, parentComponentName)) {
              doubleDollarCollection(param.initializer);
            }
          });
        }
        if (STYLE_ADD_DOUBLE_DOLLAR.has(node.expression.getText()) && ts.isPropertyAccessExpression(item)) {
          doubleDollarCollection(item);
        }
      });
    }
    node = node.expression;
  }
}

function doubleDollarCollection(item: ts.Node): void {
  if (item.getText().startsWith($$)) {
    while (item.expression) {
      item = item.expression;
    }
    dollarCollection.add(item.getText());
  }
}

function isObjectPram(param: ts.Node, parentComponentName:string): boolean {
  return ts.isPropertyAssignment(param) && param.name && ts.isIdentifier(param.name) &&
    param.initializer && PROPERTIES_ADD_DOUBLE_DOLLAR.has(parentComponentName) &&
    PROPERTIES_ADD_DOUBLE_DOLLAR.get(parentComponentName).has(param.name.getText());
}

function isCanAddDoubleDollar(propertyName: string, parentComponentName: string): boolean {
  return PROPERTIES_ADD_DOUBLE_DOLLAR.has(parentComponentName) &&
    PROPERTIES_ADD_DOUBLE_DOLLAR.get(parentComponentName).has(propertyName) ||
    STYLE_ADD_DOUBLE_DOLLAR.has(propertyName);
}

function isDecoratorCollection(item: ts.Decorator, decoratorName: string): boolean {
  return COMPONENT_DECORATORS_PARAMS.has(decoratorName) &&
    // @ts-ignore
    item.expression.arguments && item.expression.arguments.length &&
    // @ts-ignore
    ts.isIdentifier(item.expression.arguments[0]);
}

function processDraw(source: string): string {
  const reg: RegExp = /new\s+\b(Circle|Ellipse|Rect|Path)\b/g;
  return source.replace(reg, (item:string, item1: string) => {
    return '\xa0'.repeat(item.length - item1.length) + item1;
  });
}

function processContent(source: string): string {
  source = processSystemApi(source);
  source = preprocessExtend(source, extendCollection);
  source = preprocessNewExtend(source, extendCollection);
  source = processDraw(source);
  return source;
}
