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

import {
  projectConfig,
  systemModules
} from '../main';
import {
  processSystemApi,
  preprocessExtend,
  preprocessNewExtend
} from './validate_ui_syntax';
import {
  INNER_COMPONENT_MEMBER_DECORATORS,
  COMPONENT_DECORATORS_PARAMS,
  COMPONENT_BUILD_FUNCTION,
  STYLE_ADD_DOUBLE_DOLLAR,
  $$,
  PROPERTIES_ADD_DOUBLE_DOLLAR,
  $$_BLOCK_INTERFACE,
  COMPONENT_EXTEND_DECORATOR
} from './pre_define';
import { getName } from './process_component_build';
import { INNER_COMPONENT_NAMES } from './component_map';
import { props } from './compile_info';
import { resolveSourceFile } from './resolve_ohm_url';
import {
  CacheFileName,
  cache,
  shouldResolvedFiles
} from './compile_info';
import { hasDecorator } from './utils';
import { isExtendFunction, isOriginalExtend } from './process_ui_syntax';

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
    '*'
  ];
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

interface extendInfo {
  start: number,
  end: number,
  compName: string
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
        let content: string = processContent(fs.readFileSync(fileName).toString(), fileName);
        const extendFunctionInfo: extendInfo[] = [];
        content = instanceInsteadThis(content, fileName, extendFunctionInfo);
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

function getOhmUrlFile(moduleName: string): {modulePath: string, suffix: string} {
  const modulePath: string = resolveSourceFile(moduleName);
  let suffix: string = path.extname(modulePath);
  if (suffix === 'ts' && modulePath.endsWith('.d.ts')) {
    suffix = '.d.ts';
  }

  return {modulePath, suffix};
}

const resolvedModulesCache: Map<string, ts.ResolvedModuleFull[]> = new Map();

function resolveModuleNames(moduleNames: string[], containingFile: string): ts.ResolvedModuleFull[] {
  const resolvedModules: ts.ResolvedModuleFull[] = [];
  if (![...shouldResolvedFiles].length || shouldResolvedFiles.has(path.resolve(containingFile))) {
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
      } else if (/^@bundle:/.test(moduleName.trim())) {
        const module: {modulePath: string, suffix: string} = getOhmUrlFile(moduleName.trim());
        if (ts.sys.fileExists(module.modulePath)) {
          resolvedModules.push(getResolveModule(module.modulePath, module.suffix));
        } else {
          resolvedModules.push(null);
        }
      } else if (/^@(system|ohos)\./i.test(moduleName.trim())) {
        const modulePath: string = path.resolve(__dirname, '../../../api', moduleName + '.d.ts');
        if (systemModules.includes(moduleName + '.d.ts') && ts.sys.fileExists(modulePath)) {
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
        const suffix: string = /\.js$/.test(moduleName) ? '' : '.js';
        const jsModulePath: string = path.resolve(__dirname, '../node_modules', moduleName + suffix);
        const fileModulePath: string =
          path.resolve(__dirname, '../node_modules', moduleName + '/index.js');
        if (ts.sys.fileExists(modulePath)) {
          resolvedModules.push(getResolveModule(modulePath, '.d.ts'));
        } else if (ts.sys.fileExists(jsModulePath)) {
          resolvedModules.push(getResolveModule(jsModulePath, '.js'));
        } else if (ts.sys.fileExists(fileModulePath)) {
          resolvedModules.push(getResolveModule(fileModulePath, '.js'));
        } else {
          resolvedModules.push(null);
        }
      }
    }
    if (!projectConfig.xtsMode) {
      createOrUpdateCache(resolvedModules, containingFile);
    }
    resolvedModulesCache[path.resolve(containingFile)] = resolvedModules
    return resolvedModules;
  }
  return resolvedModulesCache[path.resolve(containingFile)];
}

function createOrUpdateCache(resolvedModules: ts.ResolvedModuleFull[], containingFile: string): void {
  const children: string[] = [];
  const error: boolean = false;
  resolvedModules.forEach(moduleObj => {
    if (moduleObj && moduleObj.resolvedFileName && /(?<!\.d)\.(ets|ts)$/.test(moduleObj.resolvedFileName)) {
      const file: string = path.resolve(moduleObj.resolvedFileName);
      const mtimeMs: number = fs.statSync(file).mtimeMs;
      children.push(file);
      const value: CacheFileName = cache[file];
      if (value) {
        value.mtimeMs = mtimeMs;
        value.error = error;
        value.parent = value.parent || [];
        value.parent.push(path.resolve(containingFile));
        value.parent = [...new Set(value.parent)];
      } else {
        cache[file] = { mtimeMs, children: [], parent: [containingFile], error };
      }
    }
  });
  cache[path.resolve(containingFile)] = { mtimeMs: fs.statSync(containingFile).mtimeMs, children,
    parent: cache[path.resolve(containingFile)] && cache[path.resolve(containingFile)].parent ?
    cache[path.resolve(containingFile)].parent : [], error };
}

export function createWatchCompilerHost(rootFileNames: string[],
  reportDiagnostic: ts.DiagnosticReporter, delayPrintLogCount: Function, isPipe: boolean = false
): ts.WatchCompilerHostOfFilesAndCompilerOptions<ts.BuilderProgram> {
  setCompilerOptions();
  const createProgram = ts.createSemanticDiagnosticsBuilderProgram;
  const host = ts.createWatchCompilerHost(
    [...rootFileNames, ...readDeaclareFiles()], compilerOptions,
    ts.sys, createProgram, reportDiagnostic,
    (diagnostic: ts.Diagnostic) => {
      // End of compilation in watch mode flag.
      if ([6193, 6194].includes(diagnostic.code)) {
        if (!isPipe) {
          process.env.watchTs = 'end';
        }
        delayPrintLogCount();
      }
    });
  host.readFile = (fileName: string) => {
    if (!fs.existsSync(fileName)) {
      return undefined;
    }
    if (/(?<!\.d)\.(ets|ts)$/.test(fileName)) {
      let content: string = processContent(fs.readFileSync(fileName).toString(), fileName);
      const extendFunctionInfo: extendInfo[] = [];
      content = instanceInsteadThis(content, fileName, extendFunctionInfo);
      return content;
    }
    return fs.readFileSync(fileName).toString();
  };
  host.resolveModuleNames = resolveModuleNames;
  return host;
}

function instanceInsteadThis(content: string, fileName: string, extendFunctionInfo: extendInfo[]): string {
  checkUISyntax(content, fileName, extendFunctionInfo);
  extendFunctionInfo.reverse().forEach((item) => {
    const subStr: string = content.substring(item.start, item.end);
    const insert: string = subStr.replace(/(\s)\$(\.)/g, (origin, item1, item2) => {
      return item1 + item.compName + 'Instance' + item2;
    });
    content = content.slice(0, item.start) + insert + content.slice(item.end);
  });
  return content;
}

function getResolveModule(modulePath: string, type): ts.ResolvedModuleFull {
  return {
    resolvedFileName: modulePath,
    isExternalLibraryImport: false,
    extension: type
  };
}

export const dollarCollection: Set<string> = new Set();
export const decoratorParamsCollection: Set<string> = new Set();
export const extendCollection: Set<string> = new Set();
export const importModuleCollection: Set<string> = new Set();

function checkUISyntax(source: string, fileName: string, extendFunctionInfo: extendInfo[]): void {
  if (/\.ets$/.test(fileName)) {
    if (path.basename(fileName) !== 'app.ets') {
      const sourceFile: ts.SourceFile = ts.createSourceFile(fileName, source,
        ts.ScriptTarget.Latest, true, ts.ScriptKind.ETS);
      parseAllNode(sourceFile, sourceFile, extendFunctionInfo);
      props.push(...dollarCollection, ...decoratorParamsCollection, ...extendCollection);
    }
  }
}

function parseAllNode(node: ts.Node, sourceFileNode: ts.SourceFile, extendFunctionInfo: extendInfo[]): void {
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
  if (ts.isMethodDeclaration(node) && node.name.getText() === COMPONENT_BUILD_FUNCTION) {
    if (node.body && node.body.statements && node.body.statements.length) {
      const checkProp: ts.NodeArray<ts.Statement> = node.body.statements;
      checkProp.forEach((item, index) => {
        traverseBuild(item, index);
      });
    }
  }
  if (ts.isFunctionDeclaration(node) && hasDecorator(node, COMPONENT_EXTEND_DECORATOR)) {
    if (node.body && node.body.statements && node.body.statements.length &&
      !isOriginalExtend(node.body)) {
      extendFunctionInfo.push({start: node.pos, end: node.end, compName: isExtendFunction(node)});
    }
  }
  node.getChildren().forEach((item: ts.Node) => parseAllNode(item, sourceFileNode, extendFunctionInfo));
}

function traverseBuild(node: ts.Node, index: number): void {
  if (ts.isExpressionStatement(node)) {
    let parentComponentName: string = getName(node);
    if (!INNER_COMPONENT_NAMES.has(parentComponentName) && node.parent && node.parent.statements && index >= 1 &&
      node.parent.statements[index - 1].expression && node.parent.statements[index - 1].expression.expression) {
      parentComponentName = node.parent.statements[index - 1].expression.expression.escapedText;
    }
    node = node.expression;
    if (ts.isEtsComponentExpression(node) && node.body && ts.isBlock(node.body) &&
      !$$_BLOCK_INTERFACE.has(node.expression.escapedText.toString())) {
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

function isPropertiesAddDoubleDollar(node: ts.Node): boolean {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.arguments && node.arguments.length) {
    return true;
  } else if (ts.isEtsComponentExpression(node) && node.body && ts.isBlock(node.body) &&
    $$_BLOCK_INTERFACE.has(node.expression.escapedText.toString())) {
    return true;
  } else {
    return false;
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
    } else if (isPropertiesAddDoubleDollar(node)) {
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

function processContent(source: string, sourcePath: string): string {
  source = processSystemApi(source, false, sourcePath);
  source = preprocessExtend(source, extendCollection);
  source = preprocessNewExtend(source, extendCollection);
  source = processDraw(source);
  return source;
}
